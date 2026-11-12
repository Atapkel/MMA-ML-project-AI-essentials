"""Clean every raw dataset into a tidy table under data/processed/.

Each dataset answers one question the game needs:
  UFC bouts            -> does skill/style (striking, wrestling, grappling, experience) win fights?
  UFC fighters         -> how long is someone's reach, given height and weight?
  Sumo bouts           -> how much does being heavier/stronger help when there are no weight classes?
  ADCC absolute bouts  -> does that size effect hold in a skilled open-weight combat sport?
  Body Performance     -> what do sit-ups / broad jump say about someone's strength and fitness?
  OpenPowerlifting     -> how does strength scale with bodyweight, sex and age?

Run: python -m arena.prep
"""
import json

import numpy as np
import pandas as pd

from arena.paths import PROCESSED, RAW

# Style statistics in the UFC source. Volumes change units in 2019, so every
# style statistic is turned into a within-year percentile (0..1) of all fighters.
UFC_STYLE = {
    'str_vol': 'avg_sig_str_landed',
    'str_acc': 'avg_sig_str_pct',
    'td_vol': 'avg_td_landed',
    'td_acc': 'avg_td_pct',
    'sub': 'avg_sub_att',
}
FINISH_GROUPS = {'KO/TKO': 'KO', 'SUB': 'SUB', 'U-DEC': 'DEC', 'S-DEC': 'DEC', 'M-DEC': 'DEC'}

# ADCC records the weight class entered, not the athlete's weight. We use a typical
# competition weight just under each limit; open-ended classes use a typical value.
ADCC_CLASS_KG = {'60KG': 59, '+60KG': 68, '66KG': 65, '77KG': 76, '88KG': 87, '99KG': 98, '+99KG': 110}


def percentile_within_year(values, years):
    """Rank of each value among all values from the same year, scaled to 0..1."""
    frame = pd.DataFrame({'v': values, 'y': years})
    return frame.groupby('y')['v'].rank(pct=True).to_numpy()


def prep_ufc():
    """Bouts with both fighters' pre-fight profiles, and a per-fighter physical table."""
    df = pd.read_csv(RAW / 'ultimate_ufc_dataset.csv')
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df[df['winner'].isin(['Red', 'Blue']) & df['date'].notna()].copy()
    df['year'] = df['date'].dt.year

    # Percentiles are computed over both corners together, per year.
    for name, column in UFC_STYLE.items():
        both = pd.concat([df['r_' + column], df['b_' + column]], ignore_index=True)
        years = pd.concat([df['year'], df['year']], ignore_index=True)
        pct = percentile_within_year(both, years)
        df['r_' + name] = pct[:len(df)]
        df['b_' + name] = pct[len(df):]
        df.loc[df['r_' + column].isna(), 'r_' + name] = np.nan
        df.loc[df['b_' + column].isna(), 'b_' + name] = np.nan

    # Experience: rounds fought in the UFC, as a percentile over all corners (stable units).
    rounds = pd.concat([df['r_total_rounds_fought'], df['b_total_rounds_fought']], ignore_index=True)
    exp_pct = rounds.rank(pct=True).to_numpy()
    df['r_exp'], df['b_exp'] = exp_pct[:len(df)], exp_pct[len(df):]

    stance = {'Orthodox': 0.0, 'Southpaw': 1.0, 'Switch': 0.5, 'Open Stance': 0.5}
    out = pd.DataFrame({'date': df['date'], 'year': df['year'], 'gender': df['gender'],
                        'red_win': (df['winner'] == 'Red').astype(int),
                        'finish': df['finish'].map(FINISH_GROUPS)})
    for corner in ('r', 'b'):
        for name in list(UFC_STYLE) + ['exp']:
            out[f'{corner}_{name}'] = df[f'{corner}_{name}']
        out[f'{corner}_height'] = df[f'{corner}_height_cms']
        out[f'{corner}_reach'] = df[f'{corner}_reach_cms']
        out[f'{corner}_age'] = df[f'{corner}_age']
        out[f'{corner}_southpaw'] = df[f'{corner}_stance'].map(stance).fillna(0.0)
    before = len(out)
    out = out.dropna(subset=[c for c in out.columns if c != 'finish']).reset_index(drop=True)
    out.to_csv(PROCESSED / 'ufc_bouts.csv', index=False)

    # One row per fighter for the reach model (latest record of each fighter).
    fighters = []
    for corner in ('r', 'b'):
        part = df[[f'{corner}_fighter', 'gender', 'date', f'{corner}_height_cms', f'{corner}_reach_cms',
                   f'{corner}_weight_lbs']].copy()
        part.columns = ['name', 'gender', 'date', 'height', 'reach', 'weight_lbs']
        fighters.append(part)
    fighters = pd.concat(fighters).sort_values('date').drop_duplicates('name', keep='last')
    fighters['weight'] = fighters['weight_lbs'] * 0.453592
    fighters['sex'] = np.where(fighters['gender'] == 'FEMALE', 'F', 'M')
    fighters = fighters[(fighters['height'].between(140, 225)) & (fighters['reach'].between(140, 230))]
    fighters[['sex', 'height', 'weight', 'reach']].to_csv(PROCESSED / 'ufc_fighters.csv', index=False)
    return {'ufc_bouts': len(out), 'ufc_bouts_dropped_missing_stats': before - len(out),
            'ufc_fighters': len(fighters)}


