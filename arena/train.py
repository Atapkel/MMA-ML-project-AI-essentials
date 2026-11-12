"""Train, compare and save every model the game uses.

Each task compares a baseline with at least two models on a leakage-free split
(by time for fights, by person for physical data), then keeps the chosen model.

  reach      UFC fighters      height, weight, sex -> reach (cm)                      MAE
  strength   OpenPowerlifting  sex, age, bodyweight -> powerlifting total (kg)        MAE
  grip       Body Performance  body + sit-ups + broad jump -> grip strength (kg)      MAE
  fitness    Body Performance  body + sit-ups + broad jump -> fitness class A-D       F1-macro
  size       Sumo (+ADCC)      strength ratio, rank gap -> who wins open-weight      log loss / AUC
  skill      UFC bouts         style & experience differences -> who wins            log loss / AUC
  method     UFC bouts         winner & loser styles -> KO / submission / decision    log loss / F1

Run: python -m arena.train      (after python -m arena.prep)
"""
import datetime
import io
import json
import pickle
import time

import joblib
import matplotlib
import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, f1_score, log_loss,
                             mean_absolute_error, roc_auc_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures, StandardScaler

from arena.paths import FIGURES, MODEL_FILE, MODELS, PROCESSED, REPORTS

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402  (backend must be set first)

SEED = 42
SKILL_FEATURES = ['str_vol', 'str_acc', 'td_vol', 'td_acc', 'sub', 'exp', 'height', 'reach', 'age', 'southpaw']
STYLE_FEATURES = ['str_vol', 'str_acc', 'td_vol', 'td_acc', 'sub', 'exp']
REFERENCE_AGE = 28.0  # used when a dataset has no age (ADCC)


# ----------------------------------------------------------------------------- helpers

def model_bytes(model):
    """Serialized size of a fitted model, for the size comparison."""
    buffer = io.BytesIO()
    pickle.dump(model, buffer)
    return buffer.tell()


def timed_fit(model, X, y):
    start = time.perf_counter()
    model.fit(X, y)
    return model, round(time.perf_counter() - start, 3)


def symmetric(X, y):
    """Each bout seen from both sides: features negate, label flips. Removes corner bias."""
    return np.vstack([X, -X]), np.concatenate([y, 1 - y])


def binary_scores(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {'log_loss': round(log_loss(y, p, labels=[0, 1]), 4), 'auc': round(roc_auc_score(y, p), 4),
            'accuracy': round(accuracy_score(y, p >= 0.5), 4), 'brier': round(brier_score_loss(y, p), 4)}


def antisymmetric_proba(model, X):
    """P(A wins) averaged over both orientations, so P(A beats B) + P(B beats A) = 1."""
    return 0.5 * (model.predict_proba(X)[:, 1] + 1 - model.predict_proba(-X)[:, 1])


def pair_logit():
    """Logistic regression with no intercept on difference features: antisymmetric by design."""
    return make_pipeline(StandardScaler(with_mean=False), LogisticRegression(fit_intercept=False, C=1.0, max_iter=2000))


def save_fig(fig, name):
    fig.tight_layout()
    fig.savefig(FIGURES / name, dpi=130)
    plt.close(fig)


# ----------------------------------------------------------------------------- reach

def train_reach(report):
    df = pd.read_csv(PROCESSED / 'ufc_fighters.csv')
    df['sex_m'] = (df['sex'] == 'M').astype(float)
    X, y = df[['height', 'weight', 'sex_m']].to_numpy(), df['reach'].to_numpy()
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=SEED)

    offset = float(np.mean(ytr - Xtr[:, 0]))  # baseline: reach = height + average ape index
    rows = [{'model': 'Baseline: height + mean offset', 'mae_cm': round(mean_absolute_error(yte, Xte[:, 0] + offset), 3),
             'fit_s': 0.0, 'size_bytes': 8}]
    candidates = {'Linear regression': LinearRegression(),
                  'Gradient boosting': HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05, random_state=SEED)}
    fitted = {}
    for name, model in candidates.items():
        model, seconds = timed_fit(model, Xtr, ytr)
        fitted[name] = model
        rows.append({'model': name, 'mae_cm': round(mean_absolute_error(yte, model.predict(Xte)), 3),
                     'fit_s': seconds, 'size_bytes': model_bytes(model)})
    best = min(rows[1:], key=lambda r: r['mae_cm'])['model']
    final = candidates[best].fit(X, y)  # refit on all fighters
    report['reach'] = {'data': 'UFC fighters', 'rows': len(df), 'split': '80/20 random by fighter',
                       'metric': 'MAE (cm), lower is better', 'results': rows, 'chosen': best}
    return final


