"""Dataset audit and strictly past-only reconstruction of UFC career records."""
from collections import defaultdict, Counter
from pathlib import Path
import hashlib
import json
import re
import unicodedata
import urllib.request
import numpy as np
import pandas as pd
from features import BASE_FIELDS, FIELDS, pair_frame

ROOT = Path(__file__).resolve().parent
RAW = ROOT/'data'/'raw'
SOURCE = 'https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/data/2026/2026-07-07/'
FILES = ['ultimate_ufc_dataset.csv', 'ufc_fights.csv', 'ufcstats_data.csv', 'readme.md']

def download(force=False):
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = []
    for name in FILES:
        path = RAW/name
        if force or not path.exists():
            with urllib.request.urlopen(SOURCE+name, timeout=60) as response:
                path.write_bytes(response.read())
        blob = path.read_bytes()
        manifest.append({'file': name, 'url': SOURCE+name, 'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()})
    (RAW/'sources.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')

def name_key(name):
    text = unicodedata.normalize('NFKD', str(name)).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', text)

def record():
    return {'wins': 0, 'losses': 0, 'win_streak': 0, 'lose_streak': 0}

def update_record(state, result):
    if result == 'W':
        state['wins'] += 1; state['win_streak'] += 1; state['lose_streak'] = 0
    elif result == 'L':
        state['losses'] += 1; state['lose_streak'] += 1; state['win_streak'] = 0
    else:
        state['win_streak'] = state['lose_streak'] = 0

def prepare():
    download()
    source = pd.read_csv(RAW/'ultimate_ufc_dataset.csv')
    history = pd.read_csv(RAW/'ufc_fights.csv')
    # Entity resolution only: same event date + the exact same opposing athlete.
    # This does not use outcomes or performance features. Accept a name alias only
    # when it has one unambiguous candidate across all matched event/opponent pairs.
    daily_raw = {day: group for day, group in history.groupby('date')}
    candidates = defaultdict(Counter)
    alias_display = {}
    for row in source.itertuples():
        matches = daily_raw.get(row.date)
        if matches is None: continue
        a, b = name_key(row.r_fighter), name_key(row.b_fighter)
        for other in matches.itertuples():
            c, d = name_key(other.f1_name), name_key(other.f2_name)
            for key, target, old_name, new_name in [
                (b, d, row.b_fighter, other.f2_name) if a == c else ('', '', '', ''),
                (b, c, row.b_fighter, other.f1_name) if a == d else ('', '', '', ''),
                (a, d, row.r_fighter, other.f2_name) if b == c else ('', '', '', ''),
                (a, c, row.r_fighter, other.f1_name) if b == d else ('', '', '', ''),
            ]:
                if key and key != target:
                    candidates[key][target] += 1
                    alias_display[key] = {'source_name': old_name, 'history_name': new_name}
    aliases = {key: next(iter(counts)) for key, counts in candidates.items() if len(counts) == 1}
    def canonical(name):
        key = name_key(name); seen = set()
        while key in aliases and key not in seen:
            seen.add(key); key = aliases[key]
        return key
    raw_rows = len(source)
    source['date'] = pd.to_datetime(source.date, errors='coerce')
    source = source[source.winner.isin(['Red', 'Blue']) & source.date.notna()].copy()
    source['bout_key'] = source.apply(lambda r: '|'.join(sorted([canonical(r.r_fighter), canonical(r.b_fighter)])), axis=1)
    before = len(source)
    source = source.drop_duplicates(['date', 'bout_key']).sort_values(['date', 'bout_key']).reset_index(drop=True)
    history['date'] = pd.to_datetime(history.date, errors='coerce')
    history = history[history.date.notna()].copy()
    history['bout_key'] = history.apply(lambda r: '|'.join(sorted([canonical(r.f1_name), canonical(r.f2_name)])), axis=1)
    history = history.drop_duplicates(['date', 'bout_key']).sort_values(['date', 'bout_key'])
    daily_history = {day: group for day, group in history.groupby('date')}
    daily_source = {day: group for day, group in source.groupby('date')}
    states = defaultdict(record)
    pairs, metadata, catalog = [], [], {}
    conflicts = 0; unmatched = 0; cleaned = defaultdict(int)
    for day in sorted(set(daily_history) | set(daily_source)):
        h = daily_history.get(day)
        results = {}
        if h is not None:
            for r in h.itertuples():
                results[r.bout_key] = {canonical(r.f1_name): r.f1_result, canonical(r.f2_name): r.f2_result}
        group = daily_source.get(day)
        if group is not None:
            for _, row in group.iterrows():
                bout_results = results.get(row.bout_key)
                if bout_results is None:
                    unmatched += 1
                    continue
                elif bout_results.get(canonical(row.r_fighter)) != ('W' if row.winner == 'Red' else 'L'):
                    conflicts += 1
                    continue
                fighters = []
                for corner in ('r', 'b'):
                    name = row[corner+'_fighter']
                    athlete = {
                        'id': canonical(name), 'name': name,
                        'weight_class': row.weight_class, 'gender': row.gender,
                        'snapshot_date': day.strftime('%Y-%m-%d'),
                        'age': row[corner+'_age'], 'height_cm': row[corner+'_height_cms'],
                        'reach_cm': row[corner+'_reach_cms'], 'weight_kg': row[corner+'_weight_lbs']*0.45359237,
                        'striking_accuracy': row[corner+'_avg_sig_str_pct']*100,
                        'takedown_accuracy': row[corner+'_avg_td_pct']*100,
                        **dict(states[canonical(name)]),
                    }
                    for key in BASE_FIELDS:
                        value = athlete[key]
                        spec = FIELDS[key]
                        if not pd.isna(value) and not spec['min'] <= value <= spec['max']:
                            cleaned[key] += 1; value = np.nan
                        athlete[key] = None if pd.isna(value) else float(value)
                    fighters.append(athlete)
                    catalog[athlete['id']] = athlete
                pairs.append(fighters)
                metadata.append({'date': day.strftime('%Y-%m-%d'), 'fighter_a': row.r_fighter, 'fighter_b': row.b_fighter,
                                 'weight_class': row.weight_class, 'gender': row.gender, 'winner_a': int(row.winner == 'Red')})
        # No result from this calendar day is available to any prediction on that day.
        if h is not None:
            for r in h.itertuples():
                update_record(states[canonical(r.f1_name)], r.f1_result)
                update_record(states[canonical(r.f2_name)], r.f2_result)
    x = pair_frame(pairs); meta = pd.DataFrame(metadata); y = meta.winner_a.to_numpy()
    audit = {'raw_bouts': raw_rows, 'usable_bouts': len(y), 'excluded_nonbinary_or_invalid_date': raw_rows-before,
             'duplicate_unordered_bouts_removed': before-len(source), 'conflicting_outcomes_removed': conflicts,
             'unmatched_bouts_removed': unmatched, 'resolved_name_aliases': len(aliases),
             'name_aliases': [dict(alias_display[key], event_opponent_matches=sum(candidates[key].values())) for key in sorted(aliases)],
             'history_rows': len(history), 'athletes': len(catalog),
             'date_min': meta.date.min(), 'date_max': meta.date.max(), 'original_red_win_rate': float(y.mean()),
             'invalid_values_set_missing': dict(cleaned), 'feature_missing_fraction': x.isna().mean().to_dict(),
             'excluded_fields': ['fighter names/IDs', 'odds and EV', 'rankings', 'finish/finish_details/finish_round',
                                 'finish_round_time/total_fight_time_secs', 'snapshot career records',
                                 'avg_sig_str_landed/avg_td_landed/avg_sub_att (mixed units)', 'current athlete career statistics'],
             'records_policy': 'UFC wins/losses and streaks reconstructed from ufc_fights dated strictly before the bout day; D/NC reset streaks.',
             'accuracy_provenance': 'Provided historical pre-bout accuracy columns; source timing cannot be independently certified.'}
    return x, y, meta, sorted(catalog.values(), key=lambda f: f['name']), audit

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(); parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args(); download(force=args.refresh)
    print(json.dumps(prepare()[-1], indent=2))