def month_index(basho_id):
    basho_id = pd.Series(basho_id).astype(int)
    return (basho_id // 100) * 12 + basho_id % 100


def prep_sumo():
    """Bouts with both wrestlers' weight, height, age and banzuke position."""
    folder = RAW / 'sumo'
    bouts = pd.read_csv(folder / 'bouts.csv')
    bouts = bouts[bouts['result_type'] == 'bout'].copy()  # forfeits (fusen) say nothing about size
    meas = pd.read_csv(folder / 'measurements.csv').drop_duplicates()
    meas = meas[(meas['weight'] > 40) & (meas['height'] > 140)]
    profiles = pd.read_csv(folder / 'rikishi.csv')
    birth = pd.to_datetime(profiles.set_index('id')['birthDate'], errors='coerce').dt.tz_localize(None)
    banzuke = pd.read_csv(folder / 'banzuke.csv')

    bouts['m'] = month_index(bouts['basho_id']).to_numpy()
    meas['m'] = month_index(meas['bashoId']).to_numpy()
    meas = meas.sort_values('m')
    order = banzuke.set_index(['basho_id', 'rikishi_id'])['banzuke_order']

    for side in ('a', 'b'):
        key = f'rikishi_{side}'
        left = bouts[['m', key]].reset_index().sort_values('m')
        right = meas[['m', 'rikishiId', 'height', 'weight']]
        # The API records a measurement only when it changes, so the latest earlier one is current.
        # Before a wrestler's first record, use the first one if it is within a year.
        merged = pd.merge_asof(left, right, on='m', left_by=key, right_by='rikishiId', direction='backward')
        ahead = pd.merge_asof(left, right, on='m', left_by=key, right_by='rikishiId', direction='forward',
                              tolerance=12)
        merged = merged.set_index('index')
        ahead = ahead.set_index('index')
        for col in ('height', 'weight'):
            merged[col] = merged[col].fillna(ahead[col])
        bouts[f'{side}_weight'] = merged['weight']
        bouts[f'{side}_height'] = merged['height']
        basho_date = pd.to_datetime(bouts['basho_id'].astype(str) + '15', format='%Y%m%d')
        bouts[f'{side}_age'] = (basho_date - bouts[key].map(birth)).dt.days / 365.25
        bouts[f'{side}_order'] = [order.get((b, r), np.nan) for b, r in zip(bouts['basho_id'], bouts[key])]

    bouts['a_win'] = (bouts['winner'] == bouts['rikishi_a']).astype(int)
    before = len(bouts)
    cols = ['basho_id', 'division', 'a_weight', 'b_weight', 'a_height', 'b_height', 'a_age', 'b_age',
            'a_order', 'b_order', 'a_win']
    out = bouts[cols].dropna().reset_index(drop=True)
    out = out[out['a_age'].between(15, 45) & out['b_age'].between(15, 45)]
    out.to_csv(PROCESSED / 'sumo_bouts.csv', index=False)
    return {'sumo_bouts': len(out), 'sumo_bouts_dropped_missing': before - len(out)}


def prep_adcc():
    """Open-weight (absolute) ADCC matches where both athletes' weight class is known."""
    df = pd.read_csv(RAW / 'adcc_historical_data.csv', sep=None, engine='python')
    entered = df[df['weight_class'] != 'ABS']
    weight_of = {}
    for row in entered.itertuples():
        for athlete in (row.winner_id, row.loser_id):
            weight_of[(row.year, athlete)] = ADCC_CLASS_KG.get(row.weight_class)
    absolute = df[df['weight_class'] == 'ABS'].copy()
    absolute['winner_kg'] = [weight_of.get((y, a)) for y, a in zip(absolute['year'], absolute['winner_id'])]
    absolute['loser_kg'] = [weight_of.get((y, a)) for y, a in zip(absolute['year'], absolute['loser_id'])]
    out = absolute.dropna(subset=['winner_kg', 'loser_kg'])
    out = out[['year', 'sex', 'winner_kg', 'loser_kg', 'win_type']].reset_index(drop=True)
    out.to_csv(PROCESSED / 'adcc_absolute.csv', index=False)
    return {'adcc_absolute_matches': int((df['weight_class'] == 'ABS').sum()), 'adcc_absolute_usable': len(out)}


def prep_body_performance():
    """Fitness tests; implausible zero/extreme readings removed."""
    df = pd.read_csv(RAW / 'bodyPerformance.csv')
    df = df.rename(columns={'gender': 'sex', 'height_cm': 'height', 'weight_kg': 'weight', 'body fat_%': 'body_fat',
                            'gripForce': 'grip', 'sit and bend forward_cm': 'flex', 'sit-ups counts': 'situps',
                            'broad jump_cm': 'jump', 'class': 'fitness_class'})
    before = len(df)
    df = df[(df['grip'] > 0) & (df['jump'] > 0) & df['height'].between(130, 210) & df['weight'].between(30, 160)]
    df = df[df['situps'].between(0, 90) & df['jump'].between(30, 330)]
    cols = ['age', 'sex', 'height', 'weight', 'body_fat', 'grip', 'situps', 'jump', 'fitness_class']
    df[cols].to_csv(PROCESSED / 'body_performance.csv', index=False)
    return {'body_performance': len(df), 'body_performance_dropped': before - len(df)}


def prep_powerlifting():
    """Each lifter's best raw total, with sex, age and bodyweight at that meet."""
    df = pd.read_csv(RAW / 'openpowerlifting' / 'opl_raw_sbd.csv.gz',
                     usecols=['lifter_id', 'Sex', 'Age', 'BodyweightKg', 'TotalKg'],
                     dtype={'Sex': 'category', 'Age': 'float32', 'BodyweightKg': 'float32', 'TotalKg': 'float32'})
    before = len(df)
    df = df.dropna(subset=['Age'])
    df = df[df['Age'].between(16, 70) & df['BodyweightKg'].between(40, 200)]
    best = df.sort_values('TotalKg').drop_duplicates('lifter_id', keep='last')
    best = best.rename(columns={'Sex': 'sex', 'Age': 'age', 'BodyweightKg': 'weight', 'TotalKg': 'total'})
    best[['sex', 'age', 'weight', 'total']].to_csv(PROCESSED / 'powerlifting_best.csv', index=False)
    return {'powerlifting_results': before, 'powerlifting_lifters': len(best)}


def main():
    PROCESSED.mkdir(parents=True, exist_ok=True)
    summary = {}
    for step in (prep_ufc, prep_sumo, prep_adcc, prep_body_performance, prep_powerlifting):
        result = step()
        print(step.__name__, result, flush=True)
        summary.update(result)
    (PROCESSED / 'summary.json').write_text(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