# ----------------------------------------------------------------------------- strength

def strength_design(sex_m, age, weight):
    return np.column_stack([sex_m, age, np.log(weight)])


def train_strength(report):
    df = pd.read_csv(PROCESSED / 'powerlifting_best.csv')
    df['sex_m'] = (df['sex'] == 'M').astype(float)
    X = strength_design(df['sex_m'], df['age'], df['weight'])
    y = np.log(df['total'].to_numpy())
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=SEED)
    total_te = np.exp(yte)

    medians = {s: float(np.median(ytr[Xtr[:, 0] == s])) for s in (0.0, 1.0)}
    baseline = np.exp(np.where(Xte[:, 0] == 1.0, medians[1.0], medians[0.0]))
    rows = [{'model': 'Baseline: median total by sex', 'mae_kg': round(mean_absolute_error(total_te, baseline), 2),
             'fit_s': 0.0, 'size_bytes': 16}]
    candidates = {
        'Polynomial regression (log-log)': make_pipeline(PolynomialFeatures(degree=3), StandardScaler(), LinearRegression()),
        'Gradient boosting (monotone in bodyweight)': HistGradientBoostingRegressor(
            max_iter=300, learning_rate=0.08, monotonic_cst=[0, 0, 1], random_state=SEED),
    }
    for name, model in candidates.items():
        model, seconds = timed_fit(model, Xtr, ytr)
        rows.append({'model': name, 'mae_kg': round(mean_absolute_error(total_te, np.exp(model.predict(Xte))), 2),
                     'fit_s': seconds, 'size_bytes': model_bytes(model)})
    # The game only uses strength as a RATIO between two people, so the curve must be smooth and
    # increase with bodyweight. Boosting is piecewise-constant (step-shaped ratios), so the smooth
    # polynomial is preferred when it is within 2% of the best MAE and monotone on 40-200 kg.
    poly_name, gb_name = list(candidates)
    mae = {r['model']: r['mae_kg'] for r in rows}
    grid_w = np.linspace(40, 200, 161)
    monotone = all(np.all(np.diff(candidates[poly_name].predict(strength_design(
        np.full_like(grid_w, sex), np.full_like(grid_w, age), grid_w))) > 0)
        for sex in (0.0, 1.0) for age in (18.0, 28.0, 45.0, 65.0))
    best = poly_name if monotone and mae[poly_name] <= 1.02 * mae[gb_name] else gb_name
    model = candidates[best]
    report['strength'] = {'data': 'OpenPowerlifting (best raw total per lifter)', 'rows': len(df),
                          'split': '80/20 random by lifter', 'metric': 'MAE (kg), lower is better',
                          'results': rows, 'chosen': best, 'polynomial_monotone_40_200kg': bool(monotone),
                          'choice_rule': 'smooth polynomial if monotone and within 2% of best MAE (used as a ratio)'}

    fig, ax = plt.subplots(figsize=(6, 4))
    grid = np.linspace(45, 160, 100)
    for sex_m, label, color in ((1.0, 'Men', '#2563eb'), (0.0, 'Women', '#db2777')):
        pred = np.exp(model.predict(strength_design(np.full_like(grid, sex_m), np.full_like(grid, 28.0), grid)))
        ax.plot(grid, pred, label=label, color=color, lw=2)
    ax.set(xlabel='Bodyweight (kg)', ylabel='Predicted powerlifting total (kg)',
           title='Strength grows slower than bodyweight (age 28)')
    ax.legend()
    ax.grid(alpha=0.3)
    save_fig(fig, 'strength_curve.png')
    return model


