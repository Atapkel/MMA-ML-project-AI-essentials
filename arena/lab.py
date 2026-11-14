"""Build the data behind the AI Lab page and the UFC-twin search. Nothing is trained here.

Every number comes from the models already saved in models/arena_models.joblib, evaluated on the
same held-out test sets train.py used (UFC 2024+, the 20% of people never trained on):

  ROC curve + calibration      skill model, UFC bouts 2024+
  permutation importance       skill, finish, fitness class, grip, strength (shuffle one column of
                               the test set, measure how much the metric gets worse)
  confusion matrices           fitness class A-D, finish method
  strength / size curves       what the strength model and beta imply
  percentile tables            "where you stand" among 330K lifters and 2,241 UFC fighters
  fighter table (k-NN)         latest style profile of every UFC fighter, for the nearest-neighbour twin

Run: python -m arena.lab      (after python -m arena.train; takes a few seconds)
Writes models/ai_lab.json and models/ufc_fighters_knn.json (shipped with the app).
"""
import datetime
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, f1_score, log_loss, mean_absolute_error, roc_auc_score, roc_curve
from sklearn.model_selection import train_test_split

from arena import train as T
from arena.paths import MODEL_FILE, MODELS, PROCESSED, RAW, REPORTS
from arena.prep import UFC_STYLE, percentile_within_year

LAB_FILE = MODELS / 'ai_lab.json'
KNN_FILE = MODELS / 'ufc_fighters_knn.json'
KNN_FEATURES = ['str_vol', 'str_acc', 'td_vol', 'td_acc', 'sub', 'height', 'weight']
LABELS = {
    'str_vol': 'Striking volume', 'str_acc': 'Striking accuracy', 'td_vol': 'Takedown volume',
    'td_acc': 'Takedown accuracy', 'sub': 'Submission attempts', 'exp': 'Experience', 'height': 'Height',
    'reach': 'Reach', 'age': 'Age', 'southpaw': 'Southpaw stance', 'sex_m': 'Sex', 'weight': 'Bodyweight',
    'situps': 'Sit-ups', 'jump': 'Broad jump', 'log_weight': 'Bodyweight',
}
rng = np.random.default_rng(0)


def permutation_importance(score, X, y, names, repeats=8):
    """Mean worsening of `score` (higher = worse) when one column is shuffled."""
    base = score(X, y)
    out = []
    for j, name in enumerate(names):
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = rng.permutation(Xp[:, j])
            drops.append(score(Xp, y) - base)
        out.append({'feature': name, 'label': LABELS.get(name, name), 'value': round(float(np.mean(drops)), 4),
                    'sd': round(float(np.std(drops)), 4)})
    return round(float(base), 4), sorted(out, key=lambda r: -r['value'])


def quantiles(values):
    return np.quantile(np.asarray(values, float), np.linspace(0, 1, 101)).round(1).tolist()


def comparison(metrics):
    """Baseline vs every candidate per task, straight from reports/metrics.json."""
    tasks = [('reach', 'Reach', 'mae_cm', 'MAE, cm', True, metrics['reach']['results'], metrics['reach']['chosen']),
             ('strength', 'Strength', 'mae_kg', 'MAE, kg', True, metrics['strength']['results'], metrics['strength']['chosen']),
             ('grip', 'Grip strength', 'mae_kg', 'MAE, kg', True, metrics['fitness']['grip']['full']['results'],
              metrics['fitness']['grip']['full']['chosen']),
             ('fitness', 'Fitness class A–D', 'f1_macro', 'F1-macro', False, metrics['fitness']['class']['results'],
              metrics['fitness']['class']['chosen']),
             ('skill', 'Who wins (UFC 2024+)', 'test_auc', 'AUC', False, metrics['skill']['results'], metrics['skill']['chosen']),
             ('method', 'Finish method (UFC 2024+)', 'test_f1_macro', 'F1-macro', False, metrics['method']['results'],
              metrics['method']['chosen']),
             ('size', 'Size effect (sumo 2022+)', 'test_log_loss', 'Log loss', True, metrics['size']['results'], metrics['size']['chosen'])]
    out = []
    for key, title, field, metric, lower, rows, chosen in tasks:
        out.append({'task': key, 'title': title, 'metric': metric, 'lower_is_better': lower, 'rows': [
            {'model': r['model'].split(' (not explainable')[0], 'value': r[field],
             'kind': 'baseline' if r['model'].startswith('Baseline') else 'chosen' if r['model'] == chosen else 'candidate'}
            for r in rows if field in r]})
    return out


