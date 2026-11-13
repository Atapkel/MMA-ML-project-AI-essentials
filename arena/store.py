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
    cursor      INTEGER NOT NULL DEFAULT 0,   -- ranking show position (shared by every screen)
    state       TEXT,                         -- tournament show state: played fights, fight on stage (JSON)
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
            # WAL lets readers and a writer work at the same time. It is stored in the database file,
            # so it is set once here (setting it on every connection made requests wait for locks).
            db.execute('PRAGMA journal_mode = WAL')
            db.executescript(SCHEMA)
            columns = {r['name'] for r in db.execute('PRAGMA table_info(rooms)')}
            if 'cursor' not in columns:  # database created by an older version
                db.execute('ALTER TABLE rooms ADD COLUMN cursor INTEGER NOT NULL DEFAULT 0')
            if 'state' not in columns:
                db.execute('ALTER TABLE rooms ADD COLUMN state TEXT')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys = ON')
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

    def version(self, code):
        """Last change time of a room (None if it does not exist); a cheap check for polling."""
        with self.connect() as db:
            row = db.execute('SELECT updated_at FROM rooms WHERE code = ?', (code,)).fetchone()
        return row['updated_at'] if row else None

    def room(self, code):
        with self.connect() as db:
            row = db.execute('SELECT * FROM rooms WHERE code = ?', (code,)).fetchone()
            if not row:
                return None
            players = db.execute('SELECT id, name, profile, derived FROM players WHERE room_code = ? ORDER BY id',
                                 (code,)).fetchall()
        return {
            'code': row['code'], 'host_token': row['host_token'], 'status': row['status'], 'mode': row['mode'],
            'top_k': row['top_k'], 'updated_at': row['updated_at'], 'cursor': row['cursor'],
            'state': json.loads(row['state']) if row['state'] else {},
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
            db.execute("UPDATE rooms SET status = 'done', mode = ?, top_k = ?, results = ?, cursor = 0, state = NULL, updated_at = ? "
                       'WHERE code = ?', (mode, top_k, json.dumps(results), time.time(), code))

    def set_state(self, code, state):
        with self.connect() as db:
            db.execute('UPDATE rooms SET state = ?, updated_at = ? WHERE code = ?', (json.dumps(state), time.time(), code))

    def set_cursor(self, code, cursor):
        with self.connect() as db:
            db.execute('UPDATE rooms SET cursor = ?, updated_at = ? WHERE code = ?', (cursor, time.time(), code))

    def reset(self, code):
        with self.connect() as db:
            db.execute("UPDATE rooms SET status = 'lobby', results = NULL, cursor = 0, state = NULL, updated_at = ? WHERE code = ?",
                       (time.time(), code))
