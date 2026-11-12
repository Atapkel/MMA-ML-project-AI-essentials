"""SQLite storage for rooms (fight nights) and their players."""
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager

from arena.paths import DB_PATH

CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no 0/O or 1/I look-alikes
MAX_PLAYERS = 32
ROOM_TTL_SECONDS = 2 * 24 * 3600

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
    code        TEXT PRIMARY KEY,
    host_token  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'lobby',      -- lobby | done
    mode        TEXT,                               -- ranking | tournament
    top_k       INTEGER,
    results     TEXT,                               -- JSON produced by the engine
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code   TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    name        TEXT NOT NULL,
    profile     TEXT NOT NULL,                      -- what the player entered (JSON)
    derived     TEXT NOT NULL,                      -- model inputs/estimates (JSON)
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS players_room ON players(room_code);
"""


class Store:
    def __init__(self, path=DB_PATH):
        self.path = str(path)
        with self.connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
        db.execute('PRAGMA journal_mode = WAL')
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def _touch(self, db, code):
        db.execute('UPDATE rooms SET updated_at = ? WHERE code = ?', (time.time(), code))

    def create_room(self):
        now = time.time()
        with self.connect() as db:
            db.execute('DELETE FROM rooms WHERE updated_at < ?', (now - ROOM_TTL_SECONDS,))
            for _ in range(20):
                code = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(5))
                if not db.execute('SELECT 1 FROM rooms WHERE code = ?', (code,)).fetchone():
                    break
            token = secrets.token_urlsafe(16)
            db.execute('INSERT INTO rooms (code, host_token, created_at, updated_at) VALUES (?, ?, ?, ?)',
                       (code, token, now, now))
        return code, token

    def room(self, code):
        with self.connect() as db:
            row = db.execute('SELECT * FROM rooms WHERE code = ?', (code,)).fetchone()
            if not row:
                return None
            players = db.execute('SELECT id, name, profile, derived FROM players WHERE room_code = ? ORDER BY id',
                                 (code,)).fetchall()
        return {
            'code': row['code'], 'host_token': row['host_token'], 'status': row['status'], 'mode': row['mode'],
            'top_k': row['top_k'], 'updated_at': row['updated_at'],
            'results': json.loads(row['results']) if row['results'] else None,
            'players': [{'id': p['id'], 'name': p['name'], 'profile': json.loads(p['profile']),
                         'derived': json.loads(p['derived'])} for p in players],
        }

    def add_player(self, code, name, profile, derived):
        token = secrets.token_urlsafe(16)
        with self.connect() as db:
            count = db.execute('SELECT COUNT(*) FROM players WHERE room_code = ?', (code,)).fetchone()[0]
            if count >= MAX_PLAYERS:
                raise ValueError(f'room is full ({MAX_PLAYERS} fighters max)')
            cur = db.execute('INSERT INTO players (room_code, token, name, profile, derived, created_at) '
                             'VALUES (?, ?, ?, ?, ?, ?)',
                             (code, token, name, json.dumps(profile), json.dumps(derived), time.time()))
            self._touch(db, code)
        return cur.lastrowid, token

    def remove_player(self, code, player_id):
        with self.connect() as db:
            db.execute('DELETE FROM players WHERE room_code = ? AND id = ?', (code, player_id))
            self._touch(db, code)

    def save_results(self, code, mode, top_k, results):
        with self.connect() as db:
            db.execute("UPDATE rooms SET status = 'done', mode = ?, top_k = ?, results = ?, updated_at = ? "
                       'WHERE code = ?', (mode, top_k, json.dumps(results), time.time(), code))

    def reset(self, code):
        with self.connect() as db:
            db.execute("UPDATE rooms SET status = 'lobby', results = NULL, updated_at = ? WHERE code = ?",
                       (time.time(), code))
