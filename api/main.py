"""HTTP surface of the market-data service.

Routes only. Each one delegates to the module that owns the work:

    db          Supabase access, retries, paging
    market      prices, returns and the risk-free rate, with their caches
    backfill    the ingest jobs, in dependency order
    universe    the scored universe the screener reads
    frontier    mean-variance optimisation
    engine      runs every valuation model across the universe
    valuation   the models themselves
    fundamentals / factors   yfinance and Ken French ingest
"""

from __future__ import annotations

import secrets
import threading
from contextlib import asynccontextmanager
from typing import Literal

import yfinance as yf
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

import backfill
import config
import frontier
import market
import universe


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


app = FastAPI(title="Margin market data service", lifespan=lifespan)

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
            detail="This endpoint is only callable through the Margin dashboard.",
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


@app.get("/quote/{ticker}")
def get_quote(ticker: str):
    """Latest price snapshot, live from yfinance."""
    try:
        info = yf.Ticker(ticker).fast_info
        price = info.get("lastPrice")
    except (KeyError, IndexError):
        price = None

    if price is None:
        raise HTTPException(status_code=404, detail=f"No quote data for '{ticker}'")

    return {
        "ticker": ticker.upper(),
        "price": price,
        "previousClose": info.get("previousClose"),
        "open": info.get("open"),
        "dayHigh": info.get("dayHigh"),
        "dayLow": info.get("dayLow"),
        "yearHigh": info.get("yearHigh"),
        "yearLow": info.get("yearLow"),
        "marketCap": info.get("marketCap"),
        "currency": info.get("currency"),
    }


@app.get("/info/{ticker}")
def get_info(ticker: str):
    """The full yfinance info blob, passed through unchanged."""
    try:
        info = yf.Ticker(ticker).info
    except (KeyError, IndexError):
        info = None

    if not info or info.get("symbol") is None:
        raise HTTPException(status_code=404, detail=f"No info data for '{ticker}'")

    return info


@app.get("/history/{ticker}")
def get_history(
    ticker: str,
    period: Literal[
        "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"
    ] = "1y",
    interval: Literal[
        "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk",
        "1mo", "3mo",
    ] = "1d",
):
    """OHLCV candles, live from yfinance."""
    hist = yf.Ticker(ticker).history(period=period, interval=interval)
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No history data for '{ticker}'")

    hist = hist.reset_index()
    date_col = "Date" if "Date" in hist.columns else "Datetime"

    return {
        "ticker": ticker.upper(),
        "period": period,
        "interval": interval,
        "candles": [
            {
                "date": row[date_col].isoformat(),
                "open": row["Open"],
                "high": row["High"],
                "low": row["Low"],
                "close": row["Close"],
                "volume": row["Volume"],
            }
            for _, row in hist.iterrows()
        ],
    }


@app.get("/returns/{ticker}")
def get_returns(ticker: str):
    """Stored daily closes and log returns, plus the CAPM inputs derived from
    them: the 2x2 covariance matrix and the annualised risk-free rate."""
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


@app.get("/valuations")
def get_valuations():
    """Every model's verdict for every stock, precomputed."""
    return universe.scored()


@app.post("/backfill/all", dependencies=[Depends(require_backfill_token)])
def post_backfill_all(full: bool = False, skip_fundamentals: bool = False):
    """Every stage in dependency order.

    `skip_fundamentals=true` is the daily shape: statements change quarterly,
    prices change every session. `full=true` re-pulls the whole price window,
    which matters after a ticker is added to the index.
    """
    return backfill.everything(full=full, skip_fundamentals=skip_fundamentals)


@app.post("/backfill/sp500-daily-close", dependencies=[Depends(require_backfill_token)])
def post_backfill_daily_close(full: bool = False):
    """Daily closes for the index constituents, ^GSPC and ^IRX."""
    return backfill.daily_close(full=full)


@app.post("/backfill/factor-returns", dependencies=[Depends(require_backfill_token)])
def post_backfill_factor_returns():
    """Fama-French daily factors from the Ken French library."""
    return backfill.factor_returns()


@app.post(
    "/backfill/quarterly-fundamentals", dependencies=[Depends(require_backfill_token)]
)
def post_backfill_quarterly_fundamentals():
    """Statements, company profile and dividend history — the heavy one."""
    return backfill.company_fundamentals(profile_only=False)


@app.post("/backfill/company-profile", dependencies=[Depends(require_backfill_token)])
def post_backfill_company_profile():
    """Profile fields only: a cheap refresh of what moves daily."""
    return backfill.company_fundamentals(profile_only=True)


@app.post("/backfill/valuations", dependencies=[Depends(require_backfill_token)])
def post_backfill_valuations():
    """Recompute every model. Run after any of the three feeders above."""
    return backfill.valuations()


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
