# Fight Arena 🥊

> **Final project: AI Essentials: Theory and Applications**
> Group **AAI-2604**: Beibarys, Yedil, Abdurahman

**Who wins in your group?** In this multiplayer party game, everyone joins a room from their phone (link or QR
code), enters their body, training and a quick strength test, and AI models trained on real combat-sport
data simulate the fights. The host picks one of two modes:

- **Battle royale (Top 3 / 5 / 10):** everyone is compared with everyone and ranked by expected win rate. An animated battle royale shows fighters knocked out from last place upwards, then the final. Each place comes with an explanation of *why*.
- **Tournament:** a random single-elimination bracket. Every fight is simulated from the AI's win chance (so upsets happen) and animated, ending in a KO, submission or decision.

Final project for *AI Essentials: Theory and Applications*. Every prediction comes from models trained in this
repository.

## How the AI works

A player only answers what people actually know: sex, age, height, weight, dominant hand, three 0–5 skill levels
(striking, wrestling, grappling) and their max push-ups in a row (optional). Everything else is estimated by models.
Push-ups become a percentile for the player's age and sex using the CSEP push-up norms (CSEP-PATH, 2019). The fitness
model's own training data then supplies the sit-up and broad-jump values at that percentile, so the trained grip and
fitness-class models get the inputs they were trained on.

| Model | Trained on | Learns | Used for |
|---|---|---|---|
| Reach | 2,241 UFC fighters | height, weight, sex → reach | nobody has to measure their reach |
| Strength | 330K OpenPowerlifting lifters | sex, age, bodyweight → strength | how much stronger a bigger, younger or male body is |
| Grip + fitness class | 13K Body Performance tests | body + sit-ups + broad jump (from push-ups) → grip strength, class A–D | the power check: beating people your size raises your strength |
| Size | 385K sumo bouts (no weight classes), rescaled on ADCC open-weight matches | strength ratio → win chance, controlling for rank (skill) | what happens when 60 kg meets 100 kg |
| Skill | 6,100 UFC fights | striking, wrestling, grappling, experience, reach, age, stance differences → win chance | who is the better fighter |
| Finish | 6,000 UFC fights | winner's and loser's styles → KO / submission / decision | how the animated fight ends |

The win chance is one additive formula, which is what makes every result explainable:

```
logit P(A beats B) = skill(A − B)  +  β · log(Strength_A / Strength_B)
Strength = strength_model(sex, age, weight) × (grip with tests / grip without tests)
```

Each factor is explained on its own: "if the two were equal in everything else, Bek would win 62% on body size alone",
with the real numbers behind it ("Bek is 16 kg heavier"). Ranking mode averages each factor over the group and adds a
who-beats-whom grid. Tournament mode shows a breakdown after every fight: factors, a side-by-side comparison, why the
finish model expected that finish, and what an upset means.

## Explainable AI and the AI Lab

- **SHAP waterfall in every fight.** The win formula is additive in log-odds, so each factor's part (coefficient × difference)
  is its exact SHAP value relative to an equal opponent. Each fight shows the chance built up from 50%, one factor at a time.
- **What if…? (counterfactual).** Change a fighter's weight, age, push-ups or skill levels and the same trained models re-run
  (`POST /api/rooms/{code}/whatif`). It answers "what would have to change for the result to change?".
- **UFC twin (k-nearest neighbours).** Each player is matched to the 3 closest UFC fighters on 5 style percentiles + height +
  weight (z-scored, Euclidean). k-NN needs no training.
