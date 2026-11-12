# Data

Raw files live in `data/raw/`. Running `python -m arena.prep` turns them into the tidy tables in `data/processed/`.

| Dataset | Files | Rows | What the game learns from it | Source and license |
|---|---|---|---|---|
| UFC bouts (Ultimate UFC Dataset, via TidyTuesday 2026-07-07) | `raw/ultimate_ufc_dataset.csv`, `raw/ufc_fights.csv`, `raw/ufcstats_data.csv`, `raw/readme.md` | 7,177 bouts | Skill model (striking, wrestling, grappling, experience, reach, age, stance), finish model, reach model | [TidyTuesday](https://github.com/rfordatascience/tidytuesday/tree/main/data/2026/2026-07-07); URLs and SHA-256 hashes in `raw/sources.json` |
| Sumo bouts and wrestler measurements | `raw/sumo/bouts.csv`, `measurements.csv`, `rikishi.csv`, `banzuke.csv` | 390,680 bouts, 2000–2026 (385,729 with weights) | Size model: sumo has no weight classes, so it shows how much a size advantage wins | [sumo-api.com](https://www.sumo-api.com) (free API); rebuild with `scripts/fetch_sumo.py` |
| ADCC submission grappling | `raw/adcc_historical_data.csv` | 1,028 matches (189 open-weight) | External check and rescaling of the size effect, using skilled open-weight fights | Kaggle: *ADCC historical dataset* (scraped from bjjheroes.com) |
| Body Performance | `raw/bodyPerformance.csv` | 13,393 people | Fitness models: sit-ups and broad jump → grip strength and fitness class A–D; percentile tables that turn push-ups into these tests | Kaggle: *Body Performance Data* (Korea Sports Promotion Foundation) |
| OpenPowerlifting | `raw/openpowerlifting/opl_raw_sbd.csv.gz` (+ `source.json`) | 1.14M raw full-power results, 330K lifters | Strength model: how strength grows with bodyweight, sex and age | [openpowerlifting.org](https://www.openpowerlifting.org), public domain; rebuild with `scripts/fetch_openpowerlifting.py` |

Notes:

- `raw/openpowerlifting/openpowerlifting-latest.zip` (171 MB) and `raw/sumo/cache/` aren't committed. The fetch scripts recreate them, and the original archive's hash is recorded in `source.json`.
- Lifter names in OpenPowerlifting are replaced with salted hashes at download. The game never needs to know who lifted.
- ADCC records only the weight class each athlete entered. A typical competition weight is assumed per class (see `ADCC_CLASS_KG` in `arena/prep.py`).
- UFC strike and takedown volumes changed units in the source in 2019, so every style statistic is converted to a within-year percentile.
- `data/arena.db` is the game's runtime SQLite database (rooms and players). It isn't committed.
- Push-up norms (not a dataset file): CSEP-PATH Resource Manual, 2nd ed. (Canadian Society for Exercise Physiology, 2019), reprinted in ACE's *Push-up Assessment Protocol*. The cut-offs are in `PUSHUP_NORMS` in `arena/engine.py`.