def predicted_strength(model, sex_m, age, weight):
    sex_m, age, weight = np.broadcast_arrays(np.asarray(sex_m, float), np.asarray(age, float),
                                             np.asarray(weight, float))
    return np.exp(model.predict(strength_design(sex_m, age, weight)))


# ----------------------------------------------------------------------------- fitness

def train_fitness(report):
    df = pd.read_csv(PROCESSED / 'body_performance.csv')
    df['sex_m'] = (df['sex'] == 'M').astype(float)
    full_cols, base_cols = ['sex_m', 'age', 'height', 'weight', 'situps', 'jump'], ['sex_m', 'age', 'height', 'weight']
    train, test = train_test_split(df, test_size=0.2, random_state=SEED, stratify=df['fitness_class'])

    grip_models, grip_rows = {}, {}
    for label, cols in (('full', full_cols), ('base', base_cols)):
        sex_mean = train.groupby('sex_m')['grip'].mean()
        rows = [{'model': 'Baseline: mean grip by sex',
                 'mae_kg': round(mean_absolute_error(test['grip'], test['sex_m'].map(sex_mean)), 3),
                 'fit_s': 0.0, 'size_bytes': 16}]
        candidates = {'Linear regression': LinearRegression(),
                      'Gradient boosting': HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05,
                                                                         random_state=SEED)}
        for name, model in candidates.items():
            model, seconds = timed_fit(model, train[cols].to_numpy(), train['grip'].to_numpy())
            rows.append({'model': name, 'mae_kg': round(mean_absolute_error(test['grip'], model.predict(test[cols].to_numpy())), 3),
                         'fit_s': seconds, 'size_bytes': model_bytes(model)})
        best = min(rows[1:], key=lambda r: r['mae_kg'])['model']
        grip_models[label] = candidates[best]
        grip_rows[label] = {'features': cols, 'results': rows, 'chosen': best}

    X_tr, X_te = train[full_cols].to_numpy(), test[full_cols].to_numpy()
    y_tr, y_te = train['fitness_class'].to_numpy(), test['fitness_class'].to_numpy()
    candidates = {'Baseline: most frequent class': DummyClassifier(strategy='most_frequent'),
                  'Logistic regression': make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)),
                  'Gradient boosting': HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, random_state=SEED)}
    rows, fitted = [], {}
    for name, model in candidates.items():
        model, seconds = timed_fit(model, X_tr, y_tr)
        fitted[name] = model
        pred = model.predict(X_te)
        rows.append({'model': name, 'f1_macro': round(f1_score(y_te, pred, average='macro'), 4),
                     'accuracy': round(accuracy_score(y_te, pred), 4), 'fit_s': seconds, 'size_bytes': model_bytes(model)})
    best = max(rows[1:], key=lambda r: r['f1_macro'])['model']
    classifier = fitted[best]

    labels = sorted(df['fitness_class'].unique())
    cm = confusion_matrix(y_te, classifier.predict(X_te), labels=labels)
    fig, ax = plt.subplots(figsize=(4.5, 4))
    ax.imshow(cm, cmap='Blues')
    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(j, i, cm[i, j], ha='center', va='center', color='white' if cm[i, j] > cm.max() / 2 else 'black')
    ax.set(xticks=range(len(labels)), yticks=range(len(labels)), xticklabels=labels, yticklabels=labels,
           xlabel='Predicted class', ylabel='True class', title=f'Fitness class ({best})')
    save_fig(fig, 'fitness_confusion.png')

    report['fitness'] = {'data': 'Body Performance (Korea Sports Promotion Foundation)', 'rows': len(df),
                         'split': '80/20 stratified by class',
                         'grip': {'metric': 'MAE (kg)', **grip_rows},
                         'class': {'metric': 'F1-macro, higher is better', 'results': rows, 'chosen': best},
                         'chosen': f"grip: {grip_rows['full']['chosen']}; class: {best}"}
    return grip_models['full'], grip_models['base'], classifier, fitness_quantiles(df)


