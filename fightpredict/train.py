"""Reproducible chronological experiments; the test set never selects a model."""
import os
for key in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS'):
    os.environ.setdefault(key, '1')
from pathlib import Path
import json
import time
import platform
import warnings
import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import sklearn
from sklearn.calibration import calibration_curve
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score, f1_score, brier_score_loss, log_loss, confusion_matrix, roc_curve
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from dataset import prepare, ROOT
from features import FEATURE_NAMES, LABELS, symmetric_probability, apply_temperature

SEED = 42
OUT = ROOT/'reports'
MODELS = ROOT/'models'
FIGS = OUT/'figures'

def metrics(y, p):
    return {'accuracy': float(accuracy_score(y, p >= .5)), 'roc_auc': float(roc_auc_score(y, p)),
            'f1': float(f1_score(y, p >= .5, zero_division=0)), 'brier': float(brier_score_loss(y, p)),
            'log_loss': float(log_loss(y, p, labels=[0, 1]))}

def pipeline(estimator):
    return Pipeline([('imputer', SimpleImputer(strategy='median', keep_empty_features=True)),
                     ('scaler', StandardScaler()), ('classifier', estimator)])

def augment(x, y):
    return pd.concat([x, -x], ignore_index=True), np.concatenate([y, 1-y])

def savefig(name):
    plt.tight_layout(); plt.savefig(FIGS/name, dpi=160, bbox_inches='tight'); plt.close()

def event_bootstrap(y, p, dates, repetitions=300):
    rng = np.random.default_rng(SEED)
    events = sorted(set(dates))
    groups = {day: np.where(dates == day)[0] for day in events}
    scores = []
    for _ in range(repetitions):
        ix = np.concatenate([groups[e] for e in rng.choice(events, len(events), replace=True)])
        if len(np.unique(y[ix])) == 2:
            scores.append(metrics(y[ix], p[ix]))
    return {k: [float(v) for v in np.quantile([s[k] for s in scores], [.025, .975])] for k in scores[0]}

