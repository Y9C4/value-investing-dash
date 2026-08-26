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

The same reasoning applies one layer down: `/portfolio` sends the ticker list
to `POST /api/efficient-frontier` in the **request body**, not the query
string. A ~3KB URL there cost the same header budget and 431'd for a reader
carrying 13KB of cookies on localhost, which the page then reported as the
optimiser failing. The query form is still accepted for hand-built calls, which
carry no cookies.

Links stay shareable and survive a reload. If the index membership changes the
bit positions shift, so a token carries a fingerprint of the universe it was
built against and an outdated link is refused rather than silently decoded into
a different portfolio. `?tickers=AAPL,MSFT,…` still works for short, hand-built
URLs.

## Shaping the optimisation

`/portfolio` exposes the constraints the solver runs under, because every
number on that page is downstream of them and a frontier with no stated
constraint set is not a claim about anything.

| control | effect |
|---|---|
| **Maximum position** | The per-name cap. Blank scales it to the universe: `sum(w) == 1` with `w <= c` needs `c * n >= 1`, so a 3% cap silently requires 34 holdings and a smaller screened set has no feasible portfolio at all. |
| **Minimum position** | A floor on every weight. Positive forces every name into the portfolio — the direct way to eliminate zero weights. Negative permits shorting down to that weight. |
| **Allow short selling** | Shorthand for a floor at `-cap`. An explicit minimum overrides it, so an asymmetric range (−1% floor against a 5% cap) means what it says. |
| **L2 penalty (γ)** | Adds `γ‖w‖²` to the objective. |
| **Portfolios** | How many points are solved along the frontier. Each is its own optimisation, so this is what decides run time. |

An infeasible combination is refused with a 422 naming the number to change,
rather than reaching CVXPY and coming back as an opaque solver error.

### What γ actually does

A box-constrained mean-variance solve puts its optimum on a *vertex* of the
feasible set: most weights land at exactly zero and the survivors at exactly the
cap, and nudging any input reshuffles which names those are. The L2 term is
strictly convex, so it pulls the solution off that vertex.

Its visible effect is at the **minimum-volatility end** of the frontier, not at
the tangency. The frontier is traced by minimising variance at a target return,
and at the max-Sharpe point that return constraint is doing the binding — there
is little room left for the penalty. Over one 19-stock set, raising γ from 0 to
5 moved the min-volatility portfolio from 10.6 to 19.0 effective holdings while
the tangency went 6.8 → 7.2. The **Eff. names** column in the anchor table is
where to watch it.

With γ above zero the plotted curve minimises variance *plus the penalty*, so
it sits fractionally inside the unregularised frontier. That is the trade being
made on purpose, and the chart says so.

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
- `POST /efficient-frontier?tickers=…&short_allowed=…&n_portfolios=…&min_weight=…&max_weight=…&gamma=…`
  — solves the frontier over a screened subset (omit `tickers` for the whole
  index). `min_weight`/`max_weight` are fractions, not percents (`0.03` is 3%);
  omit either to let the service scale it to the universe. `gamma` is the L2
  penalty. See **Shaping the optimisation** above.
- `POST /backfill/all?full=…&skip_fundamentals=…` — **every stage in order**
- `POST /backfill/sp500-daily-close?full=…` — daily closes
- `POST /backfill/factor-returns` — Fama-French daily factors
- `POST /backfill/quarterly-fundamentals` — statements, profile and dividends
- `POST /backfill/company-profile` — profile fields only, a cheaper refresh
- `POST /backfill/valuations` — recompute every model; run after any of the above
