# FightPredict — ML only

This folder contains only the machine-learning portion of the project.

## Files

- `FightPredict_ML.ipynb` — data exploration, chronological splitting, model training, selection, calibration, and final evaluation.
- `data/processed_bouts.csv` — the prepared bout-level dataset used by the notebook.
- `requirements.txt` — Python dependencies.

## Run

Open `FightPredict_ML.ipynb` in Jupyter Notebook, JupyterLab, or VS Code and run all cells from top to bottom.

The notebook uses chronological splits:

- training: before 2023
- validation/model selection: 2023
- probability calibration: 2024
- final test: 2025 and later

The test set is used only once for final evaluation.
