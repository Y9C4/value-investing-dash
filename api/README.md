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

## Refreshing everything

One call runs every stage in dependency order and recomputes the valuations
last (they read the three tables above them):

```bash
curl -X POST "http://127.0.0.1:8000/backfill/all?skip_fundamentals=true"  # ~2 min, the daily shape
curl -X POST "http://127.0.0.1:8000/backfill/all"                        # ~10 min, includes statements
curl -X POST "http://127.0.0.1:8000/backfill/all?full=true"              # also re-pulls the 2y price window
```

The dashboard exposes the same thing as "Refresh everything" at the top of
`/data`. See the root `readme.md` for what each flag is for and why a
short-history ticker is not necessarily a backfill gap.

## Endpoints

- `GET /health` — liveness check
- `GET /quote/{ticker}` — latest price snapshot
- `GET /info/{ticker}` — full yfinance ticker info
- `GET /history/{ticker}?period=1y&interval=1d` — OHLCV candles
- `GET /returns/{ticker}` — daily close price + log returns (stock, market, excess) for up to the last 252 trading days, plus the 2x2 variance-covariance matrix of stock/market log returns and the average annualized risk-free rate (^IRX)
- `POST /backfill/sp500-daily-close` — fetches the last 1 year of daily close prices for all S&P 500 constituents (`data/sp500_tickers.json`) plus the `^GSPC` index and the `^IRX` risk-free rate proxy, and upserts them into the Supabase `daily_close_prices` table (`date, ticker` primary key, so re-running is safe and only adds new rows)
