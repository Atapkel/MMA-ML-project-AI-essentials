"""Project paths in one place."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data' / 'raw'
PROCESSED = ROOT / 'data' / 'processed'
MODELS = ROOT / 'models'
REPORTS = ROOT / 'reports'
FIGURES = REPORTS / 'figures'
WEB = ROOT / 'web'
DB_PATH = ROOT / 'data' / 'arena.db'

MODEL_FILE = MODELS / 'arena_models.joblib'