AGE_BANDS = [(21, 29), (30, 39), (40, 49), (50, 64)]


def fitness_quantiles(df):
    """Sit-up and broad-jump values at each percentile, per sex and age band.

    Players report max push-ups instead of these timed tests. The game turns push-ups into a
    percentile (published CSEP norms) and reads the equivalent sit-ups / jump here, so the trained
    fitness models still receive the inputs they were trained on."""
    table = {}
    for sex in ('M', 'F'):
        table[sex] = {}
        for lo, hi in AGE_BANDS:
            part = df[(df['sex'] == sex) & df['age'].between(lo, hi)]
            q = np.linspace(0, 1, 101)
            table[sex][f'{lo}-{hi}'] = {'situps': np.quantile(part['situps'], q).round(1).tolist(),
                                       'jump': np.quantile(part['jump'], q).round(1).tolist(), 'n': len(part)}
    return table


# ----------------------------------------------------------------------------- size (sumo + ADCC)

def train_size(report, strength_model):
    df = pd.read_csv(PROCESSED / 'sumo_bouts.csv')
    s_a = predicted_strength(strength_model, 1.0, df['a_age'], df['a_weight'])
    s_b = predicted_strength(strength_model, 1.0, df['b_age'], df['b_weight'])
    df['log_strength_ratio'] = np.log(s_a / s_b)
    df['log_weight_ratio'] = np.log(df['a_weight'] / df['b_weight'])
    df['rank_gap'] = np.log(df['b_order'] / df['a_order'])  # > 0 when A is ranked higher (smaller order)
    year = df['basho_id'] // 100
    split_note = 'by time: train <=2018, validation 2019-2021, test >=2022'
    train, val, test = df[year <= 2018], df[(year >= 2019) & (year <= 2021)], df[year >= 2022]
    if len(val) == 0 or len(test) == 0:  # partial download: 70/15/15 by time instead
        cut1, cut2 = df['basho_id'].quantile([0.70, 0.85])
        train, val, test = df[df['basho_id'] <= cut1], df[(df['basho_id'] > cut1) & (df['basho_id'] <= cut2)], df[df['basho_id'] > cut2]
        split_note = f'by time (70/15/15): train <={int(cut1)}, validation <={int(cut2)}, test later'

    approaches = {
        'Rank only (skill control)': ['rank_gap'],
        'Rank + weight ratio': ['rank_gap', 'log_weight_ratio'],
        'Rank + strength ratio (powerlifting model)': ['rank_gap', 'log_strength_ratio'],
    }
    rows = [{'model': 'Baseline: coin flip', **{f'val_{k}': v for k, v in binary_scores(val['a_win'], np.full(len(val), 0.5)).items()},
             **{f'test_{k}': v for k, v in binary_scores(test['a_win'], np.full(len(test), 0.5)).items()}}]
    fitted = {}
    for name, cols in approaches.items():
        Xtr, ytr = symmetric(train[cols].to_numpy(), train['a_win'].to_numpy())
        model, seconds = timed_fit(LogisticRegression(fit_intercept=False, C=10.0, max_iter=2000), Xtr, ytr)
        fitted[name] = (model, cols)
        rows.append({'model': name, 'fit_s': seconds,
                     **{f'val_{k}': v for k, v in binary_scores(val['a_win'], antisymmetric_proba(model, val[cols].to_numpy())).items()},
                     **{f'test_{k}': v for k, v in binary_scores(test['a_win'], antisymmetric_proba(model, test[cols].to_numpy())).items()},
                     'coefficients': dict(zip(cols, np.round(model.coef_[0], 4).tolist()))})
    hgb_cols = ['a_weight', 'b_weight', 'a_height', 'b_height', 'a_age', 'b_age', 'a_order', 'b_order']
    hgb, seconds = timed_fit(HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, random_state=SEED),
                             train[hgb_cols].to_numpy(), train['a_win'].to_numpy())
    rows.append({'model': 'Gradient boosting on raw sizes + ranks (not explainable as one size effect)', 'fit_s': seconds,
                 **{f'val_{k}': v for k, v in binary_scores(val['a_win'], hgb.predict_proba(val[hgb_cols].to_numpy())[:, 1]).items()},
                 **{f'test_{k}': v for k, v in binary_scores(test['a_win'], hgb.predict_proba(test[hgb_cols].to_numpy())[:, 1]).items()}})

    # Sumo is all men of similar age, so weight and strength ratios carry the same signal there. The
    # strength ratio also carries sex, age and the fitness test, which the game needs (a 60 kg woman
    # and a 60 kg man are not equally strong), so it is kept unless weight is clearly better.
    by_name = {r['model']: r for r in rows}
    weight_row, strength_row = by_name['Rank + weight ratio'], by_name['Rank + strength ratio (powerlifting model)']
    chosen = (weight_row['model'] if weight_row['val_log_loss'] < strength_row['val_log_loss'] - 0.002
              else strength_row['model'])
    model, cols = fitted[chosen]
    size_feature = cols[1]
    beta_sumo = float(model.coef_[0][1])

    # External check on ADCC open-weight matches: same size effect, skilled grapplers, real open weight.
    adcc = pd.read_csv(PROCESSED / 'adcc_absolute.csv')
    sex_m = (adcc['sex'] == 'M').astype(float)
    if size_feature == 'log_strength_ratio':
        ratio = np.log(predicted_strength(strength_model, sex_m, REFERENCE_AGE, adcc['winner_kg']) /
                       predicted_strength(strength_model, sex_m, REFERENCE_AGE, adcc['loser_kg']))
    else:
        ratio = np.log(adcc['winner_kg'] / adcc['loser_kg'])
    score = beta_sumo * np.asarray(ratio, float)
    unequal = score != 0
    X_adcc, y_adcc = symmetric(score[unequal, None], np.ones(unequal.sum()))
    adcc_auc = roc_auc_score(y_adcc, X_adcc[:, 0])
    # Same external check for the plain weight ratio, to compare the two size features fairly.
    w_ratio = np.log(adcc['winner_kg'] / adcc['loser_kg']).to_numpy()[unequal]
    Xw, yw = symmetric(w_ratio[:, None], np.ones(unequal.sum()))
    adcc_auc_weight = roc_auc_score(yw, Xw[:, 0])
    scale_model = LogisticRegression(fit_intercept=False, C=100.0).fit(X_adcc, y_adcc)
    scale = float(scale_model.coef_[0][0])
    rng = np.random.default_rng(SEED)
    boot = []
    for _ in range(1000):
        idx = rng.integers(0, unequal.sum(), unequal.sum())
        Xb, yb = symmetric(score[unequal][idx, None], np.ones(len(idx)))
        boot.append(LogisticRegression(fit_intercept=False, C=100.0).fit(Xb, yb).coef_[0][0])
    scale_used = float(np.clip(scale, 0.25, 5.0))  # ADCC open weight is the real target scenario; clip only absurd fits
    beta = beta_sumo * scale_used

    # Figure: chance that the heavier wrestler wins vs weight gap, at equal rank.
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    close = test[np.abs(test['rank_gap']) < 0.15]
    gap = close['a_weight'] - close['b_weight']
    bins = np.arange(-60, 61, 10)
    centers, rates = [], []
    for lo, hi in zip(bins[:-1], bins[1:]):
        part = close[(gap >= lo) & (gap < hi)]
        if len(part) >= 40:
            centers.append((lo + hi) / 2)
            rates.append(part['a_win'].mean())
    axes[0].scatter(centers, rates, color='#64748b', label='Sumo test bouts (similar rank)')
    grid = np.linspace(-60, 60, 121)
    base_w = 140.0
    if size_feature == 'log_strength_ratio':
        x = np.log(predicted_strength(strength_model, 1.0, 28.0, base_w + grid / 2) /
                   predicted_strength(strength_model, 1.0, 28.0, base_w - grid / 2))
    else:
        x = np.log((base_w + grid / 2) / (base_w - grid / 2))
    axes[0].plot(grid, 1 / (1 + np.exp(-beta_sumo * x)), color='#2563eb', lw=2, label='Sumo model')
    axes[0].set(xlabel='Weight difference (kg)', ylabel='P(win)', title='Sumo: size effect at equal rank')
    axes[0].legend()
    axes[0].grid(alpha=0.3)
    adcc_gap = adcc['winner_kg'] - adcc['loser_kg']
    labels, heavier = [], []
    for lo, hi, label in ((1, 12, '1-11 kg'), (12, 23, '12-22 kg'), (23, 60, '23+ kg')):
        part = adcc_gap.abs().between(lo, hi - 1e-9)
        labels.append(f'{label}\n(n={int(part.sum())})')
        heavier.append(float((adcc_gap[part] > 0).mean()) if part.sum() else np.nan)
    axes[1].bar(labels, heavier, color='#0f766e')
    axes[1].axhline(0.5, color='black', lw=1, ls='--')
    axes[1].set(ylim=(0, 1), ylabel='Share won by the heavier athlete', title='ADCC open-weight: heavier wins more')
    save_fig(fig, 'size_effect.png')

    report['size'] = {
        'data': 'Sumo bouts (sumo-api.com), validated on ADCC open-weight matches', 'rows': len(df),
        'split': split_note,
        'metric': 'log loss (lower is better), AUC', 'results': rows, 'chosen': chosen,
        'size_feature': size_feature, 'beta_sumo': round(beta_sumo, 4),
        'adcc': {'matches_with_weight_gap': int(unequal.sum()), 'auc_of_sumo_size_score': round(adcc_auc, 4), 'auc_weight_ratio_only': round(float(adcc_auc_weight), 4),
                 'fitted_scale': round(scale, 3), 'scale_95ci': [round(float(np.percentile(boot, 2.5)), 3),
                                                                 round(float(np.percentile(boot, 97.5)), 3)],
                 'scale_used': round(scale_used, 3)},
        'beta_final': round(beta, 4),
    }
    return {'feature': size_feature, 'beta_sumo': beta_sumo, 'scale': scale_used, 'beta': beta}


