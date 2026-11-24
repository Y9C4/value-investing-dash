"""HTTP surface of the market-data service.

Routes only. Each one delegates to the module that owns the work:

    pipeline    the scheduled stages, in dependency order, recorded in job_runs
    ingest      extract and load: yfinance and Ken French rows into `raw`
    dw          direct Postgres: bulk upserts and warehouse.refresh()
    db          Supabase REST access to the serving layer, retries, paging
    market      prices, returns and the cash rate, with their caches
    frontier    mean-variance optimisation

Everything between ingest and the serving layer — statement pivots, betas,
valuations, the signal — is SQL in the `warehouse` schema
(supabase/migrations/20261117000001_create_warehouse.sql). The screener reads
it straight from Postgres, so the only reason this service exists at request
time is the optimiser.
"""

from __future__ import annotations

import secrets
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import config
import frontier
import market
import pipeline


def _warm_price_cache() -> None:
    """Pull the full price frame into the process cache.

    Runs on a background thread at startup so the first visitor does not pay
    for it. On a scale-to-zero host every cold start begins with an empty
    cache, and that read is most of what a small solve costs: ~6.5s of a 6.8s
    request, only 0.25s of which is actually solving.

    Failure is silent by design. This is an optimisation, not a dependency —
    if Supabase is unreachable at boot the service must still start and answer
    /health, or the platform will restart it in a loop.
    """
    try:
        market.prices_df(config.SP500_TICKERS)
    except Exception:  # noqa: BLE001 - see docstring
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warm_price_cache, daemon=True).start()
    yield


app = FastAPI(title="Value Investing Dash market data service", lifespan=lifespan)

# The scored universe is ~350KB of highly repetitive JSON and compresses about
# 5.7x. It is read on every screener revalidation, so this is the single
# cheapest reduction available in the egress bill.
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def require_backfill_token(x_backfill_token: str = Header(default="")) -> None:
    """Gate the ingest routes on a shared secret.

    CORS does not protect these: it is a browser convention, and `curl` ignores
    it. Without this, anyone holding the service URL can start a ten-minute
    yfinance crawl, pin the CPU and spend the Supabase egress quota.

    `compare_digest` rather than `==` so the comparison does not leak the
    token's prefix through its own runtime.
    """
    if not config.BACKFILL_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="BACKFILL_TOKEN is not configured; backfills are closed.",
        )
    if not secrets.compare_digest(x_backfill_token, config.BACKFILL_TOKEN):
        raise HTTPException(
            status_code=401, detail="Invalid or missing backfill token."
        )


def require_margin_origin(x_margin_origin: str = Header(default="")) -> None:
    """Require that a solve arrived through the dashboard's own proxy.

    The browser never sees the service URL — it calls the Next route handler,
    which calls this service server-side — so making that structural costs a
    header and removes the whole class of "someone found the Cloud Run URL and
    looped it".

    Off when the secret is unset, which is what keeps `pnpm dev` against a
    local service and the sweep script working with no extra configuration.
    """
    if not config.MARGIN_ORIGIN_SECRET:
        return
    if not secrets.compare_digest(x_margin_origin, config.MARGIN_ORIGIN_SECRET):
        raise HTTPException(
            status_code=403,
            detail="This endpoint is only callable through the Value Investing Dash dashboard.",
        )


@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Give a crash the same JSON shape as a deliberate error.

    FastAPI answers an unhandled error with the bare text `Internal Server
    Error`. The dashboard parses every response as JSON, so that reply threw a
    second time in the browser and the page died with nothing to show.
    """
    return JSONResponse(
        status_code=500, content={"detail": f"{type(exc).__name__}: {exc}"}
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/returns/{ticker}")
def get_returns(ticker: str):
    """Stored dividend-adjusted daily closes and log returns over the last
    252 sessions, plus the 2x2 covariance matrix and the annualised T-bill rate.

    Only caller: the close-history route's fallback, when the dashboard cannot
    read `stock_prices` itself."""
    frame, varcov = market.returns_df(ticker)
    frame = frame.tail(market.RETURNS_LOOKBACK_DAYS).reset_index()
    span = market.RETURNS_LOOKBACK_DAYS

    return {
        "ticker": ticker.upper(),
        "candles": [
            {
                "date": row["date"].date().isoformat(),
                "close": row["close"],
                "stock_log_return": row["stock_log_return"],
                "market_log_return": row["market_log_return"],
                "excess_log_return": row["excess_log_return"],
            }
            for _, row in frame.iterrows()
        ],
        "varcov": varcov.values.tolist(),
        "risk_free_rate": market.average_risk_free_rate(),
        "expected_stock_return": frame["stock_log_return"].mean() * span,
        "expected_market_return": frame["market_log_return"].mean() * span,
    }


@app.post("/backfill/all", dependencies=[Depends(require_backfill_token)])
def post_backfill_all(full: bool = False, skip_fundamentals: bool = False):
    """Every stage in dependency order, then the warehouse refresh.

    `skip_fundamentals=true` is the daily shape: statements change quarterly,
    prices change every session. `full=true` re-pulls every price from 2015.
    """
    return pipeline.everything(full=full, skip_fundamentals=skip_fundamentals)


@app.post("/backfill/prices", dependencies=[Depends(require_backfill_token)])
def post_backfill_prices(full: bool = False):
    """Daily bars, dividends and splits for the constituents, ^GSPC, ^TNX and ^IRX."""
    return pipeline.prices(full=full)


@app.post("/backfill/factor-returns", dependencies=[Depends(require_backfill_token)])
def post_backfill_factor_returns():
    """Fama-French daily factors from the Ken French library."""
    return pipeline.factor_returns()


@app.post("/backfill/fundamentals", dependencies=[Depends(require_backfill_token)])
def post_backfill_fundamentals():
    """Statements, share counts, earnings dates and profiles — the heavy one."""
    return pipeline.fundamentals()


@app.post("/backfill/refresh", dependencies=[Depends(require_backfill_token)])
def post_backfill_refresh():
    """Rebuild the warehouse from what is loaded. Run after any stage above."""
    return pipeline.refresh()


@app.post("/efficient-frontier", dependencies=[Depends(require_margin_origin)])
def post_efficient_frontier(
    short_allowed: bool = False,
    n_portfolios: int = frontier.ENVELOPE_POINTS,
    tickers: str | None = None,
    min_weight: float | None = None,
    max_weight: float | None = None,
    gamma: float = frontier.DEFAULT_L2_GAMMA,
):
    """Solve the frontier over a screened subset, or the full index.

    `tickers` is comma-separated; omit it for everything. `min_weight` and
    `max_weight` are fractions, not percents (0.03 is 3%); omit either to let
    the service scale it to the universe. A negative `min_weight` permits
    shorting on its own, so `short_allowed` is only the shorthand. `gamma` is
    the L2 penalty that spreads weight across more holdings.
    """
    return frontier.build(
        short_allowed,
        n_portfolios,
        tickers.split(",") if tickers else None,
        min_weight,
        max_weight,
        gamma,
    )
