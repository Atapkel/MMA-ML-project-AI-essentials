# Defense preparation

The supplied rubric recommends 10–15 slides and gives 6 minutes for presentation, 5 minutes for demonstration and 3 minutes for questions. The following is a slide outline and speaking guide, not an already created PowerPoint.

## Suggested 12-slide outline (6 minutes)

| Slide | Message | Evidence |
|---|---|---|
| 1 | FightPredict AI: estimating UFC win probability | App title and research question |
| 2 | Physical attributes alone do not determine the winner | Task, users and unobserved factors |
| 3 | 7,150 audited decisive bouts; 2,182 snapshots | `metrics.json`, coverage plot |
| 4 | Clean labels, resolve names, avoid mixed-unit columns | Source audit and alias examples |
| 5 | Past-only UFC records and 12 A-minus-B features | Feature definitions and chronology |
| 6 | Train ≤2022, validation 2023, calibration 2024, test 2025–2026 | Split table |
| 7 | LR, Random Forest and small MLPs: six configurations | Validation comparison plot |
| 8 | Select by validation Brier; calibrate probabilities separately | Calibration description |
| 9 | Accuracy 67.3%, AUC 0.723, Brier 0.214 on 627 held-out bouts | Test metrics, bootstrap intervals |
| 10 | Weak divisions and high-confidence mistakes | Subgroup metrics and error CSV |
| 11 | Working frontend connected to the trained artifact | Live demo |
| 12 | Limits, actual participant contributions and future work | Provenance caveats and contribution table |

## Five-minute demonstration

1. Start `run_windows.bat` or `python app.py` before your allotted demo time. Open http://127.0.0.1:8000.
2. Show the default Merab Dvalishvili / Umar Nurmagomedov matchup. Point out that snapshots are historical and pre-bout.
3. Open performance fields and explain UFC-only record counts, accuracy percentages, kilograms and centimeters.
4. Calculate the estimate and show complementary probabilities. Use Swap fighters: the estimate must reverse.
5. Click Enter a custom fighter, change age/reach or accuracy, then recalculate. Explain association and non-causal sensitivity.
6. Leave an accuracy field blank to show supported missing-value handling; demonstrate an invalid input if time permits.
7. Open Model & evidence. Show that the report compares models on validation and reserves future bouts for final testing.

## Questions you should be able to answer

**What is the label?** A=1 for an original red-corner win and A=0 for a blue win. Draws and no contests are excluded; probabilities are conditional on a decisive outcome.

**Why AI?** Several correlated attributes interact. A supervised model estimates statistical patterns from historical examples instead of manually assigning weights.

**What is leakage?** Information unavailable before the target fight enters its prediction. Finish details obviously leak. Current career records can leak future wins. We reconstruct records from earlier dates and keep preprocessing within training.

**Can you guarantee no leakage in the raw source?** No. Accuracy fields are labeled as historical pre-bout by the provider, but independent timestamp verification is unavailable. Physical measurements and amended outcomes also have provenance limits. We disclose these and include an accuracy-free baseline.

**Why not a random split?** It would mix future fights into training while evaluating earlier fights. The chronological test better matches the intended future-fight use case.

**Why Brier Score?** It measures the squared error of probabilities. Predicting 99% and losing is penalized more strongly than predicting 51% and losing. The frontend displays probabilities, so calibration matters.

**Why is the baseline F1 higher?** Single-class F1 favors the original majority/red class. Always predicting red obtains a deceptively high F1 without discriminating fighters. The selected model improves accuracy, AUC and Brier; do not claim it improves every metric.

**Why Random Forest?** It has the lowest 2023 validation Brier in the fixed comparison. Differences among the best models are small. Test metrics did not determine selection.

**What does calibration do?** It scales the log odds using the separate 2024 sample. No intercept means swapping A/B still produces complementary probabilities.

**Why 50/50 for identical attributes?** Symmetric inference averages forward and reverse predictions. An identical feature vector yields equal probabilities, regardless of arbitrary corners.

**What does feature importance mean?** It measures validation AUC drop when one feature is shuffled. It is predictive association, not causality. Correlated features can hide or overlap importance.

**Can this predict a fighter the model has never seen?** It can accept custom inputs, but unseen-fighter performance was not separately evaluated. The existing test includes future fights by athletes who may also occur in training.

**Why does it make mistakes?** Injuries, tactics, preparation and randomness are not fully represented. We have examples of confident errors and do not guarantee individual outcomes.

**Is a probability interval shown for a bout?** No. The bootstrap intervals describe aggregate test metrics. Input-range notices are a heuristic, not an individual confidence interval.

**How do I retrain?** `python train.py` uses the bundled checksummed dataset, trains the comparison, calibrates, saves the model, and regenerates metrics, plots and report.

**What did you personally contribute?** Answer from actual work recorded in `CONTRIBUTIONS.md`, not from a fabricated allocation. Be ready to trace one input from the frontend through feature generation, preprocessing, forest inference and calibration.