def skill_section(models, metrics):
    df = pd.read_csv(PROCESSED / 'ufc_bouts.csv')
    _, _, test = T.ufc_split(df)
    coef = np.array(models['skill']['coef'])  # final model: trained on <=2023, so 2024+ is unseen
    D, y = T.diff_matrix(test), test['red_win'].to_numpy()

    def proba(X):
        return 1 / (1 + np.exp(-(X @ coef)))

    p = proba(D)
    fpr, tpr, _ = roc_curve(y, p)
    keep = np.unique(np.linspace(0, len(fpr) - 1, 90).astype(int))
    bins = np.linspace(0, 1, 11)
    idx = np.clip(np.digitize(p, bins) - 1, 0, 9)
    calib = [{'p': round(float(p[idx == i].mean()), 3), 'observed': round(float(y[idx == i].mean()), 3), 'n': int((idx == i).sum())}
             for i in range(10) if (idx == i).sum() >= 20]
    _, imp = permutation_importance(lambda X, y: -roc_auc_score(y, proba(X)), D, y, T.SKILL_FEATURES)
    return {'auc': round(float(roc_auc_score(y, p)), 4), 'log_loss': round(float(log_loss(y, p)), 4), 'n': int(len(y)),
            'red_win_rate': round(float(y.mean()), 3),
            'roc': [[round(float(fpr[i]), 4), round(float(tpr[i]), 4)] for i in keep], 'calibration': calib,
            'importance': imp, 'importance_metric': 'AUC lost when the feature is shuffled',
            'coefficients': [{'feature': f, 'label': LABELS[f], 'value': v} for f, v in metrics['skill']['coefficients_per_sd'].items()]}


def method_section(models):
    df = pd.read_csv(PROCESSED / 'ufc_bouts.csv').dropna(subset=['finish'])
    _, _, test = T.ufc_split(df)
    model, X, y = models['method'], T.method_matrix(test), test['finish'].to_numpy()
    classes = list(model.classes_)
    keys = [f'w_{f}' for f in T.STYLE_FEATURES] + [f'l_{f}' for f in T.STYLE_FEATURES]
    LABELS.update({f'w_{f}': f'Winner: {LABELS[f].lower()}' for f in T.STYLE_FEATURES})
    LABELS.update({f'l_{f}': f'Loser: {LABELS[f].lower()}' for f in T.STYLE_FEATURES})
    _, imp = permutation_importance(lambda X, y: log_loss(y, model.predict_proba(X), labels=classes), X, y, keys)
    cm = confusion_matrix(y, model.predict(X), labels=classes)
    return {'classes': classes, 'confusion': cm.tolist(), 'importance': imp, 'n': int(len(y)),
            'importance_metric': 'log loss added when the feature is shuffled'}


def fitness_section(models):
    df = pd.read_csv(PROCESSED / 'body_performance.csv')
    df['sex_m'] = (df['sex'] == 'M').astype(float)
    cols = ['sex_m', 'age', 'height', 'weight', 'situps', 'jump']
    _, test = train_test_split(df, test_size=0.2, random_state=T.SEED, stratify=df['fitness_class'])
    X = test[cols].to_numpy()
    clf, grip = models['fitness_class'], models['grip_full']
    classes = list(clf.classes_)
    cm = confusion_matrix(test['fitness_class'], clf.predict(X), labels=classes)
    _, imp_cls = permutation_importance(lambda X, y: -f1_score(y, clf.predict(X), average='macro'), X,
                                        test['fitness_class'].to_numpy(), cols, repeats=5)
    _, imp_grip = permutation_importance(lambda X, y: mean_absolute_error(y, grip.predict(X)), X, test['grip'].to_numpy(), cols, repeats=5)
    return {'classes': classes, 'confusion': cm.tolist(), 'n': int(len(test)),
            'importance': imp_cls, 'importance_metric': 'F1-macro lost when the feature is shuffled',
            'grip_importance': imp_grip, 'grip_importance_metric': 'kg of MAE added when the feature is shuffled'}


def strength_section(models):
    df = pd.read_csv(PROCESSED / 'powerlifting_best.csv')
    df['sex_m'] = (df['sex'] == 'M').astype(float)
    X = T.strength_design(df['sex_m'], df['age'], df['weight'])
    y = np.log(df['total'].to_numpy())
    _, Xte, _, yte = train_test_split(X, y, test_size=0.2, random_state=T.SEED)
    sub = np.random.default_rng(1).choice(len(Xte), 30000, replace=False)
    model = models['strength']
    _, imp = permutation_importance(lambda X, y: mean_absolute_error(np.exp(y), np.exp(model.predict(X))),
                                    Xte[sub], yte[sub], ['sex_m', 'age', 'log_weight'], repeats=4)
    grid = np.arange(45, 161, 5.0)
    curve = {sex: np.round(T.predicted_strength(model, s, 28.0, grid)).tolist() for sex, s in (('M', 1.0), ('F', 0.0))}
    ages = np.arange(18, 71, 2.0)
    age_curve = np.round(T.predicted_strength(model, 1.0, ages, 90.0)).tolist()
    return {'n': int(len(df)), 'grid': grid.tolist(), 'curve': curve, 'ages': ages.tolist(), 'age_curve_m90': age_curve,
            'importance': imp, 'importance_metric': 'kg of MAE added when the feature is shuffled',
            'quantiles': {s: quantiles(df.loc[df['sex'] == s, 'total']) for s in ('M', 'F')},
            'counts': {s: int((df['sex'] == s).sum()) for s in ('M', 'F')}}


