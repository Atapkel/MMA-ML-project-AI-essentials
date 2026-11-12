"""HTTP API and static web app.

Run locally:  uvicorn arena.app:app --reload        then open http://127.0.0.1:8000
"""
import io
import os
import secrets
from typing import Literal, Optional

import segno
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from arena import engine
from arena.demo import FAMOUS_FIGHTERS
from arena.paths import DB_PATH, WEB
from arena.store import Store

app = FastAPI(title='Fight Arena', docs_url='/api/docs')
store = Store(os.environ.get('ARENA_DB') or DB_PATH)
app.mount('/static', StaticFiles(directory=WEB), name='static')


class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=24)
    sex: Literal['M', 'F']
    age: int = Field(ge=14, le=80)
    height: float = Field(ge=130, le=230, description='cm')
    weight: float = Field(ge=35, le=200, description='kg')
    hand: Literal['right', 'left'] = 'right'
    striking: int = Field(ge=0, le=5)
    wrestling: int = Field(ge=0, le=5)
    grappling: int = Field(ge=0, le=5)
    pushups: Optional[int] = Field(default=None, ge=0, le=200,
                                   description='max push-ups in a row (women: knee push-ups, as in the CSEP norms)')


class StartRequest(BaseModel):
    host_token: str
    mode: Literal['ranking', 'tournament']
    top_k: int = Field(default=3, ge=1, le=32)


class HostRequest(BaseModel):
    host_token: str


def public_player(p):
    pr = p['profile']
    d = p['derived'] if 'pushups' in p['derived'] else engine.derive(pr)  # saved by an older version
    return {'id': p['id'], 'name': p['name'], 'style': d['style'], 'sex': pr['sex'], 'age': pr['age'],
            'height': pr['height'], 'weight': pr['weight'], 'hand': pr.get('hand', 'right'), 'reach': d['reach_cm'],
            'levels': {k: pr[k] for k in ('striking', 'wrestling', 'grappling')},
            'pushups': d.get('pushups'), 'fitness_class': (d['fitness'] or {}).get('class'),
            'strength_rel': round(d['strength_index'] / d['size_strength_ref'], 3),
            'strength_index': d['strength_index']}


def public_room(room):
    return {'code': room['code'], 'status': room['status'], 'mode': room['mode'], 'top_k': room['top_k'],
            'version': room['updated_at'], 'players': [public_player(p) for p in room['players']],
            'results': room['results']}


def get_room_or_404(code):
    room = store.room(code.upper())
    if not room:
        raise HTTPException(404, 'Room not found. Check the code or create a new fight night.')
    return room


def require_host(room, token):
    if not secrets.compare_digest(room['host_token'], token):
        raise HTTPException(403, 'Only the host can do this.')


def summary(derived):
    return {'reach_cm': derived['reach_cm'], 'style': derived['style'], 'fitness': derived['fitness'],
            'pushups': derived['pushups'], 'strength_index': derived['strength_index'],
            'fitness_multiplier': derived['fitness_multiplier']}


@app.get('/')
@app.get('/r/{code}')
def index(code: str = ''):
    return FileResponse(WEB / 'index.html')


@app.get('/api/health')
def health():
    models = engine.load_models()
    return {'ok': True, 'models_trained_at': models['trained_at']}


@app.get('/api/options')
def options():
    return {'levels': engine.LEVELS}


@app.post('/api/preview')
def preview(profile: Profile):
    """What the models infer from a profile (shown live while the form is filled)."""
    return summary(engine.derive(profile.model_dump()))


@app.post('/api/rooms')
def create_room():
    code, token = store.create_room()
    return {'code': code, 'host_token': token}


@app.get('/api/rooms/{code}')
def room_state(code: str):
    return public_room(get_room_or_404(code))


@app.post('/api/rooms/{code}/players')
def join(code: str, profile: Profile):
    room = get_room_or_404(code)
    if room['status'] != 'lobby':
        raise HTTPException(409, 'The fights already started. Ask the host to open a new round.')
    data = profile.model_dump()
    derived = engine.derive(data)
    try:
        player_id, token = store.add_player(room['code'], data['name'].strip(), data, derived)
    except ValueError as error:
        raise HTTPException(409, str(error))
    return {'player_id': player_id, 'player_token': token, 'summary': summary(derived)}


@app.delete('/api/rooms/{code}/players/{player_id}')
def kick(code: str, player_id: int, host_token: str):
    room = get_room_or_404(code)
    require_host(room, host_token)
    store.remove_player(room['code'], player_id)
    return {'ok': True}


@app.post('/api/rooms/{code}/start')
def start(code: str, request: StartRequest):
    room = get_room_or_404(code)
    require_host(room, request.host_token)
    players = room['players']
    if len(players) < 2:
        raise HTTPException(400, 'At least 2 fighters are needed.')
    seed = secrets.randbits(32)
    if request.mode == 'ranking':
        results = engine.rank_players(players, top_k=request.top_k, seed=seed)
    else:
        results = engine.run_tournament(players, seed=seed)
    store.save_results(room['code'], request.mode, request.top_k, results)
    return public_room(store.room(room['code']))


@app.post('/api/rooms/{code}/reset')
def reset(code: str, request: HostRequest):
    room = get_room_or_404(code)
    require_host(room, request.host_token)
    store.reset(room['code'])
    return public_room(store.room(room['code']))


@app.post('/api/rooms/{code}/demo')
def add_famous_fighters(code: str, request: HostRequest):
    """Testing helper: fill the room with well-known fighters (skips names already in the room)."""
    room = get_room_or_404(code)
    require_host(room, request.host_token)
    if room['status'] != 'lobby':
        raise HTTPException(409, 'Open a new round first.')
    taken = {p['name'] for p in room['players']}
    added = 0
    for fighter in FAMOUS_FIGHTERS:
        if fighter['name'] in taken:
            continue
        profile = Profile(**fighter).model_dump()
        try:
            store.add_player(room['code'], profile['name'], profile, engine.derive(profile))
        except ValueError:
            break  # room full
        added += 1
    return {'added': added, **public_room(store.room(room['code']))}


@app.get('/api/rooms/{code}/qr.svg')
def qr(code: str, request: Request):
    room = get_room_or_404(code)
    base = os.environ.get('PUBLIC_URL') or str(request.base_url)
    url = base.rstrip('/') + f"/r/{room['code']}"
    buffer = io.BytesIO()
    segno.make(url, error='m').save(buffer, kind='svg', scale=8, dark='#0b0f19', light='#ffffff', border=2)
    return Response(buffer.getvalue(), media_type='image/svg+xml', headers={'X-Join-Url': url})
