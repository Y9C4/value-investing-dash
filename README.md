# value-investing-dash

A Next.js dashboard that values every S&P 500 company with a set of standard
models, screens on the results, and builds a mean-variance optimal portfolio
from whatever survives the screen. A FastAPI service alongside it wraps
`yfinance`, keeps the market data in Supabase, and runs the optimiser.

The three pages run in order: **Screener** → **Portfolio builder**, with
**Data** behind them keeping the tables current.

## Setup

```bash
pnpm install          # dashboard
npx playwright install chromium   # only needed to run the test sweeps

cd api
python -m venv .venv
.venv\Scripts\activate            # Windows
pip install -r requirements.txt
```

Copy `api/.env.example` to `api/.env` and fill in your Supabase project URL and
**service role key** (Supabase dashboard → Project Settings → API). The service
role key is what lets the backfills bypass RLS for bulk writes.

## Run

```bash
pnpm dev                                    # dashboard on :3000
cd api && uvicorn main:app --reload --port 8000   # market data service on :8000
```

## Refreshing the data

**Use the "Refresh everything" button at the top of `/data`.** It runs every
stage in the order they depend on each other and recomputes the valuations at
the end — which is the part that is easy to get wrong by hand, because
valuations read the three tables above them and so have to run last.

Equivalently, from the terminal:

```bash
# Routine refresh — prices, factors, valuations. ~2 min.
curl -X POST "http://127.0.0.1:8000/backfill/all?skip_fundamentals=true"

# Everything, including the quarterly statements. ~10 min.
curl -X POST "http://127.0.0.1:8000/backfill/all"

# After the index membership changes: also re-pull the full 2-year price window.
curl -X POST "http://127.0.0.1:8000/backfill/all?full=true"
```

Every stage is incremental and every write is an upsert, so re-running is safe
and cheap. The individual cards on `/data` are still there for when you only
need one table — no reason a 3-second factor refresh should drag an
eight-minute fundamentals fetch behind it.

### What each flag is for

| flag | when |
|---|---|
| *(none)* | Full refresh including quarterly statements. Statements only change once a quarter, so this is rarely the one you want. |
| `skip_fundamentals=true` | The daily shape. Prices change every session; statements do not. |
| `full=true` | After a ticker is added to `api/data/sp500_tickers.json`. See below. |

### Why `full=true` exists

The incremental window comes from a single global newest-date across the whole
price table. That is right for a ticker that has been tracked all along and
wrong for one that has not: a name added to `sp500_tickers.json` after the table
was populated would start from "five days ago", land a handful of rows, and
from then on look up to date — accruing history one day at a time and never
filling in the two years behind it.

`/backfill/all` detects this on its own (any ticker missing from the earliest
stored date gets the full window), so `full=true` is a belt-and-braces option
rather than a requirement.

**A short history is not always a bug.** Recent spin-offs genuinely have less
history than the risk model wants — the optimiser needs 90% coverage of the
window to estimate a covariance, and excludes names below that rather than
pricing risk they never showed. When the frontier reports a ticker as excluded,
check whether more data actually exists before assuming the backfill missed it.

## Sharing a screened portfolio

The screener hands its result to `/portfolio` as a fixed-size token:

```
/portfolio?set=v1.4a1c9e02.f_7xAAAA…      # ~110 bytes, one stock or all 503
```

The token is a bitmask over the index, not a list of names. Spelling the names
out (`?tickers=A,AAPL,ABBV,…`) reached ~3KB for a wide screen, and because Next
repeats the URL in the request line, `Next-Url` and `Referer`, that spent over
half of Node's 16KB header budget before any cookies — so the page answered
**431 Request Header Fields Too Large** for some readers and not others,
depending on what cookies they carried.

Links stay shareable and survive a reload. If the index membership changes the
bit positions shift, so a token carries a fingerprint of the universe it was
built against and an outdated link is refused rather than silently decoded into
a different portfolio. `?tickers=AAPL,MSFT,…` still works for short, hand-built
URLs.

## Testing the optimiser

```bash
node .claude/skills/test-portfolio-optimizer/sweep.mjs --quick   # ~1 min
node .claude/skills/test-portfolio-optimizer/sweep.mjs           # full matrix
```

Sweeps the portfolio optimiser across many screened-set sizes and tilts, checks
the frontier's structural invariants, and drives the real page in a headless
browser. See `.claude/skills/test-portfolio-optimizer/SKILL.md`.

## Lint / build

```bash
pnpm lint
pnpm build
```

## Market data endpoints

- `GET /health` — liveness check
- `GET /quote/{ticker}` — latest price snapshot
- `GET /info/{ticker}` — full yfinance ticker info
- `GET /history/{ticker}?period=1y&interval=1d` — OHLCV candles
- `GET /returns/{ticker}` — daily closes and log returns (stock, market, excess)
  over the last 252 trading days, the 2x2 covariance matrix, and the average
  annualised risk-free rate (`^IRX`)
- `GET /valuations` — every model's verdict for every stock, precomputed
- `POST /efficient-frontier?tickers=…&short_allowed=…&n_portfolios=…` — solves
  the frontier over a screened subset (omit `tickers` for the whole index)
- `POST /backfill/all?full=…&skip_fundamentals=…` — **every stage in order**
- `POST /backfill/sp500-daily-close?full=…` — daily closes
- `POST /backfill/factor-returns` — Fama-French daily factors
- `POST /backfill/quarterly-fundamentals` — statements, profile and dividends
- `POST /backfill/company-profile` — profile fields only, a cheaper refresh
- `POST /backfill/valuations` — recompute every model; run after any of the above
