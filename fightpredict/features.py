"""One shared feature contract for training, inference and the manual editor."""
import math
import numpy as np
import pandas as pd

FIELDS = {
    'age': {'label': 'Age', 'unit': 'years', 'min': 16, 'max': 65, 'step': 1},
    'height_cm': {'label': 'Height', 'unit': 'cm', 'min': 130, 'max': 235, 'step': .1},
    'reach_cm': {'label': 'Reach', 'unit': 'cm', 'min': 130, 'max': 250, 'step': .1},
    'weight_kg': {'label': 'Weight', 'unit': 'kg', 'min': 40, 'max': 140, 'step': .1},
    'wins': {'label': 'Prior UFC wins', 'unit': 'wins', 'min': 0, 'max': 100, 'step': 1},
    'losses': {'label': 'Prior UFC losses', 'unit': 'losses', 'min': 0, 'max': 100, 'step': 1},
    'win_streak': {'label': 'Current UFC win streak', 'unit': 'fights', 'min': 0, 'max': 100, 'step': 1},
    'lose_streak': {'label': 'Current UFC losing streak', 'unit': 'fights', 'min': 0, 'max': 100, 'step': 1},
    'striking_accuracy': {'label': 'Significant strike accuracy', 'unit': '%', 'min': 0, 'max': 100, 'step': .1},
    'takedown_accuracy': {'label': 'Takedown accuracy', 'unit': '%', 'min': 0, 'max': 100, 'step': .1},
}
BASE_FIELDS = list(FIELDS)
FEATURE_NAMES = [x + '_diff' for x in BASE_FIELDS] + ['experience_diff', 'smoothed_win_rate_diff']
LABELS = {x + '_diff': v['label'] for x, v in FIELDS.items()}
LABELS.update(experience_diff='Prior UFC experience', smoothed_win_rate_diff='Smoothed UFC win rate')

def validate_fighter(data):
    if not isinstance(data, dict):
        raise ValueError('Each fighter must be an object.')
    unknown = set(data) - set(FIELDS) - {'name', 'gender', 'weight_class', 'snapshot_date', 'id'}
    if unknown:
        raise ValueError('Unknown fighter fields: ' + ', '.join(sorted(unknown)))
    clean = {}
    for field, spec in FIELDS.items():
        value = data.get(field)
        if value is None or value == '':
            clean[field] = None
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{spec['label']} must be a number or null.")
        if not math.isfinite(value) or not spec['min'] <= value <= spec['max']:
            raise ValueError(f"{spec['label']} must be between {spec['min']} and {spec['max']} {spec['unit']}.")
        if spec['step'] == 1 and int(value) != value:
            raise ValueError(f"{spec['label']} must be a whole number.")
        clean[field] = float(value)
    for key in ('name', 'gender', 'weight_class', 'snapshot_date', 'id'):
        value = data.get(key, '')
        if not isinstance(value, str) or len(value) > 150:
            raise ValueError(f'{key} must be a short string.')
        clean[key] = value
    for streak, total in [('win_streak', 'wins'), ('lose_streak', 'losses')]:
        if clean[streak] is not None and clean[total] is not None and clean[streak] > clean[total]:
            raise ValueError(f'{FIELDS[streak]["label"]} cannot exceed {FIELDS[total]["label"]}.')
    if clean['win_streak'] and clean['lose_streak']:
        raise ValueError('Winning and losing streaks cannot both be positive.')
    if sum(clean[x] is not None for x in BASE_FIELDS) < 6:
        raise ValueError('Provide at least six numeric characteristics for each fighter.')
    return clean

def feature_vector(a, b):
    def num(f, k):
        v = f.get(k)
        return np.nan if v is None else float(v)
    values = [num(a, k) - num(b, k) for k in BASE_FIELDS]
    aw, al, bw, bl = [num(f, k) for f, k in [(a, 'wins'), (a, 'losses'), (b, 'wins'), (b, 'losses')]]
    values += [aw + al - bw - bl, (aw + 1)/(aw + al + 2) - (bw + 1)/(bw + bl + 2)]
    return np.array(values, dtype=float)

def pair_frame(pairs):
    return pd.DataFrame([feature_vector(a, b) for a, b in pairs], columns=FEATURE_NAMES)

def symmetric_probability(pipeline, x):
    """Remove corner assignment bias and guarantee p(A,B) = 1 - p(B,A)."""
    return (pipeline.predict_proba(x)[:, 1] + 1 - pipeline.predict_proba(-x)[:, 1])/2

def apply_temperature(probabilities, slope):
    p = np.clip(np.asarray(probabilities), 1e-6, 1-1e-6)
    z = np.clip(slope * np.log(p/(1-p)), -35, 35)
    return 1/(1+np.exp(-z))
