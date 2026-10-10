# FightPredict AI

A complete local UFC prediction application, with a **real trained Random Forest**, a browser frontend, reproducible experiments and a technical report.

## Quick start — Windows

1. Install **Python 3.12** from https://www.python.org/downloads/ and include the Python launcher.
2. Extract the archive. Open the `fightpredict` folder.
3. Double-click `run_windows.bat`. On the first run it installs the pinned dependencies.
4. Open **http://127.0.0.1:8000** in your browser. Leave the terminal open.

The model is already trained. **You do not need to run training to demonstrate the app.** Internet is required to install dependencies once; after installation the app uses bundled data and works offline.

Если Python уже установлен: распакуй архив, открой папку `fightpredict`, запусти `run_windows.bat` и перейди на http://127.0.0.1:8000. Не закрывай консоль, пока пользуешься приложением.

## Manual start — Windows / macOS / Linux

Use Python **3.12 or 3.13**. Pinned packages require Python >=3.11; Python 3.12 is the recommended reproducible setup.

```bash
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

macOS / Linux:

```bash
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python app.py
```

Open http://127.0.0.1:8000. If the port is occupied, run `python app.py --port 8001` and open http://127.0.0.1:8001. The ordinary script binds to localhost. The browser page must be opened through the Python server, not by double-clicking `index.html`.

## What you can demonstrate

- Search two fighters from **2,182 historical snapshots**.
- View and edit height, reach, age, weight, prior UFC records and historical accuracy statistics.
- Enter two custom fighters. Empty numeric values are allowed when at least six characteristics per fighter are provided.
- Estimate complementary A/B win probabilities using the saved model.
- Swap fighters: probabilities reverse, without a corner-assignment advantage.
- Inspect local feature sensitivity, missing-data and unusual-matchup notices.
- Open **Model & evidence** to see actual model comparisons, chronology, calibration and feature importance.

Named fighters use their **latest recorded pre-bout snapshot**, not live career statistics and not the post-fight record. The snapshot date is displayed. Wins/losses mean observed UFC bouts, not full professional MMA careers. Accuracy inputs use **0–100 percent**, height/reach centimeters, weight kilograms.

## Trained artifact and measured results

`models/fightpredict.joblib` contains the complete preprocessing pipeline, Random Forest and calibration slope. `models/fighters.json` contains the frontend catalog. Keep these files together with the source tree.

| Chronological test metric | Result |
|---|---:|
| Test bouts, 2025-01-11 to 2026-03-28 | 627 |
| Accuracy | 67.30% |
| ROC-AUC | 0.7233 |
| F1 (A/original red positive) | 0.7007 |
| Brier score, lower is better | 0.2137 |
| Log loss | 0.6168 |

These are measured held-out results, not a promise of future accuracy. A 50/50 estimate has Brier score 0.2500. The original red-corner prior is also reported as a baseline. See `reports/metrics.json` for confidence intervals, subgroup results and exact hyperparameters.

## Reproduce training

Run inside this folder with the installed environment:

```bash
python train.py
python -m unittest discover -s tests -v
```

Optional browser checks (Node is needed only for these tests):

```bash
npm install --no-save playwright
npx playwright install chromium
node tests/browser_smoke.cjs
```

The browser test starts its own Python server on port 8765, checks named/custom predictions, swapping, validation and mobile/tablet layouts, and saves screenshots plus `reports/browser_verification.json`. Use `PYTHON_EXECUTABLE` to select the Python environment when needed. This is separate from the ordinary Python-only app startup.

`train.py` uses bundled CSVs and does not need network access when they are present. It trains six configurations across Logistic Regression, Random Forest and a multilayer perceptron. It chooses the smallest **2023 validation Brier score**, calibrates only on **2024**, and evaluates only on **2025–2026**. It deliberately does not refit on the test set. Reported timings vary by hardware; numerical results may differ slightly across platforms.

The default source snapshot is bundled and checksummed in `data/raw/sources.json`. To intentionally download the current upstream revision:

```bash
python dataset.py --refresh
python train.py
```

Refreshing changes the input snapshot and may change all reported results. Keep the bundled data for the submitted experiment.

## Predict directly from Python

```python
from inference import Predictor