# ----------------------------------------------------------------------------- skill (UFC)

def ufc_split(df):
    return df[df['year'] <= 2021], df[(df['year'] >= 2022) & (df['year'] <= 2023)], df[df['year'] >= 2024]


def diff_matrix(df):
    return np.column_stack([df[f'r_{f}'] - df[f'b_{f}'] for f in SKILL_FEATURES])


def train_skill(report):
    df = pd.read_csv(PROCESSED / 'ufc_bouts.csv')
    train, val, test = ufc_split(df)
    Xtr, ytr = symmetric(diff_matrix(train), train['red_win'].to_numpy())

    rows = [{'model': 'Baseline: coin flip',
             **{f'val_{k}': v for k, v in binary_scores(val['red_win'], np.full(len(val), 0.5)).items()},
             **{f'test_{k}': v for k, v in binary_scores(test['red_win'], np.full(len(test), 0.5)).items()}}]
    best_c, best_loss = 1.0, np.inf
    for c in (0.01, 0.03, 0.1, 0.3, 1.0):  # tune regularization on the validation years
        m = make_pipeline(StandardScaler(with_mean=False), LogisticRegression(fit_intercept=False, C=c, max_iter=2000))
        m.fit(Xtr, ytr)
        loss = log_loss(val['red_win'], antisymmetric_proba(m, diff_matrix(val)))
        if loss < best_loss:
            best_c, best_loss = c, loss
    candidates = {
        f'Logistic regression (C={best_c})': make_pipeline(StandardScaler(with_mean=False),
                                                          LogisticRegression(fit_intercept=False, C=best_c, max_iter=2000)),
        'Gradient boosting': HistGradientBoostingClassifier(max_iter=150, learning_rate=0.03, max_depth=3,
                                                            l2_regularization=1.0, random_state=SEED),
    }
    for name, model in candidates.items():
        model, seconds = timed_fit(model, Xtr, ytr)
        rows.append({'model': name, 'fit_s': seconds, 'size_bytes': model_bytes(model),
                     **{f'val_{k}': v for k, v in binary_scores(val['red_win'], antisymmetric_proba(model, diff_matrix(val))).items()},
                     **{f'test_{k}': v for k, v in binary_scores(test['red_win'], antisymmetric_proba(model, diff_matrix(test))).items()}})
    logit_name = next(n for n in candidates if n.startswith('Logistic'))
    logit_row = next(r for r in rows if r['model'] == logit_name)
    gb_row = next(r for r in rows if r['model'] == 'Gradient boosting')
    # The game must explain every prediction, so the linear model is deployed; boosting is the
    # comparison that shows how much (if anything) that explainability costs.
    best_by_val = min((logit_row, gb_row), key=lambda r: r['val_log_loss'])['model']
    chosen = logit_name
    model = candidates[chosen]

    full = pd.concat([train, val])
    X_full, y_full = symmetric(diff_matrix(full), full['red_win'].to_numpy())
    final = make_pipeline(StandardScaler(with_mean=False),
                          LogisticRegression(fit_intercept=False, C=best_c, max_iter=2000)).fit(X_full, y_full)
    scale = final[0].scale_
    coef = final[1].coef_[0] / scale  # per raw unit of each feature difference

    test_p = antisymmetric_proba(model, diff_matrix(test))
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    order = np.argsort(np.abs(final[1].coef_[0]))
    axes[0].barh(np.array(SKILL_FEATURES)[order], final[1].coef_[0][order],
                 color=['#16a34a' if c > 0 else '#dc2626' for c in final[1].coef_[0][order]])
    axes[0].set(title='Skill model: effect of a 1-SD advantage (logit)', xlabel='Coefficient')
    axes[0].grid(alpha=0.3, axis='x')
    bins = np.linspace(0, 1, 11)
    idx = np.digitize(test_p, bins) - 1
    xs = [test_p[idx == i].mean() for i in range(10) if (idx == i).sum() >= 20]
    ys = [test['red_win'].to_numpy()[idx == i].mean() for i in range(10) if (idx == i).sum() >= 20]
    axes[1].plot([0, 1], [0, 1], ls='--', color='black', lw=1)
    axes[1].plot(xs, ys, marker='o', color='#2563eb')
    axes[1].set(xlabel='Predicted P(red wins)', ylabel='Observed red win rate', title=f'Calibration on 2024+ ({chosen})')
    axes[1].grid(alpha=0.3)
    save_fig(fig, 'skill_model.png')

    report['skill'] = {'data': 'UFC bouts (TidyTuesday / Ultimate UFC Dataset)', 'rows': len(df),
                       'split': 'by time: train <=2021, validation 2022-2023, test >=2024',
                       'metric': 'log loss (lower is better), AUC', 'results': rows, 'chosen': chosen,
                       'best_by_validation': best_by_val,
                       'explainability_cost_val_log_loss': round(logit_row['val_log_loss'] - min(logit_row['val_log_loss'], gb_row['val_log_loss']), 4),
                       'coefficients_per_sd': dict(zip(SKILL_FEATURES, np.round(final[1].coef_[0], 4).tolist()))}
    return {'features': SKILL_FEATURES, 'coef': coef.tolist(), 'chosen': chosen}


