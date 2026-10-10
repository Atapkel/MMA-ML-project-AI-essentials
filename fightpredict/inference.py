"""Load the actual trained artifact and explain predictions by feature sensitivity."""
from datetime import date
from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
import sklearn
from features import FIELDS, BASE_FIELDS, FEATURE_NAMES, LABELS, feature_vector, validate_fighter, symmetric_probability, apply_temperature

ROOT = Path(__file__).resolve().parent

class Predictor:
    def __init__(self, model_path=None):
        # Load only a trusted local artifact. joblib files execute Python when loaded.
        self.bundle = joblib.load(model_path or ROOT/'models'/'fightpredict.joblib')
        if self.bundle['sklearn_version'] != sklearn.__version__:
            raise RuntimeError(f"Model needs scikit-learn {self.bundle['sklearn_version']}; installed {sklearn.__version__}. Install requirements.txt.")
        if self.bundle['feature_names'] != FEATURE_NAMES:
            raise RuntimeError('Model feature contract differs from this application; retrain.')
        self.pipeline = self.bundle['pipeline']
        self.catalog = json.loads((ROOT/'models'/'fighters.json').read_text(encoding='utf-8'))
        self.metrics = json.loads((ROOT/'reports'/'metrics.json').read_text(encoding='utf-8'))

    def probability(self, x):
        return apply_temperature(symmetric_probability(self.pipeline, x), self.bundle['calibration_slope'])

    def predict(self, first, second):
        a, b = validate_fighter(first), validate_fighter(second)
        if a['id'] and a['id'] == b['id']:
            raise ValueError('Select two different fighters.')
        if a['gender'] and b['gender'] and a['gender'] != b['gender']:
            raise ValueError('Select fighters from the same gender category; mixed categories are outside the supported task.')
        vector = feature_vector(a, b)
        x = pd.DataFrame([vector], columns=FEATURE_NAMES)
        p = float(self.probability(x)[0])
        notes = []; missing = []
        for label, fighter in [('A', a), ('B', b)]:
            absent = [FIELDS[k]['label'] for k in BASE_FIELDS if fighter[k] is None]
            if absent: missing.append({'fighter': label, 'fields': absent})
            if fighter['snapshot_date']:
                try:
                    snapshot = date.fromisoformat(fighter['snapshot_date'])
                    if (date.today()-snapshot).days > 365:
                        notes.append(f"Fighter {label} uses an older pre-bout snapshot ({snapshot}); this is a historical what-if comparison.")
                except ValueError:
                    raise ValueError('snapshot_date must use YYYY-MM-DD.')
        if missing:
            notes.append('Some differences are missing and use medians learned on training data. Missing values reduce the information available.')
        if a['weight_class'] and b['weight_class'] and a['weight_class'] != b['weight_class']:
            notes.append('Different weight divisions: this matchup is outside the normal same-division training setting.')
        if a['weight_kg'] is not None and b['weight_kg'] is not None and abs(a['weight_kg']-b['weight_kg']) > 8:
            notes.append('Large weight difference: probabilities may not transfer reliably to this hypothetical matchup.')
        outside = []
        for key, value in zip(FEATURE_NAMES, vector):
            limits = self.bundle['training_feature_ranges'][key]
            if np.isfinite(value) and not limits['p01'] <= value <= limits['p99']:
                outside.append(LABELS[key])
        if outside:
            notes.append('Unusual feature differences relative to the central 98% of training data: '+', '.join(outside)+'.')
        # One-at-a-time neutralization. These effects are not additive or causal.
        alternatives = []
        active = []
        for i, value in enumerate(vector):
            if np.isfinite(value) and abs(value) > 1e-10:
                candidate = vector.copy(); candidate[i] = 0
                alternatives.append(candidate); active.append(i)
        sensitivity = []
        if alternatives:
            changed = self.probability(pd.DataFrame(alternatives, columns=FEATURE_NAMES))
            for i, neutral in zip(active, changed):
                sensitivity.append({'feature': FEATURE_NAMES[i], 'label': LABELS[FEATURE_NAMES[i]],
                                    'difference_a_minus_b': float(vector[i]),
                                    'effect_percentage_points': float((p-neutral)*100),
                                    'neutralized_probability_a': float(neutral)})
        sensitivity.sort(key=lambda row: abs(row['effect_percentage_points']), reverse=True)
        return {'fighter_a': a['name'] or 'Fighter A', 'fighter_b': b['name'] or 'Fighter B',
                'probability_a': p, 'probability_b': 1-p,
                'favored': 'Balanced' if abs(p-.5) < .005 else ('A' if p > .5 else 'B'),
                'model': self.bundle['selected_model'], 'warnings': notes, 'missing': missing,
                'sensitivity': sensitivity[:6],
                'explanation_method': 'Change one feature difference to zero and recalculate. Positive effects favor A. Correlated features overlap; effects are not additive or causal.',
                'scope': 'Estimated A/B winner probability conditional on a decisive UFC outcome; draws and no contests are excluded.'}
