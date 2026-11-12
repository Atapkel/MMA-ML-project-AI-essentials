"""Download OpenPowerlifting (public domain) and keep a compact strength table.

Used to learn how maximal strength scales with bodyweight, sex and age.
The full archive (~170 MB zip, ~800 MB CSV) is downloaded once, its SHA-256 is
recorded, and only raw full-power (squat/bench/deadlift) results are kept.
Lifter names are replaced with a salted hash: we never need who lifted.

Usage: python scripts/fetch_openpowerlifting.py
Outputs (data/raw/openpowerlifting/):
  openpowerlifting-latest.zip   original archive (git-ignored; large)
  opl_raw_sbd.csv.gz            filtered table used by the project
  source.json                   URL, download date, sizes, SHA-256 hashes
"""
import datetime
import hashlib
import io
import json
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

URL = 'https://openpowerlifting.gitlab.io/opl-csv/files/openpowerlifting-latest.zip'
OUT = Path(__file__).resolve().parents[1] / 'data' / 'raw' / 'openpowerlifting'
ARCHIVE = OUT / 'openpowerlifting-latest.zip'
TABLE = OUT / 'opl_raw_sbd.csv.gz'
COLUMNS = ['Name', 'Sex', 'Event', 'Equipment', 'Age', 'BodyweightKg', 'Best3SquatKg',
           'Best3BenchKg', 'Best3DeadliftKg', 'TotalKg', 'Place', 'Tested', 'Date']
SALT = 'fightpredict-opl'


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def download():
    if ARCHIVE.exists():
        print(f'using existing {ARCHIVE.name}')
        return
    print(f'downloading {URL} ...', flush=True)
    request = urllib.request.Request(URL, headers={'User-Agent': 'ml-course-project'})
    with urllib.request.urlopen(request, timeout=600) as response, ARCHIVE.open('wb') as handle:
        while block := response.read(1 << 20):
            handle.write(block)
    print(f'saved {ARCHIVE.stat().st_size / 1e6:.1f} MB')


def filter_rows(chunk):
    """Raw, full-power, valid results with bodyweight and total present."""
    keep = (chunk.Event == 'SBD') & (chunk.Equipment == 'Raw') & chunk.Sex.isin(['M', 'F'])
    keep &= chunk.BodyweightKg.notna() & (chunk.TotalKg > 0)
    keep &= ~chunk.Place.astype(str).isin(['DQ', 'DD', 'NS', 'G'])
    chunk = chunk[keep].copy()
    chunk['lifter_id'] = [hashlib.sha256((SALT + n).encode()).hexdigest()[:12] for n in chunk.Name]
    return chunk.drop(columns=['Name', 'Event', 'Equipment'])


def build_table():
    with zipfile.ZipFile(ARCHIVE) as archive:
        member = next(n for n in archive.namelist() if n.endswith('.csv'))
        print(f'reading {member} in chunks ...', flush=True)
        parts, rows_in = [], 0
        with archive.open(member) as raw:
            reader = pd.read_csv(io.TextIOWrapper(raw, encoding='utf-8'), usecols=COLUMNS,
                                 chunksize=250_000, low_memory=False)
            for chunk in reader:
                rows_in += len(chunk)
                parts.append(filter_rows(chunk))
    table = pd.concat(parts, ignore_index=True)
    table.to_csv(TABLE, index=False, compression='gzip')
    print(f'kept {len(table):,} of {rows_in:,} rows -> {TABLE.name} ({TABLE.stat().st_size / 1e6:.1f} MB)')
    return member, rows_in, len(table)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    download()
    member, rows_in, rows_out = build_table()
    source = {
        'url': URL,
        'license': 'Public domain (OpenPowerlifting data); attribution encouraged: https://www.openpowerlifting.org',
        'downloaded': datetime.date.today().isoformat(),
        'archive_bytes': ARCHIVE.stat().st_size,
        'archive_sha256': sha256(ARCHIVE),
        'archive_member': member,
        'rows_in_archive': rows_in,
        'filter': 'Event=SBD, Equipment=Raw, Sex in M/F, bodyweight present, TotalKg>0, not DQ/DD/NS/G; Name -> salted hash',
        'table': TABLE.name,
        'table_rows': rows_out,
        'table_sha256': sha256(TABLE),
    }
    (OUT / 'source.json').write_text(json.dumps(source, indent=2), encoding='utf-8')
    print('wrote source.json')


if __name__ == '__main__':
    main()