# ----------------------------------------------------------------------------- finish method

def method_matrix(df):
    """Winner's and loser's style percentiles (winner first)."""
    red = df['red_win'].to_numpy() == 1
    cols = []
    for f in STYLE_FEATURES:
        cols.append(np.where(red, df[f'r_{f}'], df[f'b_{f}']))
    for f in STYLE_FEATURES:
        cols.append(np.where(red, df[f'b_{f}'], df[f'r_{f}']))
    return np.column_stack(cols)


def train_method(report):
    df = pd.read_csv(PROCESSED / 'ufc_bouts.csv').dropna(subset=['finish'])
    train, val, test = ufc_split(df)
    candidates = {'Baseline: class frequencies': DummyClassifier(strategy='prior'),
                  'Multinomial logistic regression': make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)),
                  'Gradient boosting': HistGradientBoostingClassifier(max_iter=150, learning_rate=0.03, max_depth=3,
                                                                      random_state=SEED)}
    rows, fitted = [], {}
    for name, model in candidates.items():
        model, seconds = timed_fit(model, method_matrix(train), train['finish'])
        fitted[name] = model
        row = {'model': name, 'fit_s': seconds, 'size_bytes': model_bytes(model)}
        for split_name, part in (('val', val), ('test', test)):
            proba = model.predict_proba(method_matrix(part))
            row[f'{split_name}_log_loss'] = round(log_loss(part['finish'], proba, labels=model.classes_), 4)
            row[f'{split_name}_f1_macro'] = round(f1_score(part['finish'], model.classes_[proba.argmax(1)], average='macro'), 4)
        rows.append(row)
    chosen = min(rows[1:], key=lambda r: r['val_log_loss'])['model']
    final = candidates[chosen].fit(method_matrix(pd.concat([train, val])), pd.concat([train, val])['finish'])
    report['method'] = {'data': 'UFC bouts with a KO / submission / decision finish', 'rows': len(df),
                        'split': 'by time (same as skill model)', 'metric': 'log loss, F1-macro',
                        'results': rows, 'chosen': chosen}
    return final


