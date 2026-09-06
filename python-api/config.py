"""Shared configuration: the universe, credentials, and the constants more than
one module needs."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

SP500_TICKERS_PATH = Path(__file__).parent / "data" / "sp500_tickers.json"
SP500_INDEX_TICKER = "^GSPC"
RISK_FREE_TICKER = "^IRX"

with open(SP500_TICKERS_PATH, encoding="utf-8") as f:
    SP500_TICKERS: list[str] = json.load(f)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Shared secret guarding the backfill routes. Unset means the routes refuse
# every caller rather than admitting every caller: an ingest job that pins the
# CPU for ten minutes is not something to leave open by default, and a
# misconfigured deploy should fail loudly.
BACKFILL_TOKEN = os.environ.get("BACKFILL_TOKEN")

# Shared secret proving a solve request came through the dashboard's own proxy
# rather than from a loop pointed at the service URL. Unset leaves the check
# off, which is what keeps local development and the sweep script working.
MARGIN_ORIGIN_SECRET = os.environ.get("MARGIN_ORIGIN_SECRET")

# Comma-separated in the environment so a deployed dashboard can be allowed
# without editing code.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:3000"
    ).split(",")
    if origin.strip()
]

# PostgREST caps a response at 1000 rows, so the page size is a ceiling rather
# than a choice.
SELECT_PAGE_SIZE = 1000
UPSERT_CHUNK_SIZE = 500
# Tickers per yfinance download and per `in_()` filter.
FETCH_CHUNK_SIZE = 50
