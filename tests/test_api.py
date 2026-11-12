"""End-to-end API flow with a temporary database."""
import os
import tempfile

os.environ['ARENA_DB'] = os.path.join(tempfile.mkdtemp(), 'test.db')

from fastapi.testclient import TestClient  # noqa: E402

from arena.app import app  # noqa: E402

client = TestClient(app)
PROFILE = dict(sex='M', age=27, height=180, weight=80, hand='right', striking=2, wrestling=1, grappling=0,
               pushups=25)


def make_room():
    r = client.post('/api/rooms')
    assert r.status_code == 200
    return r.json()


def test_full_game_flow():
    room = make_room()
    code, token = room['code'], room['host_token']
    for name, weight in (('Aida', 62), ('Bek', 95), ('Chen', 77)):
        r = client.post(f'/api/rooms/{code}/players', json={**PROFILE, 'name': name, 'weight': weight})
        assert r.status_code == 200, r.text
        assert r.json()['summary']['reach_cm'] > 150
    state = client.get(f'/api/rooms/{code}').json()
    assert state['status'] == 'lobby' and len(state['players']) == 3

    assert client.post(f'/api/rooms/{code}/start', json={'host_token': 'nope', 'mode': 'ranking'}).status_code == 403
    r = client.post(f'/api/rooms/{code}/start', json={'host_token': token, 'mode': 'ranking', 'top_k': 2})
    assert r.status_code == 200
    results = r.json()['results']
    assert results['mode'] == 'ranking' and len(results['table']) == 3

    # nobody can join while results are showing; the host can open a new round
    assert client.post(f'/api/rooms/{code}/players', json={**PROFILE, 'name': 'Late'}).status_code == 409
    assert client.post(f'/api/rooms/{code}/reset', json={'host_token': token}).json()['status'] == 'lobby'
    r = client.post(f'/api/rooms/{code}/start', json={'host_token': token, 'mode': 'tournament'})
    assert r.json()['results']['champion_name'] in {'Aida', 'Bek', 'Chen'}


def test_validation_and_errors():
    room = make_room()
    bad = client.post(f"/api/rooms/{room['code']}/players", json={**PROFILE, 'name': 'X', 'weight': 500})
    assert bad.status_code == 422
    assert client.get('/api/rooms/ZZZZZ').status_code == 404
    one = client.post(f"/api/rooms/{room['code']}/players", json={**PROFILE, 'name': 'Solo'})
    assert one.status_code == 200
    r = client.post(f"/api/rooms/{room['code']}/start", json={'host_token': room['host_token'], 'mode': 'ranking'})
    assert r.status_code == 400


def test_qr_and_pages():
    room = make_room()
    r = client.get(f"/api/rooms/{room['code']}/qr.svg")
    assert r.status_code == 200 and r.headers['content-type'].startswith('image/svg+xml')
    assert r.headers['x-join-url'].endswith(f"/r/{room['code']}")
    assert client.get(f"/r/{room['code']}").status_code == 200
    assert client.get('/static/app.js').status_code == 200


def test_players_saved_by_older_version_still_work():
    """Players stored before the push-up update had no 'pushups' in their saved model inputs."""
    from arena.app import store
    room = make_room()
    for name in ('Old', 'Older'):
        store.add_player(room['code'], name, {**PROFILE, 'name': name, 'years': 2, 'sessions': 3},
                         {'reach_cm': 180.0, 'style': 'Brawler', 'fitness': None, 'strength_index': 300.0,
                          'size_strength_ref': 300.0, 'fitness_multiplier': 1.0, 'skill': {}})
    assert client.get(f"/api/rooms/{room['code']}").status_code == 200
    for mode in ('ranking', 'tournament'):
        client.post(f"/api/rooms/{room['code']}/reset", json={'host_token': room['host_token']})
        r = client.post(f"/api/rooms/{room['code']}/start", json={'host_token': room['host_token'], 'mode': mode})
        assert r.status_code == 200, r.text


def test_fill_with_famous_fighters():
    room = make_room()
    assert client.post(f"/api/rooms/{room['code']}/demo", json={'host_token': 'nope'}).status_code == 403
    r = client.post(f"/api/rooms/{room['code']}/demo", json={'host_token': room['host_token']}).json()
    assert r['added'] == 10 and len(r['players']) == 10
    again = client.post(f"/api/rooms/{room['code']}/demo", json={'host_token': room['host_token']}).json()
    assert again['added'] == 0  # no duplicates
    start = client.post(f"/api/rooms/{room['code']}/start", json={'host_token': room['host_token'], 'mode': 'ranking', 'top_k': 5})
    assert start.status_code == 200