def size_section(models, metrics):
    beta = models['size']['beta']
    grid = np.arange(50, 131, 2.0)
    ref = T.predicted_strength(models['strength'], 1.0, 28.0, 70.0)
    p = 1 / (1 + np.exp(-beta * np.log(T.predicted_strength(models['strength'], 1.0, 28.0, grid) / ref)))
    adcc = metrics['size']['adcc']
    return {'beta': round(beta, 4), 'beta_sumo': metrics['size']['beta_sumo'], 'scale': adcc['scale_used'],
            'scale_ci': adcc['scale_95ci'], 'adcc_auc': adcc['auc_of_sumo_size_score'], 'grid': grid.tolist(),
            'p_vs_70kg_man': np.round(p, 4).tolist()}


def reach_section(models):
    df = pd.read_csv(PROCESSED / 'ufc_fighters.csv')
    lr = models['reach']
    sd = df[['height', 'weight']].std().to_numpy()
    return {'n': int(len(df)), 'intercept': round(float(lr.intercept_), 2),
            'coef': {'height': round(float(lr.coef_[0]), 3), 'weight': round(float(lr.coef_[1]), 3), 'male': round(float(lr.coef_[2]), 2)},
            'effect_per_sd_cm': {'height': round(float(lr.coef_[0] * sd[0]), 2), 'weight': round(float(lr.coef_[1] * sd[1]), 2)},
            'quantiles': {s: quantiles(df.loc[df['sex'] == s, 'reach']) for s in ('M', 'F')}}


def fighter_table():
    """Latest pre-fight style profile of every UFC fighter, on the same percentile scale as the models."""
    df = pd.read_csv(RAW / 'ultimate_ufc_dataset.csv')
    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df = df[df['winner'].isin(['Red', 'Blue']) & df['date'].notna()].copy()
    df['year'] = df['date'].dt.year
    for name, column in UFC_STYLE.items():  # identical to prep.prep_ufc
        both = pd.concat([df['r_' + column], df['b_' + column]], ignore_index=True)
        years = pd.concat([df['year'], df['year']], ignore_index=True)
        pct = percentile_within_year(both, years)
        df['r_' + name], df['b_' + name] = pct[:len(df)], pct[len(df):]
        df.loc[df['r_' + column].isna(), 'r_' + name] = np.nan
        df.loc[df['b_' + column].isna(), 'b_' + name] = np.nan
    parts = []
    for c, won in (('r', 'Red'), ('b', 'Blue')):
        part = pd.DataFrame({'name': df[f'{c}_fighter'], 'gender': df['gender'], 'date': df['date'], 'wc': df['weight_class'],
                             'height': df[f'{c}_height_cms'], 'weight': df[f'{c}_weight_lbs'] * 0.453592,
                             'wins': df[f'{c}_wins'] + (df['winner'] == won), 'losses': df[f'{c}_losses'] + (df['winner'] != won),
                             **{f: df[f'{c}_{f}'] for f in UFC_STYLE}})
        parts.append(part)
    fighters = pd.concat(parts).sort_values('date').drop_duplicates('name', keep='last')
    fighters = fighters.dropna(subset=KNN_FEATURES)
    fighters = fighters[fighters['height'].between(140, 225)]
    X = fighters[KNN_FEATURES].to_numpy(float)
    return {
        'features': KNN_FEATURES, 'labels': [LABELS[f] for f in KNN_FEATURES],
        'mean': X.mean(0).round(4).tolist(), 'sd': X.std(0).round(4).tolist(),
        'fighters': [{'name': r.name, 'sex': 'F' if r.gender == 'FEMALE' else 'M', 'wc': r.wc, 'year': int(r.date.year),
                      'record': f'{int(r.wins)}-{int(r.losses)}', 'x': [round(float(v), 3) for v in x]}
                     for r, x in zip(fighters.itertuples(), X)],
    }


def main():
    models = joblib.load(MODEL_FILE)
    metrics = json.loads((REPORTS / 'metrics.json').read_text())
    lab = {'built_at': datetime.datetime.now().isoformat(timespec='seconds'), 'models_trained_at': models['trained_at'],
           'comparison': comparison(metrics), 'skill': skill_section(models, metrics), 'method': method_section(models),
           'fitness': fitness_section(models), 'strength': strength_section(models), 'size': size_section(models, metrics),
           'reach': reach_section(models)}
    LAB_FILE.write_text(json.dumps(lab, separators=(',', ':')))
    knn = fighter_table()
    KNN_FILE.write_text(json.dumps(knn, separators=(',', ':'), ensure_ascii=False))
    print(f"saved {LAB_FILE.name} ({LAB_FILE.stat().st_size / 1e3:.0f} KB), {KNN_FILE.name} "
          f"({len(knn['fighters'])} fighters, {KNN_FILE.stat().st_size / 1e3:.0f} KB); skill test AUC {lab['skill']['auc']}")


if __name__ == '__main__':
    main()