- **AI Lab page (`/lab`, or `/lab?room=CODE` for a room's players).** Baseline-vs-model scores for every task, ROC curve and
  calibration of the deployed skill model on unseen 2024+ fights, permutation feature importance for five models, coefficients,
  confusion matrices, the strength/age/size curves, where each player stands among 330K lifters and 2,241 UFC fighters, and their
  UFC twins. The data comes from `python -m arena.lab`, which only evaluates the saved models (`models/ai_lab.json`,
  `models/ufc_fighters_knn.json`).

## Results (from `reports/metrics.json`)

Every task compares a baseline with at least two models on a leakage-free split (by time for fights, by person for
physical data). Figures are in `reports/figures/`.

| Task | Metric | Baseline | Chosen model | Result |
|---|---|---|---|---|
| Reach | MAE, cm (lower is better) | 4.034 | Linear regression | **3.932** |
| Strength | MAE, kg | 80.1 | Polynomial regression (log-log) | **63.67** |
| Fitness class A–D | F1-macro (higher is better) | 0.1001 | Gradient boosting | **0.5841** |
| Grip strength | MAE, kg | 4.964 | Gradient boosting | **3.885** |
| Size (sumo, 2022+ test) | log loss | 0.6931 (coin flip), 0.692 (rank only) | Rank + strength ratio (powerlifting model) | **0.6924** |
| Size (ADCC open weight, external) | AUC | 0.5 | sumo size score | **0.6499** (weight ratio only: 0.5987) |
| Skill (UFC, 2024+ test) | AUC / log loss | 0.5 / 0.6931 | Logistic regression (C=0.03) | **0.7058 / 0.6346** |
| Finish method (UFC, 2024+ test) | F1-macro / log loss | 0.2298 / 0.9988 | Multinomial logistic regression | **0.4239 / 0.8977** |

Size-effect strength: sumo coefficient 0.7596 × ADCC scale 4.872 (95% CI 1.626–8.324) = **β = 3.7012**.
Within professional sumo, size adds little beyond rank: everyone already weighs about 130 kg, and the heavier wrestler wins only 51% of bouts (53% with a 50+ kg gap). So the strength of the effect comes mostly from the open-weight ADCC matches.


**One documented design assumption:** the skill model learned from UFC professionals, who are all trained, so it
underrates the gap between trained and untrained people. Trained-skill contributions (striking, wrestling, grappling,
experience) are therefore multiplied by `SKILL_BOOST = 2` (`arena/engine.py`). Self-rated levels 0–5 are placed on
the UFC fighters' percentiles for that skill (`LEVEL_PERCENTILE`).

## Run it

Requires Python 3.12.

```bash
pip install -r requirements-train.txt        # or: uv sync
uvicorn arena.app:app --host 0.0.0.0 --port 8000
```

Open http://127.0.0.1:8000 and create a room. To try it alone, use **Fill with famous fighters** in the lobby, which adds 10 well-known UFC fighters with approximate public stats (`arena/demo.py`). For phones on the same Wi-Fi, open the laptop's address instead
(for example `http://192.168.1.20:8000`) so the QR code points somewhere the phones can reach.

The trained models are included (`models/arena_models.joblib`, about 1 MB), so the app runs without training.

### Rebuild everything from the raw data

```bash
python scripts/fetch_sumo.py                 # sumo bouts + measurements (cached; about 30 min the first time)
python scripts/fetch_openpowerlifting.py     # 171 MB download → compact strength table
python -m arena.prep                         # clean all datasets → data/processed/
python -m arena.train                        # train + compare models → models/, reports/metrics.json, reports/figures/
python -m arena.lab                          # evaluate the saved models for the AI Lab page (no training, ~6 s)
python -m pytest                             # engine and API tests
```

The UFC, ADCC and Body Performance files are already in `data/raw/`. See [data/README.md](data/README.md) for every
source, row count and license.

### Deploy online (so anyone can join by QR)

The repository includes a `Dockerfile` and a Render blueprint (`render.yaml`):

1. Push the repository to GitHub.
2. On [render.com](https://render.com): **New + → Blueprint**, then pick the repository.
3. Open the URL Render gives you. QR codes automatically use that public address.

The free plan sleeps when idle, so the first load can take about 30 s. Rooms live in SQLite and are temporary by design:
they're deleted after 2 days and also reset when the server restarts. Any Docker host works:
`docker build -t fight-arena . && docker run -p 8000:8000 fight-arena`.

## Project layout

```
arena/prep.py      clean the 6 raw datasets → data/processed/
arena/train.py     train and compare models (baseline + ≥2 approaches each), write metrics + figures
arena/lab.py       evaluate the saved models for the AI Lab (ROC, calibration, importance, confusion) + k-NN fighter table
arena/engine.py    player profile → model inputs; matchup probability + explanation; ranking; tournament; fight script
arena/store.py     SQLite storage for rooms and players
arena/app.py       FastAPI: rooms, join, QR code, start, results
web/               mobile-first front end (lobby + QR, form + strength test, canvas fight animation, results)
scripts/           data download scripts (sumo API, OpenPowerlifting)
tests/             engine behaviour + end-to-end API tests
reports/           metrics.json and figures from training
```

## Limitations

- The data describes professionals and elite athletes, not amateurs. Submission skill barely predicts UFC wins, so grappling counts for little even after the ×2 factor.
- Push-ups → fitness assumes the CSEP categories are quintiles and that push-up fitness ranks the same as sit-up and jump fitness.
- Mapping self-rated levels onto pro percentiles and the ×2 skill factor are assumptions, not learned facts.
- Sumo is a pushing sport, so its size effect is shape-only. The strength of the effect comes from 125 ADCC open-weight matches, which leaves a wide confidence interval (see `reports/metrics.json`).
- ADCC records weight classes, not weights. A typical weight per class is assumed.
- It's a game. Real fights depend on far more than these inputs, and nobody should use it to decide a real fight.