predictor = Predictor()
a = next(f for f in predictor.catalog if f['name'] == 'Merab Dvalishvili')
b = next(f for f in predictor.catalog if f['name'] == 'Umar Nurmagomedov')
result = predictor.predict(a, b)
print(result['probability_a'], result['probability_b'])
```

For custom predictions, pass dictionaries with the fields in `features.FIELDS`. Optional metadata: `name`, `id`, `snapshot_date`, `gender`, `weight_class`. Never load an untrusted `.joblib` file.

## HTTP API

- `GET /api/health`: model status.
- `GET /api/fighters`: historical fighter catalog.
- `GET /api/schema`: numeric fields, units and validation limits.
- `GET /api/metrics`: complete experiment evidence.
- `POST /api/predict`: JSON `{"fighter_a": {...}, "fighter_b": {...}}`.

The frontend is plain HTML/CSS/JavaScript. The backend uses Python's standard-library HTTP server, so Node, Flask, FastAPI and API keys are not required.

## Project layout

| File / directory | Purpose |
|---|---|
| `features.py` | Shared feature contract, input validation and symmetric probabilities |
| `dataset.py` | Download, source audit, entity aliases and past-only UFC record reconstruction |
| `train.py` | Model comparison, calibration, evaluation and plots |
| `inference.py` | Load trained artifact, predict and explain sensitivity |
| `app.py` | Local API and frontend server |
| `web/` | Responsive browser interface |
| `models/` | Trained main model, accuracy-free baseline and fighter snapshots |
| `data/raw/` | Bundled original CSVs, original data dictionary and SHA-256 manifest |
| `data/processed_bouts.csv` | Audited feature matrix and bout metadata |
| `reports/` | Technical report, exact metrics, errors, prediction CSVs and figures |
| `tests/` | Numerical, HTTP, data chronology and artifact verification |
| `docs/` | Defense notes, contribution template and rubric mapping |

## Docker (optional)

```bash
docker build -t fightpredict .
docker run --rm -p 127.0.0.1:8000:8000 fightpredict
```

Docker was not required for the local demonstration; the normal Python launcher is the simplest path.

## Data provenance and limitations

Source: [TidyTuesday, 2026-07-07](https://github.com/rfordatascience/tidytuesday/blob/main/data/2026/2026-07-07/readme.md), compiled through `fightr` from UFCStats and the Ultimate UFC Dataset. The project uses 7,150 audited decisive bouts. No betting odds, post-fight finish fields, fighter names or current career aggregates are model inputs.

Record features come from fights strictly earlier than the target calendar day, with names reconciled using event/opponent evidence. Historical accuracy columns are described as pre-bout by the source; their precise collection timestamps cannot be independently verified. The report includes a separate model that excludes them. The archived history starts in 1994, so the very earliest career records can be incomplete. Historical results may include later result amendments; effective amendment dates are unavailable.

Predictions are conditional on an A/B winner; draws and no contests are excluded. This is an educational sports analytics prototype, not a claim of statistically certain individual predictions. A fighter can be in both training and test at different dates: evaluation measures future bouts, not generalization to wholly unseen people. Cross-division matchups and old snapshots have additional uncertainty. Local feature sensitivity is neither causal nor additive.

## Attribution and submission

Original data and logos remain subject to their original providers' terms; this project does not claim ownership of UFC data or UFC affiliation. Source URLs and original dictionary are included. Before public redistribution, review the upstream data terms.

The generated implementation must be reviewed and understood by the presenting students. Fill in `docs/CONTRIBUTIONS.md` with actual work, disclose assistance according to your course rules, and practice the explanations in `docs/DEFENSE_GUIDE.md`.
