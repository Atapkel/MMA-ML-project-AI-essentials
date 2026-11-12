"""Download sumo bouts and wrestler measurements from sumo-api.com.

Sumo has no weight classes, so its bouts show how weight/height gaps affect
who wins. Responses are cached under data/raw/sumo/cache/ so the script can be
re-run or resumed without hitting the API again.

Usage: python scripts/fetch_sumo.py [first_basho YYYYMM] [last_basho YYYYMM]
       SUMO_OFFLINE=1 python scripts/fetch_sumo.py   # rebuild CSVs from cache only
Height/weight history in the API starts around 2003, so the default range is 2000-01..2026-09.
Outputs (data/raw/sumo/):
  rikishi.csv       one row per wrestler (profile)
  measurements.csv  height/weight history (one row per change, by basho)
  bouts.csv         one row per bout (deduplicated), with result and kimarite
  banzuke.csv       each wrestler's rank per basho (skill control for the size model)
"""
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://www.sumo-api.com/api'
OUT = Path(__file__).resolve().parents[1] / 'data' / 'raw' / 'sumo'
CACHE = OUT / 'cache'
DIVISIONS = ['Makuuchi', 'Juryo', 'Makushita', 'Sandanme', 'Jonidan', 'Jonokuchi']
PAUSE = 0.25  # seconds between live requests, to be gentle on a free API


def get_json(path, cache_name):
    """GET API path, using an on-disk cache. Retries transient failures."""
    cached = CACHE / cache_name
    if cached.exists():
        return json.loads(cached.read_text(encoding='utf-8'))
    if os.environ.get('SUMO_OFFLINE'):  # rebuild CSVs from the cache only, no network
        return [] if path.startswith('/measurements') else {}
    request = urllib.request.Request(API + path, headers={'User-Agent': 'ml-course-project'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = json.loads(response.read().decode('utf-8'))
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            wait = 2 ** attempt
            print(f'  retry {attempt + 1} for {path} in {wait}s ({error})', flush=True)
            time.sleep(wait)
    else:
        raise RuntimeError(f'failed to fetch {path}')
    cached.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    time.sleep(PAUSE)
    return data


def basho_ids(first, last):
    """Tournament ids (YYYYMM, odd months) from first to last inclusive."""
    ids = []
    for year in range(int(first[:4]), int(last[:4]) + 1):
        for month in (1, 3, 5, 7, 9, 11):
            basho = f'{year}{month:02d}'
            if first <= basho <= last:
                ids.append(basho)
    return ids


def fetch_rikishi():
    """All wrestler profiles (active and retired)."""
    records, skip = [], 0
    while True:
        data = get_json(f'/rikishis?intai=true&limit=1000&skip={skip}', f'rikishis_{skip}.json')
        batch = data.get('records') or []
        records.extend(batch)
        skip += len(batch)
        print(f'rikishi: {skip}/{data.get("total")}', flush=True)
        if not batch or skip >= data.get('total', 0):
            return records


def fetch_measurements(bashos):
    """Height/weight changes recorded at each basho (API pages by 100)."""
    rows = []
    for basho in bashos:
        skip = 0
        while True:
            batch = get_json(f'/measurements?bashoId={basho}&limit=100&skip={skip}',
                             f'measurements_{basho}_{skip}.json')
            rows.extend(batch)
            if len(batch) < 100:
                break
            skip += 100
    print(f'measurements: {len(rows)} rows', flush=True)
    return rows


def fetch_bouts(bashos):
    """Bouts from every banzuke (division ranking with each wrestler's record)."""
    bouts, ranks = {}, []
    for basho in bashos:
        found, order = 0, 0
        for division in DIVISIONS:
            data = get_json(f'/basho/{basho}/banzuke/{division}', f'banzuke_{basho}_{division}.json')
            entries = sorted((data.get('east') or []) + (data.get('west') or []),
                             key=lambda e: (e.get('rankValue') or 9999, e.get('side') != 'East'))
            for entry in entries:
                order += 1  # position on the whole banzuke: 1 = top-ranked wrestler
                ranks.append({'basho_id': basho, 'division': division, 'rikishi_id': entry['rikishiID'],
                              'rank': entry.get('rank', ''), 'rank_value': entry.get('rankValue'),
                              'banzuke_order': order})
            for side in ('east', 'west'):
                for entry in data.get(side) or []:
                    for day, bout in enumerate(entry.get('record') or [], start=1):
                        opponent = bout.get('opponentID') or 0
                        if not opponent or bout.get('result') not in ('win', 'loss', 'fusen win', 'fusen loss'):
                            continue
                        me = entry['rikishiID']
                        won = bout['result'].endswith('win')
                        key = (basho, day, min(me, opponent), max(me, opponent))
                        if key in bouts:
                            continue
                        found += 1
                        bouts[key] = {
                            'basho_id': basho, 'division': division, 'day': day,
                            'rikishi_a': me, 'rank_a': entry.get('rank', ''),
                            'rikishi_b': opponent,
                            'winner': me if won else opponent,
                            'result_type': 'fusen' if 'fusen' in bout['result'] else 'bout',
                            'kimarite': bout.get('kimarite', ''),
                        }
        print(f'{basho}: {found} bouts (total {len(bouts)})', flush=True)
    return list(bouts.values()), ranks


def write_csv(path, rows, fields):
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
    print(f'wrote {path.relative_to(OUT.parents[2])}: {len(rows)} rows')


def main():
    first = sys.argv[1] if len(sys.argv) > 1 else '200001'
    last = sys.argv[2] if len(sys.argv) > 2 else '202609'
    CACHE.mkdir(parents=True, exist_ok=True)
    bashos = basho_ids(first, last)

    rikishi = fetch_rikishi()
    write_csv(OUT / 'rikishi.csv', rikishi,
              ['id', 'shikonaEn', 'heya', 'birthDate', 'shusshin', 'height', 'weight', 'debut', 'intai'])
    measurements = fetch_measurements(bashos)
    write_csv(OUT / 'measurements.csv', measurements, ['rikishiId', 'bashoId', 'height', 'weight'])
    bouts, ranks = fetch_bouts(bashos)
    write_csv(OUT / 'banzuke.csv', ranks, ['basho_id', 'division', 'rikishi_id', 'rank', 'rank_value', 'banzuke_order'])
    write_csv(OUT / 'bouts.csv', bouts, ['basho_id', 'division', 'day', 'rikishi_a', 'rank_a',
                                         'rikishi_b', 'winner', 'result_type', 'kimarite'])


if __name__ == '__main__':
    main()
