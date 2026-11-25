import sys
from pathlib import Path

# The service modules are top-level (`import pipeline`), so tests run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