def main():
    start = time.perf_counter()
    for directory in (OUT, FIGS, MODELS): directory.mkdir(parents=True, exist_ok=True)
    x, y, meta, catalog, audit = prepare()
    dates = pd.to_datetime(meta.date)
    masks = {'train': (dates < '2023-01-01').to_numpy(),
             'validation': ((dates >= '2023-01-01') & (dates < '2024-01-01')).to_numpy(),
             'calibration': ((dates >= '2024-01-01') & (dates < '2025-01-01')).to_numpy(),
             'test': (dates >= '2025-01-01').to_numpy()}
    splits = {name: {'bouts': int(mask.sum()), 'start': meta.loc[mask, 'date'].min(),
                     'end': meta.loc[mask, 'date'].max(), 'red_win_rate': float(y[mask].mean())} for name, mask in masks.items()}
    train_x, train_y = augment(x.loc[masks['train']], y[masks['train']])
    val_x, val_y = x.loc[masks['validation']], y[masks['validation']]
    configs = [
        ('Logistic Regression C=0.1', LogisticRegression(C=.1, max_iter=1200, random_state=SEED)),
        ('Logistic Regression C=1', LogisticRegression(C=1, max_iter=1200, random_state=SEED)),
        ('Random Forest leaf=12', RandomForestClassifier(n_estimators=350, min_samples_leaf=12, max_depth=10, n_jobs=2, random_state=SEED)),
        ('Random Forest leaf=25', RandomForestClassifier(n_estimators=350, min_samples_leaf=25, max_depth=8, n_jobs=2, random_state=SEED)),
        ('Neural Network (32,16)', MLPClassifier(hidden_layer_sizes=(32, 16), alpha=1, max_iter=350, early_stopping=False, random_state=SEED)),
        ('Neural Network (16,)', MLPClassifier(hidden_layer_sizes=(16,), alpha=3, max_iter=350, early_stopping=False, random_state=SEED)),
    ]
    trained = []; experiments = []
    for name, estimator in configs:
        model = pipeline(estimator); t = time.perf_counter()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always', ConvergenceWarning)
            model.fit(train_x, train_y)
        p = symmetric_probability(model, val_x)
        score = metrics(val_y, p)
        convergence = [str(w.message) for w in caught if issubclass(w.category, ConvergenceWarning)]
        experiment = {'model': name, 'validation': score, 'fit_seconds': round(time.perf_counter()-t, 3),
                      'parameters': estimator.get_params(), 'convergence_warnings': convergence}
        trained.append((name, model)); experiments.append(experiment)
        print(name, json.dumps(score), flush=True)
    best_index = min(range(len(experiments)), key=lambda i: experiments[i]['validation']['brier'])
    selected_name, best_model = trained[best_index]
    cal_x = x.loc[masks['calibration']]; cal_y = y[masks['calibration']]
    p_cal = symmetric_probability(best_model, cal_x)
    logits = np.log(np.clip(p_cal, 1e-6, 1-1e-6)/np.clip(1-p_cal, 1e-6, 1-1e-6))
    temperature = LogisticRegression(fit_intercept=False, C=10, max_iter=1200, random_state=SEED)
    temperature.fit(np.concatenate([logits, -logits]).reshape(-1, 1), np.concatenate([cal_y, 1-cal_y]))
    # Positive slope preserves rankings. A non-positive fit indicates no useful calibration signal.
    slope = float(max(0, temperature.coef_[0, 0]))
    test_x = x.loc[masks['test']]; test_y = y[masks['test']]
    p_test = apply_temperature(symmetric_probability(best_model, test_x), slope)
    test_comparison = []
    for name, model in trained:
        test_comparison.append({'model': name, 'calibrated': False, **metrics(test_y, symmetric_probability(model, test_x))})
    test_comparison.append({'model': selected_name+' + calibration', 'calibrated': True, **metrics(test_y, p_test)})
    neutral = np.full(len(test_y), .5)
    red_rate = float(y[masks['train']].mean())
    baselines = {'neutral_50_percent': metrics(test_y, neutral),
                 'train_red_corner_prior': metrics(test_y, np.full(len(test_y), red_rate))}
    # Ablation removes accuracy statistics whose historical timing is only source-documented.
    audited_features = [k for k in FEATURE_NAMES if k not in ['striking_accuracy_diff', 'takedown_accuracy_diff']]
    ablation = pipeline(LogisticRegression(C=.1, max_iter=1200, random_state=SEED))
    ablation.fit(train_x[audited_features], train_y)
    ablation_validation = metrics(val_y, symmetric_probability(ablation, val_x[audited_features]))
    ablation_test = metrics(test_y, symmetric_probability(ablation, test_x[audited_features]))
    # Validation permutation importance does not use the test set for explanations or selection.
    rng = np.random.default_rng(SEED)
    base_auc = roc_auc_score(val_y, symmetric_probability(best_model, val_x))
    importance = []
    for col in FEATURE_NAMES:
        drops = []
        for _ in range(5):
            permuted = val_x.copy(); permuted[col] = rng.permutation(permuted[col].to_numpy())
            drops.append(base_auc - roc_auc_score(val_y, symmetric_probability(best_model, permuted)))
        importance.append({'feature': col, 'label': LABELS[col], 'auc_drop': float(np.mean(drops)), 'std': float(np.std(drops))})
    importance.sort(key=lambda row: row['auc_drop'], reverse=True)
    subgroup_scores = []
    test_meta = meta.loc[masks['test']].reset_index(drop=True)
    for category in ('gender', 'weight_class'):
        for value, group in test_meta.groupby(category):
            ids = group.index.to_numpy()
            if len(ids) >= 15 and len(np.unique(test_y[ids])) == 2:
                subgroup_scores.append({'category': category, 'value': value, 'bouts': len(ids), **metrics(test_y[ids], p_test[ids])})
    intervals = event_bootstrap(test_y, p_test, test_meta.date.to_numpy())
    reliability = []
    for low in np.arange(0, 1, .1):
        ids = (p_test >= low) & (p_test < low+.1)
        if ids.any(): reliability.append({'low': float(low), 'high': float(low+.1), 'bouts': int(ids.sum()),
                                         'mean_prediction': float(p_test[ids].mean()), 'observed_a_win_rate': float(test_y[ids].mean())})
    ranges = {}
    for column in FEATURE_NAMES:
        s = x.loc[masks['train'], column].dropna()
        ranges[column] = {'p01': float(s.quantile(.01)), 'p99': float(s.quantile(.99))}
    results = {'seed': SEED, 'selected_model': selected_name, 'selection_metric': 'minimum uncalibrated validation Brier score',
               'calibration': {'method': 'single positive logit slope fitted only on 2024; no intercept preserves swap symmetry', 'slope': slope,
                               'before': metrics(cal_y, p_cal), 'after': metrics(cal_y, apply_temperature(p_cal, slope))},
               'splits': splits, 'experiments': experiments, 'test_comparison': test_comparison,
               'test': metrics(test_y, p_test), 'test_ci95_event_bootstrap': intervals, 'bootstrap_repetitions': 300,
               'baselines': baselines, 'ablation_without_source_accuracy': {'validation': ablation_validation, 'test': ablation_test},
               'subgroups': subgroup_scores, 'reliability_bins': reliability, 'validation_importance': importance,
               'audit': audit, 'feature_names': FEATURE_NAMES, 'training_feature_ranges': ranges,
               'environment': {'python': platform.python_version(), 'sklearn': sklearn.__version__, 'numpy': np.__version__, 'pandas': pd.__version__},
               'test_use': 'Evaluation only. No tuning, no post-test refit. The shipped model is exactly the tested train-only pipeline plus 2024 calibration.'}
    (OUT/'metrics.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    pd.DataFrame([{ 'model': e['model'], **e['validation']} for e in experiments]).to_csv(OUT/'validation_metrics.csv', index=False)
    pd.DataFrame(test_comparison).to_csv(OUT/'test_metrics.csv', index=False)
    pd.DataFrame(subgroup_scores).to_csv(OUT/'subgroup_metrics.csv', index=False)
    test_meta['probability_a'] = p_test; test_meta['predicted_a'] = p_test >= .5
    test_meta['correct'] = (p_test >= .5) == test_y
    test_meta['confidence'] = np.maximum(p_test, 1-p_test)
    test_meta.to_csv(OUT/'test_predictions.csv', index=False)
    test_meta[~test_meta.correct].sort_values('confidence', ascending=False).head(30).to_csv(OUT/'confident_errors.csv', index=False)
    pd.concat([meta, x], axis=1).to_csv(ROOT/'data'/'processed_bouts.csv', index=False)
    (MODELS/'fighters.json').write_text(json.dumps(catalog, indent=2, allow_nan=False), encoding='utf-8')
    bundle = {'pipeline': best_model, 'calibration_slope': slope, 'feature_names': FEATURE_NAMES,
              'selected_model': selected_name, 'training_feature_ranges': ranges,
              'sklearn_version': sklearn.__version__, 'model_schema_version': 1}
    joblib.dump(bundle, MODELS/'fightpredict.joblib', compress=3)
    joblib.dump(ablation, MODELS/'audited_baseline.joblib', compress=3)
    plt.rcParams.update({'axes.spines.top': False, 'axes.spines.right': False, 'font.size': 10})
    plt.figure(figsize=(9, 4)); meta.groupby(meta.date.str[:4]).size().plot.bar(color='#7357f5')
    plt.ylabel('Completed binary-outcome bouts'); plt.xlabel('Year'); plt.title('Dataset coverage'); savefig('data_coverage.png')
    plt.figure(figsize=(9, 4)); (x.isna().mean()*100).sort_values().plot.barh(color='#7357f5')
    plt.xlabel('Missing feature differences (%)'); plt.title('Missingness before train-only median imputation'); savefig('missingness.png')
    plt.figure(figsize=(9, 5)); corr = x.corr(); plt.imshow(corr, vmin=-1, vmax=1, cmap='coolwarm'); plt.colorbar(label='Pearson correlation')
    plt.xticks(range(len(FEATURE_NAMES)), FEATURE_NAMES, rotation=90, fontsize=7); plt.yticks(range(len(FEATURE_NAMES)), FEATURE_NAMES, fontsize=7)
    plt.title('Feature correlations (descriptive EDA)'); savefig('feature_correlations.png')
    plt.figure(figsize=(6, 5)); fpr, tpr, _ = roc_curve(test_y, p_test)
    plt.plot(fpr, tpr, color='#7357f5', label=f"Selected model AUC {results['test']['roc_auc']:.3f}"); plt.plot([0,1],[0,1],'--',color='gray')
    plt.xlabel('False positive rate'); plt.ylabel('True positive rate'); plt.legend(); plt.title('Untouched chronological test'); savefig('roc_curve.png')
    plt.figure(figsize=(6, 5)); obs, pred = calibration_curve(test_y, p_test, n_bins=8, strategy='quantile')
    plt.plot(pred, obs, 'o-', color='#7357f5', label='2025–2026 test'); plt.plot([0,1],[0,1],'--',color='gray')
    plt.xlabel('Mean estimated A win probability'); plt.ylabel('Observed A win fraction'); plt.legend(); plt.title('Probability calibration'); savefig('calibration.png')
    cm = confusion_matrix(test_y, p_test >= .5)
    plt.figure(figsize=(5, 4)); plt.imshow(cm, cmap='Purples'); plt.xticks([0,1],['B wins','A wins']); plt.yticks([0,1],['B wins','A wins'])
    for i in range(2):
        for j in range(2): plt.text(j, i, str(cm[i,j]), ha='center', va='center', color='white' if cm[i,j] > cm.max()*.6 else 'black', fontsize=18)
    plt.xlabel('Predicted'); plt.ylabel('Actual'); plt.title('Test confusion matrix'); savefig('confusion_matrix.png')
    plt.figure(figsize=(8, 5)); plt.barh([r['label'] for r in importance][::-1], [r['auc_drop'] for r in importance][::-1], color='#7357f5')
    plt.xlabel('Validation AUC drop after permutation'); plt.title('Global predictive feature importance'); savefig('feature_importance.png')
    plt.figure(figsize=(9, 4)); labels=[e['model'] for e in experiments]
    plt.barh(labels[::-1], [e['validation']['brier'] for e in experiments][::-1], color='#7357f5'); plt.axvline(.25,color='gray',ls='--',label='50/50 Brier')
    plt.xlabel('Validation Brier score (lower is better)'); plt.legend(); savefig('model_comparison.png')
    for name, model in trained:
        classifier = model.named_steps['classifier']
        if hasattr(classifier, 'loss_curve_'):
            plt.plot(classifier.loss_curve_, label=name)
    plt.xlabel('Epoch'); plt.ylabel('Training log loss + regularization'); plt.legend(); plt.title('Neural network optimization'); savefig('neural_learning_curves.png')
    from write_report import main as write_report
    write_report()
    print(json.dumps({'selected_model': selected_name, 'test': results['test'], 'splits': splits,
                      'usable_bouts': audit['usable_bouts'], 'seconds': round(time.perf_counter()-start, 2)}, indent=2), flush=True)

if __name__ == '__main__': main()
