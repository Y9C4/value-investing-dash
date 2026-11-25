# Solver service

FastAPI service that extracts and loads market data into the warehouse and runs
the mean-variance optimiser. Every other number the dashboard shows is computed
in SQL by the warehouse (`supabase/migrations/20261117000001_create_warehouse.sql`)
and read by the site straight from Postgres.

Setup, endpoints, deployment and the reasoning behind the design are in the
[root readme](../README.md); the warehouse design is in
[`notebooks/backtests.md` §17](notebooks/backtests.md).

```bash
python -m venv .venv
.venv/Scripts/activate            # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt   # add -r requirements-dev.txt for notebooks and backtest/ml
cp .env.example .env              # DATABASE_URL, backfill token

uvicorn main:app --reload --port 8000
```

## Module map

| file | owns |
|---|---|
| `main.py` | HTTP surface — routes only, each delegating to the modules below |
| `pipeline.py` | the scheduled stages in dependency order, each recorded in `job_runs` |
| `ingest.py` | extract and load: yfinance and Ken French rows into the `raw` schema, untouched |
| `dw.py` | direct Postgres: bulk upserts into `raw` and `warehouse.refresh()` |
| `frontier.py` | mean-variance optimisation: trace, tangency, risk decomposition |
| `market.py` | price and cash-rate reads from the serving layer, with their caches |
| `jobs.py` | records each pipeline stage to `job_runs` |
| `factors.py` | Ken French download and parse (used by `ingest.py`) |
| `config.py` | the universe, credentials, shared constants |
| `backtest/` | the frozen backtest dataset loader, leak tests, and `ml/` model scripts |

No longer imported, kept for reference (see their docstrings): `backfill.py`,
`fundamentals.py`, `engine.py`, `universe.py`, and the forward models in
`valuation.py`. Their data work moved into the warehouse; the forward
fair-value models were retired outright (`20261117000003_drop_forward_models.sql`).

## Model scripts

```bash
.venv/Scripts/python -m backtest.ml.tree    # regression tree on realised alpha, date-block bootstrap
```

They read `backtest/output/model_data.parquet`, which the last cell of
`notebooks/backtest.ipynb` writes.
