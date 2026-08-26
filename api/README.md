# Solver service

FastAPI service that owns everything numerical: the valuation models, the
mean-variance optimiser, and every write to Postgres. The Next.js dashboard
talks to it over HTTP.

Setup, endpoints, deployment and the reasoning behind the design are in the
[root readme](../readme.md).

```bash
python -m venv .venv
.venv/Scripts/activate            # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt   # add -r requirements-dev.txt for notebooks
cp .env.example .env              # Supabase URL + service role key

uvicorn main:app --reload --port 8000
```

## Module map

| file | owns |
|---|---|
| `main.py` | HTTP surface — routes only, each delegating to the modules below |
| `frontier.py` | mean-variance optimisation: trace, tangency, risk decomposition |
| `valuation.py` | the five models, as pure functions over plain inputs |
| `engine.py` | runs every model across the universe in two passes |
| `backfill.py` | ingest jobs, in dependency order |
| `market.py` | price and return reads, with their caches |
| `universe.py` | assembles the scored universe the screener consumes |
| `db.py` | Supabase access: one client, one retry policy, paging and batching |
| `fundamentals.py` / `factors.py` | yfinance and Ken French ingest |
| `config.py` | the universe, credentials, shared constants |