# ----------------------------------------------------------------------------- summary figure

def comparison_figure(report):
    panels = [('reach', 'mae_cm', 'Reach MAE (cm)'), ('strength', 'mae_kg', 'Strength MAE (kg)'),
              ('size', 'test_log_loss', 'Size model test log loss'), ('skill', 'test_log_loss', 'Skill model test log loss')]
    fig, axes = plt.subplots(1, 4, figsize=(16, 4))
    for ax, (task, key, title) in zip(axes, panels):
        rows = [r for r in report[task]['results'] if key in r]
        names = [r['model'].split('(')[0].replace('Baseline: ', 'Baseline\n')[:28] for r in rows]
        values = [r[key] for r in rows]
        colors = ['#94a3b8' if r['model'].startswith('Baseline') else
                  ('#2563eb' if r['model'] == report[task]['chosen'] else '#60a5fa') for r in rows]
        ax.barh(names, values, color=colors)
        lo = min(values)
        ax.set_xlim(lo * 0.9 if 'log_loss' in key else 0, max(values) * 1.03)
        ax.set_title(title)
        ax.invert_yaxis()
        ax.tick_params(axis='y', labelsize=8)
    save_fig(fig, 'model_comparison.png')


def main():
    MODELS.mkdir(exist_ok=True)
    FIGURES.mkdir(parents=True, exist_ok=True)
    report = {'trained_at': datetime.datetime.now().isoformat(timespec='seconds')}
    steps = []

    def step(name, fn, *args):
        start = time.perf_counter()
        out = fn(report, *args)
        steps.append((name, round(time.perf_counter() - start, 1)))
        print(f'{name}: done in {steps[-1][1]}s -> chosen: {report[name].get("chosen")}', flush=True)
        return out

    reach = step('reach', train_reach)
    strength = step('strength', train_strength)
    grip_full, grip_base, fitness_class, quantiles = step('fitness', train_fitness)
    size = step('size', train_size, strength)
    skill = step('skill', train_skill)
    method = step('method', train_method)
    comparison_figure(report)

    bundle = {'version': 1, 'trained_at': report['trained_at'], 'reach': reach, 'strength': strength,
              'grip_full': grip_full, 'grip_base': grip_base, 'fitness_class': fitness_class,
              'fitness_quantiles': quantiles,
              'size': size, 'skill': skill, 'method': method, 'method_classes': list(method.classes_)}
    joblib.dump(bundle, MODEL_FILE, compress=3)
    report['model_file_bytes'] = MODEL_FILE.stat().st_size
    report['step_seconds'] = dict(steps)
    (REPORTS / 'metrics.json').write_text(json.dumps(report, indent=2))
    print(f'saved {MODEL_FILE.name} ({report["model_file_bytes"] / 1e6:.2f} MB) and reports/metrics.json')


if __name__ == '__main__':
    main()
