"""Generate the human-readable technical report from recorded experiment evidence."""
from pathlib import Path
import html
import json
import re
import pandas as pd

ROOT = Path(__file__).resolve().parent

def table(headers, rows):
    return '| ' + ' | '.join(headers) + ' |\n| ' + ' | '.join(['---']*len(headers)) + ' |\n' + '\n'.join('| ' + ' | '.join(str(v) for v in row) + ' |' for row in rows)

def main():
    m = json.loads((ROOT/'reports'/'metrics.json').read_text())
    a=m['audit']; t=m['test']; cal=m['calibration']; ci=m['test_ci95_event_bootstrap']
    experiments = table(['Model','Validation accuracy','Validation AUC','Validation Brier','Fit seconds'],[
        [e['model'], f"{e['validation']['accuracy']:.3f}", f"{e['validation']['roc_auc']:.3f}",f"{e['validation']['brier']:.6f}", e['fit_seconds']] for e in m['experiments']])
    test_table = table(['Model','Test accuracy','Test AUC','Test F1','Test Brier'],[
        [e['model'],f"{e['accuracy']:.3f}",f"{e['roc_auc']:.3f}",f"{e['f1']:.3f}",f"{e['brier']:.4f}"] for e in m['test_comparison']])
    split_table = table(['Partition','Dates','Original bouts','Purpose'],[
        [name, s['start']+' to '+s['end'],s['bouts'],purpose] for (name,s),purpose in zip(m['splits'].items(),['Fit parameters and medians','Choose one configuration','Fit probability calibration slope','Final evaluation only'])])
    subgroup = table(['Group','Bouts','Accuracy','AUC','Brier'],[
        [s['value'],s['bouts'],f"{s['accuracy']:.3f}",f"{s['roc_auc']:.3f}",f"{s['brier']:.3f}"] for s in m['subgroups']])
    errors = pd.read_csv(ROOT/'reports'/'confident_errors.csv').head(8)
    error_table = table(['Date','Fighter A','Fighter B','P(A)','Actual winner'],[
        [r.date,r.fighter_a,r.fighter_b,f"{r.probability_a:.3f}",r.fighter_a if r.winner_a else r.fighter_b] for r in errors.itertuples()])
    feature_table=table(['Model input','Definition'],[
        ['age_diff','A age minus B age, in integer years'],['height_cm_diff / reach_cm_diff','A minus B, centimeters'],
        ['weight_kg_diff','A minus B, converted from source pounds with factor 0.45359237'],
        ['wins_diff / losses_diff','A minus B observed UFC W/L counts before the bout day'],
        ['win_streak_diff / lose_streak_diff','A minus B current observed UFC W/L streak; D/NC reset streaks'],
        ['striking_accuracy_diff / takedown_accuracy_diff','A minus B provided historical pre-bout accuracy, percentage points'],
        ['experience_diff','(A wins + A losses) minus (B wins + B losses)'],
        ['smoothed_win_rate_diff','(A wins + 1)/(A wins + A losses + 2) minus the corresponding B fraction']])
    baseline = m['baselines']['train_red_corner_prior']; ablation=m['ablation_without_source_accuracy']['test']
    text=f'''# FightPredict AI — Technical Report

## 1. Research question, users and objective

Can historical pre-bout physical attributes and performance measures predict the winner of a decisive UFC bout better than a simple prior? The prototype supports students, researchers and sports analysts comparing hypothetical matchups. This is supervised binary classification with probability estimation, not a causal analysis or prediction of injuries, finish method or betting returns.

The engineering objective is a reproducible trained model that accepts two fighters, returns complementary win probabilities and exposes measured quality. The research success criterion is lower held-out Brier score and higher ROC-AUC than a no-skill baseline. Brier was fixed as the model selection metric because the application displays probabilities.

## 2. Source, size, cleaning and audit

Source: [TidyTuesday UFC dataset, 2026-07-07](https://github.com/rfordatascience/tidytuesday/blob/main/data/2026/2026-07-07/readme.md), compiled through fightr from UFCStats and the Ultimate UFC Dataset. Raw files and the original dictionary are bundled. `data/raw/sources.json` contains source URLs, byte lengths and SHA-256 hashes. No synthetically generated fights are used.

The starting bout table has {a['raw_bouts']:,} rows and 118 columns. The separate history table contributes {a['history_rows']:,} deduplicated bouts and starts in 1994. The final modeling data contain **{a['usable_bouts']:,} bouts**, spanning {a['date_min']}–{a['date_max']}. The application catalog contains **{a['athletes']:,}** latest pre-bout fighter snapshots.

Cleaning removes {a['excluded_nonbinary_or_invalid_date']} non-binary outcomes or invalid dates, {a['duplicate_unordered_bouts_removed']} duplicate unordered date/bout pairs, {a['conflicting_outcomes_removed']} outcome conflicts against the separate history table, and {a['unmatched_bouts_removed']} fights without a matched history bout. Aliases are resolved using an exact shared event date and opposing athlete; {a['resolved_name_aliases']} unambiguous aliases are recorded in `metrics.json`. This identity mapping uses names/date/opponents, not labels or performance features; it is retrospective entity normalization, not a deployable live identity service.

Examples of source problems: career aliases such as Bobby Green/King Green, a reach value outside the supported physical range, and an abrupt change in average significant-strike values from roughly 26–36 in early years to roughly 4 in recent years. Ambiguous average striking/takedown/submission rate columns are excluded rather than guessing their units.

Age, height, reach and weight come from bout-specific columns. Zero/out-of-range physical values become missing. Historical strike/takedown accuracy differences have about {100*a['feature_missing_fraction']['striking_accuracy_diff']:.1f}% / {100*a['feature_missing_fraction']['takedown_accuracy_diff']:.1f}% missing values. A median imputer is fitted only on the augmented training set; it is saved inside the pipeline. Standard scaling is fitted only there as well. Scaling matters for Logistic Regression/MLP; it is harmless but unnecessary for the forest.

### Leakage controls and remaining provenance uncertainty

UFC wins, losses and current streaks are rebuilt from history dates **strictly before the target calendar day**. All fights on a day obtain features before any results from that day update the records. D/NC outcomes reset streaks and do not add W/L counts. Fighter IDs/names, odds/EV, rankings, finish details, ending round/time and current profile career totals are not model features. Same-day boundaries and the saved model's outputs are covered by tests.

Historical accuracy values are described as pre-bout by the source, but their effective collection timestamps cannot be independently certified. The project therefore does **not** claim complete historical provenance verification. An accuracy-free Logistic Regression sensitivity experiment is included. The earliest career records may be incomplete because the archive starts in 1994. Retroactively amended results can be reflected in current history; the source does not expose when amendments took effect. There is also no guarantee that every source-provided physical value is an original contemporaneous measurement.

## 3. Features and preprocessing

{feature_table}

All inputs are differences from A to B, giving 12 numeric features. Symmetric augmentation adds `(-X, 1-y)` for every training bout only. It does not add independent observations or enlarge the original-bout counts. This avoids a model simply treating the historically favored red corner as inherently stronger.

## 4. Chronological experimental design

{split_table}

No random splitting across past and future fights is used. The same athlete can occur in earlier training fights and later test fights: the estimate measures future-bout performance, not unseen-fighter generalization. Individual event dates are kept in one partition. History results from earlier validation/test fights may inform a later fight's record, as they would in an actual sequential prediction; estimator parameters, imputers and calibration remain frozen.

Fixed seed: {m['seed']}. Six configurations compare three families, with hyperparameters recorded in `metrics.json`. The Logistic Regression C values are 0.1/1; the forests use 350 trees and depth/leaf settings (10,12)/(8,25); MLPs use hidden sizes (32,16)/(16) and L2 alpha 1/3. Neural networks use up to 350 training epochs with no internal random validation early stopping. Their optimization curves are included; these are training losses, not independent generalization curves.

The lowest 2023 validation Brier score chooses one model. The selection is close: several configurations differ by less than 0.001, so no broad claim that one family is inherently superior is justified.

## 5. Validation and final results

{experiments}

**Selected configuration: {m['selected_model']}.**

For any pipeline, the corner-neutral probability is `p(A,B) = (raw_p(X) + 1 - raw_p(-X))/2`. A one-parameter logit slope is fitted only on the 2024 calibration partition, using mirrored logits and no intercept. The fitted slope is {cal['slope']:.6f}. Calibration Brier changes from {cal['before']['brier']:.4f} to {cal['after']['brier']:.4f}. A positive slope preserves ranking and complementary swap probabilities. The tested train-only pipeline plus that calibration is exactly the shipped model. There is no post-test refit.

{test_table}

### Baselines, uncertainty and metric interpretation

The final calibrated model has accuracy **{100*t['accuracy']:.2f}%**, AUC **{t['roc_auc']:.4f}**, F1 **{t['f1']:.4f}**, Brier **{t['brier']:.4f}** and log loss **{t['log_loss']:.4f}** on {m['splits']['test']['bouts']} test bouts. A constant 50/50 probability has Brier 0.2500 and AUC 0.5000. The training red-corner prior has test accuracy {100*baseline['accuracy']:.2f}%, Brier {baseline['brier']:.4f}, and AUC 0.5000. The Brier reduction versus 50/50 is {(1-t['brier']/.25)*100:.1f}% relative, and accuracy exceeds the constant-red prediction by {(t['accuracy']-baseline['accuracy'])*100:.2f} percentage points.

F1 uses the original A/red corner as the positive class. A constant-red classifier has F1 {baseline['f1']:.4f}, which exceeds the model's F1 while providing no ranking discrimination. This illustrates why one class's F1 alone is a poor criterion for a probability application. Accuracy, AUC and Brier must be assessed together. For a 50/50 tie, the implementation's `>= 0.5` classification rule predicts A; its displayed baseline accuracy is therefore the A win fraction, not an empirical random-coin simulation.

The 95% event-date block-bootstrap intervals (300 resamples) are accuracy **{100*ci['accuracy'][0]:.1f}%–{100*ci['accuracy'][1]:.1f}%**, AUC **{ci['roc_auc'][0]:.3f}–{ci['roc_auc'][1]:.3f}**, and Brier **{ci['brier'][0]:.3f}–{ci['brier'][1]:.3f}**. They summarize uncertainty for this test period, not an interval for a particular upcoming bout. Event resampling does not fully model dependence across repeated fighters or concept drift.

The accuracy-free Logistic Regression achieves accuracy {100*ablation['accuracy']:.2f}%, AUC {ablation['roc_auc']:.3f} and Brier {ablation['brier']:.3f}. It retains useful discrimination without the source accuracy columns. Because it also changes model family/calibration relative to the selected forest, it is a conservative sensitivity baseline and does not isolate the causal contribution of those columns.

## 6. Error analysis and subgroup checks

{subgroup}

There are substantially fewer female test fights than male fights. Subgroup estimates, especially small divisions, have high sampling uncertainty and are descriptive; no fairness or equal-calibration claim follows from these counts. Performance is weak in Light Heavyweight (AUC about 0.539, Brier about 0.250), so the overall result does not guarantee usefulness for each division.

Most confident incorrect predictions:

{error_table}

`test_predictions.csv` contains every held-out prediction; `confident_errors.csv` provides up to 30 high-confidence mistakes. These errors show that pre-bout measurements and records cannot capture all fight outcomes. The data do not include injuries, camp quality, game plans or in-fight events, so they cannot establish why a specific error occurred.

Validation permutation importance places age difference first, followed by historical strike accuracy and smoothed UFC win rate. Some correlated physical/record features have near-zero or negative permutation importance. These are noisy conditional associations, not evidence that height or reach cannot matter in MMA.

## 7. Prototype and explanation behavior

The app uses a Python standard-library HTTP backend and responsive vanilla HTML/CSS/JavaScript frontend. No external AI API, frontend build or API key is required. Every prediction calls the trained artifact at `/api/predict`; displayed probabilities are not scripted example values.

Users can search fighter snapshots, edit their fields, create custom fighters, swap A/B, and inspect results. Input validation checks numeric ranges, integer counts, contradictory streaks, sufficient numeric fields, duplicate fighter IDs and incompatible gender categories. Missing features use the saved training medians. Cross-division and unusual feature differences trigger contextual notices; the central 98% training range is a heuristic input-range check, not an uncertainty estimator.

The interface explains sensitivity by setting one observed feature difference to zero and recalculating the probability. Effects can overlap because counts, experience and smoothed win rate are correlated. This is neither a causal explanation nor an additive attribution decomposition.

## 8. Reproducibility, verification and responsible use

Pinned dependencies, bundled source snapshots, hashes, random seeds, chronological boundaries, the serialized preprocessing pipeline and exact experiment CSVs support reproducibility. `python train.py` regenerates artifacts. `python -m unittest discover -s tests -v` checks numerical contracts, A/B symmetry, partial missingness, validation, HTTP behavior, chronology, past-only record counts and reproduction of the recorded test predictions. The app runs offline after dependencies are installed. The local demonstration server is not a hardened public production service.

Data are public sports records. User-entered custom characteristics are not persisted by the application. The backend loads only the trusted project model; joblib artifacts must not be accepted from untrusted sources. The app does not claim UFC affiliation, live data access, guaranteed outcomes, causal interpretation, or validated betting performance. Review upstream provider terms before public redistribution. Students should disclose AI assistance as required by their institution and record their actual contributions.

## 9. Conclusion and next experiments

The implementation supplies a working trained-model demonstration and transparent held-out evidence. The selected model improves AUC and Brier over simple baselines for future bouts in the archived test period. It cannot establish statistically reliable probabilities for every individual hypothetical fight.

Further work should use independently timestamped per-round data, walk-forward retraining, unseen-fighter evaluation, additional held-out periods, stronger subgroup calibration checks, and independent verification of the source accuracy statistics. These were not performed in the submitted experiment.

## Figures

![Coverage](figures/data_coverage.png)

![Missingness](figures/missingness.png)

![Feature correlations](figures/feature_correlations.png)

![Model comparison](figures/model_comparison.png)

![ROC](figures/roc_curve.png)

![Calibration](figures/calibration.png)

![Confusion matrix](figures/confusion_matrix.png)

![Validation importance](figures/feature_importance.png)

![MLP training losses](figures/neural_learning_curves.png)

## Environment

Python {m['environment']['python']}; scikit-learn {m['environment']['sklearn']}; NumPy {m['environment']['numpy']}; pandas {m['environment']['pandas']}. Full package versions: `requirements.txt`.
'''
    (ROOT/'reports'/'REPORT.md').write_text(text,encoding='utf-8')
    # Small renderer for this report's headings, paragraphs, tables, links and figures.
    # No external packages, JavaScript or internet assets are needed to view it.
    def inline(value):
        value=html.escape(value)
        value=re.sub(r'`([^`]+)`',r'<code>\1</code>',value)
        value=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',value)
        return re.sub(r'\[([^]]+)\]\((https?://[^)]+)\)',r'<a href="\2">\1</a>',value)
    blocks=[];lines=text.splitlines();i=0
    while i < len(lines):
        line=lines[i].strip()
        if not line:i+=1;continue
        if line.startswith('#'):
            level=len(line)-len(line.lstrip('#'));blocks.append(f'<h{level}>{inline(line[level:].strip())}</h{level}>');i+=1
        elif line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]);i+=1
            head='<thead><tr>'+''.join('<th>'+inline(c)+'</th>' for c in rows[0])+'</tr></thead>'
            body='<tbody>'+''.join('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>' for row in rows[2:])+'</tbody>'
            blocks.append('<div class="table-scroll"><table>'+head+body+'</table></div>')
        elif line.startswith('!['):
            match=re.match(r'!\[([^]]+)\]\(([^)]+)\)',line)
            if match:blocks.append(f'<figure><img src="{html.escape(match[2])}" alt="{html.escape(match[1])}"><figcaption>{html.escape(match[1])}</figcaption></figure>')
            i+=1
        else:
            paragraph=[]
            while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','![')):
                paragraph.append(lines[i].strip());i+=1
            blocks.append('<p>'+inline(' '.join(paragraph))+'</p>')
    body='\n'.join(blocks)
    document=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FightPredict AI — Technical Report</title><style>body{{max-width:1040px;margin:40px auto;padding:0 28px;color:#263240;background:#f7f8fa;font:14px/1.8 Arial,sans-serif}}main{{background:white;border:1px solid #dce2e8;padding:38px}}h1{{font-size:30px;line-height:1.3;letter-spacing:-.8px}}h2{{margin:38px 0 14px;padding-top:18px;border-top:1px solid #dce2e8;font-size:23px}}h3{{margin-top:26px}}p{{margin:14px 0}}a{{color:#4961b9}}code{{background:#f0f3f6;padding:2px 4px;font-size:12px;overflow-wrap:anywhere}}.table-scroll{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:12px;margin:20px 0}}th{{background:#edf1f6;text-align:left}}th,td{{padding:9px 10px;border:1px solid #dde3e8}}figure{{margin:28px 0;padding:15px;border:1px solid #dce2e8;break-inside:avoid}}img{{max-width:100%;height:auto;display:block;margin:auto}}figcaption{{color:#667585;font-size:11px;text-align:center}}@media(max-width:700px){{body{{padding:0 12px;margin:18px auto}}main{{padding:18px}}table{{font-size:10px}}h1{{font-size:24px}}}}@media print{{body{{background:white;margin:0;max-width:none;padding:0;font-size:11px}}main{{border:0;padding:0}}h2{{break-after:avoid}}table{{font-size:9px}}figure{{break-inside:avoid}}}}</style></head><body><main>{body}</main></body></html>'''
    (ROOT/'reports'/'REPORT.html').write_text(document,encoding='utf-8')
    print('Generated reports/REPORT.md and reports/REPORT.html')

if __name__ == '__main__': main()
