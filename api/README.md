# Market data microservice

FastAPI service that wraps `yfinance` and serves quote/history/info data to the Next.js dashboard. Also backfills daily close prices into Supabase.

## Setup

```bash
cd api
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill in your Supabase project URL and **service role key** (Supabase dashboard → Project Settings → API). The service role key is required only for `/backfill/sp500-daily-close` (it bypasses RLS for bulk writes) — the rest of the endpoints work without it.

## Run

```bash
uvicorn main:app --reload --port 8000
```

## Endpoints

- `GET /health` — liveness check
- `GET /quote/{ticker}` — latest price snapshot
- `GET /info/{ticker}` — full yfinance ticker info
- `GET /history/{ticker}?period=1y&interval=1d` — OHLCV candles
- `POST /backfill/sp500-daily-close` — fetches the last 1 year of daily close prices for all S&P 500 constituents (`data/sp500_tickers.json`) plus the `^GSPC` index, and upserts them into the Supabase `daily_close_prices` table (`date, ticker` primary key, so re-running is safe and only adds new rows)
