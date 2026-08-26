import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Callable, Literal, NamedTuple

import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client
from pypfopt import expected_returns
from pypfopt import risk_models
from pypfopt import EfficientFrontier
from pypfopt import objective_functions

import engine
import factors
import fundamentals

load_dotenv()

app = FastAPI(title="value-investing-dash market data service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

SP500_TICKERS_PATH = Path(__file__).parent / "data" / "sp500_tickers.json"
SP500_INDEX_TICKER = "^GSPC"
RISK_FREE_TICKER = "^IRX"
FETCH_CHUNK_SIZE = 50
UPSERT_CHUNK_SIZE = 500
SELECT_PAGE_SIZE = 1000
# Paged price reads are independent round trips, so they overlap. Eight is the
# same ceiling the fundamentals fetch settled on against the same backend.
PRICE_FETCH_MAX_WORKERS = 6
# The pooled Supabase session drops the occasional connection -- under that
# concurrency, but also simply from age. Retrying costs a moment; letting it
# through cost a 500 on a page the reader had done nothing wrong to reach.
SUPABASE_READ_ATTEMPTS = 4
SUPABASE_READ_BACKOFF_SECONDS = 0.25
# The stored risk-free rate moves at most once a day but was re-read on every
# request: an extra round trip, and one more chance to land on a dying
# connection, for a number that had not changed.
RISK_FREE_CACHE_TTL_SECONDS = 900
# Closes for a settled session do not change; re-reading them per request was
# most of what an optimisation spent its time on.
PRICE_CACHE_TTL_SECONDS = 900

# How much price history to hold. A 252-trading-day window is what every return
# calculation asks for, and `period="1y"` yields only ~250 rows — just short of
# it. Two years leaves headroom, which matters because the Fama-French series
# publishes weeks in arrears and factor regressions run on the intersection.
PRICE_HISTORY_PERIOD = "2y"
# yfinance is an unofficial API and can start rate-limiting. Probing showed 8
# workers sustained ~0.43 s/ticker with no failures across the full universe.
FUNDAMENTALS_MAX_WORKERS = 8
# Re-fetch a few days past the newest stored row: the last session can be
# partial, and a same-day run would otherwise store an unsettled close.
INCREMENTAL_OVERLAP_DAYS = 5

# Frontier constraints: no single name may exceed 3% of the portfolio, and
# historical mean returns are capped to keep extreme estimates from dominating.
#
# The 3% figure is the cap for a full-index solve and CANNOT be applied blindly
# to a screened subset. `sum(w) == 1` with `w <= cap` is infeasible unless
# `cap * n >= 1`, so a 3% cap silently requires at least 34 names -- and the
# screener hands over as few as 5. `_weight_cap` scales the cap to the universe
# instead. See its docstring for why the slack factor matters.
MAX_STOCK_WEIGHT = 0.03
# Require at most n/1.5 holdings, so the cap never binds every weight at once.
# A cap of exactly 1/n is feasible but degenerate: every name is pinned to the
# cap and the "optimisation" can only return the equal-weight portfolio.
CAP_SLACK = 1.5
MU_CLIP = 0.50
ENVELOPE_POINTS = 100
# Below this, the covariance matrix is too small for the optimisation to say
# anything meaningful about diversification.
MIN_FRONTIER_TICKERS = 5
MIN_ENVELOPE_POINTS = 2
# Every frontier point is now a solved portfolio rather than a point on a
# straight line between two anchors, so the ceiling reflects real solver cost
# (~0.3s per point over the full index).
MAX_ENVELOPE_POINTS = 200
# A ticker needs this share of the price frame's sessions to be optimised over.
# `CovarianceShrinkage` fills missing returns with zeros, so a recent listing
# arrives at the solver wearing a fraction of its true volatility and gets
# loaded up on. Dropping it is more honest than pricing risk it never showed.
MIN_HISTORY_COVERAGE = 0.9
# Return span below which the frontier collapses to a single point.
RETURN_SPAN_EPSILON = 1e-6
# L2 regularisation, added to every solve as `gamma * ||w||^2`.
#
# A mean-variance solve with a box constraint is a linear-ish program in
# disguise: its optimum sits on a vertex of the feasible set, which means most
# weights come back at exactly zero and the survivors at exactly the cap. The
# "optimal portfolio" then looks like an arbitrary handful of names, and moving
# one input reshuffles which names those are. The L2 term is strictly convex, so
# it pulls the solution off the vertex and spreads weight across more holdings.
# Zero keeps the old behaviour; the ceiling is where the penalty has long since
# overwhelmed the variance term and every portfolio is the equal-weight one.
DEFAULT_L2_GAMMA = 0.0
MAX_L2_GAMMA = 5.0
# Ternary-search passes used to refine the tangency portfolio off the grid.
# Each pass costs two solves; eight of them shrink the bracket to ~4% of one
# grid step, which is far below what the chart can show. The point is not
# precision for its own sake — it guarantees the tangency is at least as good
# as every plotted point, so the capital market line cannot cut through the
# curve it is supposed to touch.
TANGENCY_REFINEMENT_STEPS = 8
# How far past the frontier the capital market line runs (levered portfolios).
CML_LEVERAGE_EXTENSION = 1.4

with open(SP500_TICKERS_PATH, encoding="utf-8") as f:
    SP500_TICKERS: list[str] = json.load(f)

# One cached close series per ticker, shared across requests. See `get_prices_df`.
_price_column_cache: dict[str, pd.Series] = {}
_price_cache_stamp: float = 0.0
_price_cache_lock = Lock()

_supabase_url = os.environ.get("SUPABASE_URL")
_supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
_supabase_client: Client | None = None
if _supabase_url and _supabase_key:
    _supabase_client = create_client(_supabase_url, _supabase_key)


def get_supabase() -> Client:
    if _supabase_client is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY in api/.env."
            ),
        )
    return _supabase_client


def _supabase_read(build: Callable[[Client], Any]) -> Any:
    """Run one idempotent Supabase read, retrying a dropped connection.

    The client holds a single pooled HTTP/2 session, and PostgREST retires a
    connection with GOAWAY once it has carried a few hundred streams. Whatever
    request is in flight when that arrives dies with `RemoteProtocolError`,
    which reached the dashboard as a 500 on a page the reader had done nothing
    wrong to reach. Because the trigger is the *connection's* age rather than
    anything about the query, the failures looked random and were blamed on
    whatever the reader happened to be doing at the time -- optimising twenty
    stocks rather than nineteen, say.

    Every caller is a read, so re-running one has no side effects and there is
    no correctness reason to distinguish causes on the way in. Only the last
    attempt is allowed to surface, leaving a genuine, permanent error with its
    own type and message intact.
    """
    for attempt in range(SUPABASE_READ_ATTEMPTS):
        try:
            return build(get_supabase())
        except HTTPException:
            # A deliberate 404/500 from inside the query is an answer, not a
            # fault to retry.
            raise
        except Exception:  # noqa: BLE001 - see docstring
            if attempt == SUPABASE_READ_ATTEMPTS - 1:
                raise
            time.sleep(SUPABASE_READ_BACKOFF_SECONDS * (2**attempt))
    return None


@app.exception_handler(Exception)
def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Turn any unhandled error into the same JSON shape as a deliberate one.

    Without this, FastAPI answers a crash with the bare text `Internal Server
    Error`. The dashboard parses every response as JSON, so that reply threw a
    second time in the browser and the page died with no indication of what had
    gone wrong. A caller is always owed a readable reason.
    """
    return JSONResponse(
        status_code=500,
        content={"detail": f"{type(exc).__name__}: {exc}"},
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quote/{ticker}")
def get_quote(ticker: str):
    try:
        info = yf.Ticker(ticker).fast_info
        price = info.get("lastPrice")
    except (KeyError, IndexError):
        price = None

    if price is None:
        raise HTTPException(status_code=404, detail=f"No quote data for '{ticker}'")

    return {
        "ticker": ticker.upper(),
        "price": info.get("lastPrice"),
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
        "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"
    ] = "1d",
):
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


RETURNS_LOOKBACK_DAYS = 252


_risk_free_rate: float | None = None
_risk_free_stamp: float = 0.0
_risk_free_lock = Lock()


def get_average_risk_free_rate() -> float:
    """The stored annualised 13-week treasury rate, cached and retried.

    Every frontier solve needs this one number, and it was re-read from
    Supabase each time. That put a second round trip on the most-travelled
    endpoint in the app, unprotected, so a retired connection took down an
    optimisation that had already done all its real work.
    """
    global _risk_free_rate, _risk_free_stamp

    with _risk_free_lock:
        if (
            _risk_free_rate is not None
            and time.time() - _risk_free_stamp <= RISK_FREE_CACHE_TTL_SECONDS
        ):
            return _risk_free_rate

    rows = _supabase_read(
        lambda db: db.table("average_risk_free_rate")
        .select("annual_risk_free_rate")
        .execute()
    ).data

    if not rows or rows[0]["annual_risk_free_rate"] is None:
        raise HTTPException(status_code=404, detail="No risk-free rate data")

    with _risk_free_lock:
        _risk_free_rate = rows[0]["annual_risk_free_rate"]
        _risk_free_stamp = time.time()

    return _risk_free_rate


@app.get("/returns/{ticker}")
def get_returns(ticker: str):
    df, varcov = get_returns_df(ticker)
    df = df.tail(RETURNS_LOOKBACK_DAYS).reset_index()

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
            for _, row in df.iterrows()
        ],
        "varcov": varcov.values.tolist(),
        "risk_free_rate": get_average_risk_free_rate(),
        "expected_stock_return": df["stock_log_return"].mean() * RETURNS_LOOKBACK_DAYS,
        "expected_market_return": df["market_log_return"].mean() * RETURNS_LOOKBACK_DAYS,
    }


def get_returns_df(ticker: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch the last 1 year of daily log returns for `ticker` alongside the
    S&P 500 (^GSPC) log return on the same dates.

    Returns a tuple of:
    - a DataFrame indexed by date (DatetimeIndex) with columns:
      stock_log_return, market_log_return, excess_log_return. Rows with any
      missing return (e.g. a ticker's first trading day, where there's no
      prior close to diff against) are dropped.
    - the 2x2 variance-covariance matrix of stock_log_return and
      market_log_return.
    """
    symbol = ticker.upper()

    res = _supabase_read(
        lambda db: db.table("daily_excess_returns")
        .select("date, close, stock_log_return, market_log_return, excess_log_return")
        .eq("ticker", symbol)
        .order("date")
        .execute()
    )

    if not res.data:
        raise HTTPException(
            status_code=404, detail=f"No return data for '{symbol}'"
        )

    df = pd.DataFrame(res.data)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").dropna()
    returns_df = df[["stock_log_return", "market_log_return"]]
    centered = returns_df - returns_df.mean()
    varcov = centered.T @ centered / len(centered)
    return df, varcov


def _chunk(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _latest_stored_date(table: str, column: str = "date") -> str | None:
    """The newest value of `column` in `table`, or None when it is empty.

    This is what makes the backfills incremental: each one asks what it already
    has and fetches only the gap. A daily cron ships one trading day; a run
    after a five-day outage ships five, with no special casing.
    """
    res = _supabase_read(
        lambda db: db.table(table)
        .select(column)
        .order(column, desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0][column]


def _earliest_stored_date(table: str, column: str = "date") -> str | None:
    """The oldest value of `column` in `table`, or None when it is empty."""
    res = _supabase_read(
        lambda db: db.table(table).select(column).order(column).limit(1).execute()
    )
    if not res.data:
        return None
    return res.data[0][column]


def _upsert_rows(
    table: str,
    rows: list[dict],
    on_conflict: str,
    errors: list[str],
    *,
    ignore_duplicates: bool = True,
) -> int:
    """Upsert `rows` in batches, collecting failures rather than raising.

    `ignore_duplicates` must be False for tables whose rows are snapshots that
    change in place (company_profile) or that get restated (quarterly
    fundamentals). It stays True for immutable facts like a paid dividend.
    """
    supabase = get_supabase()
    upserted = 0

    for batch in _chunk(rows, UPSERT_CHUNK_SIZE):
        try:
            supabase.table(table).upsert(
                batch, on_conflict=on_conflict, ignore_duplicates=ignore_duplicates
            ).execute()
            upserted += len(batch)
        except Exception as exc:  # noqa: BLE001 - report and continue
            errors.append(f"{table} upsert at row {upserted}: {exc}")

    return upserted


def _backfill_result(
    started: float,
    *,
    requested: int,
    failed: list[str],
    rows_fetched: int,
    rows_upserted: int,
    errors: list[str],
) -> dict:
    """The response shape every backfill endpoint returns, so one client
    component can render all of them."""
    return {
        "tickers_requested": requested,
        "tickers_succeeded": requested - len(failed),
        "tickers_failed": failed,
        "rows_fetched": rows_fetched,
        "rows_upserted": rows_upserted,
        "duration_seconds": round(time.monotonic() - started, 1),
        "errors": errors,
    }


def _extract_close_rows(ticker: str, df) -> list[dict]:
    series = df["Close"].dropna()
    return [
        {"date": idx.date().isoformat(), "ticker": ticker, "close": float(value)}
        for idx, value in series.items()
    ]


@app.post("/backfill/factor-returns")
def backfill_factor_returns():
    """Fama-French daily factors (FF5 + momentum).

    Cheap enough to re-run freely: one ~150KB download, and incremental runs
    upsert a handful of rows. Counted as a single "ticker" so the result shape
    matches the ticker-oriented backfills.
    """
    started = time.monotonic()
    errors: list[str] = []

    latest = _latest_stored_date("factor_returns")
    try:
        rows = factors.factor_rows_since(latest)
    except Exception as exc:  # noqa: BLE001 - report and continue
        return _backfill_result(
            started,
            requested=1,
            failed=["fama-french"],
            rows_fetched=0,
            rows_upserted=0,
            errors=[f"factor download/parse: {exc}"],
        )

    upserted = _upsert_rows(
        "factor_returns", rows, "date", errors, ignore_duplicates=False
    )

    return _backfill_result(
        started,
        requested=1,
        failed=[],
        rows_fetched=len(rows),
        rows_upserted=upserted,
        errors=errors,
    )


def _tickers_needing_full_history(candidates: list[str]) -> set[str]:
    """Tickers that must be fetched over the whole window, not just the gap.

    The incremental window is derived from one global newest-date across the
    whole table, which is right for a ticker that has been tracked all along
    and wrong for one that has not. A name added to `sp500_tickers.json` after
    the table was first populated gets its first backfill starting from
    "five days ago", lands a handful of rows, and from then on looks like an
    up-to-date ticker — so it accrues history one day at a time and never fills
    in the two years behind it. Nothing about a later run fixes that, which is
    why it is worth detecting rather than waiting out.

    The test is one query: whoever was trading on the earliest date the table
    holds is fully tracked. Anyone else gets the full window. A genuinely
    recent listing is re-fetched harmlessly — yfinance returns what exists, the
    upsert dedupes, and it costs a few seconds once.
    """
    earliest = _earliest_stored_date("daily_close_prices")
    if earliest is None:
        return set(candidates)

    present = {
        row["ticker"]
        for row in _supabase_read(
            lambda db: db.table("daily_close_prices")
            .select("ticker")
            .eq("date", earliest)
            .execute()
        ).data
    }
    return {ticker for ticker in candidates if ticker not in present}


@app.post("/backfill/sp500-daily-close")
def backfill_sp500_daily_close(full: bool = False):
    """Daily closes for the S&P 500 plus the index and risk-free series.

    Incremental: only the span since the newest stored date is fetched, so the
    daily cron run costs ~24s rather than the ~4min a full 2-year refresh takes.
    An empty table falls back to a full `PRICE_HISTORY_PERIOD` fetch, as does
    any ticker that is not yet fully tracked (see
    `_tickers_needing_full_history`). Pass `full=true` to force the whole window
    for everything.
    """
    started = time.monotonic()

    all_tickers = [*SP500_TICKERS, SP500_INDEX_TICKER, RISK_FREE_TICKER]
    rows: list[dict] = []
    failed_tickers: list[str] = []
    errors: list[str] = []

    latest = _latest_stored_date("daily_close_prices")
    # Overlap a few days so a partial last session gets corrected rather than
    # frozen; the upsert makes re-fetching the same dates free.
    fetch_start = (
        date.fromisoformat(latest) - timedelta(days=INCREMENTAL_OVERLAP_DAYS)
        if latest and not full
        else None
    )

    backfill_fully = (
        set(all_tickers)
        if fetch_start is None
        else _tickers_needing_full_history(all_tickers)
    )
    if backfill_fully and fetch_start is not None:
        errors.append(
            "full-window backfill for untracked tickers: "
            + ", ".join(sorted(backfill_fully))
        )

    incremental = [t for t in all_tickers if t not in backfill_fully]

    passes: list[tuple[list[str], dict]] = []
    if incremental:
        passes.append((incremental, {"start": fetch_start.isoformat()}))
    if backfill_fully:
        passes.append((sorted(backfill_fully), {"period": PRICE_HISTORY_PERIOD}))

    for pass_tickers, window in passes:
        cold = "period" in window
        for chunk in _chunk(pass_tickers, FETCH_CHUNK_SIZE):
            try:
                data = yf.download(
                    tickers=chunk,
                    interval="1d",
                    group_by="ticker",
                    auto_adjust=False,
                    threads=True,
                    progress=False,
                    **window,
                )
            except Exception as exc:  # noqa: BLE001 - report and continue
                failed_tickers.extend(chunk)
                errors.append(f"chunk {chunk[0]}..{chunk[-1]}: {exc}")
                continue

            for ticker in chunk:
                try:
                    ticker_df = data[ticker] if len(chunk) > 1 else data
                    ticker_rows = _extract_close_rows(ticker, ticker_df)
                except Exception as exc:  # noqa: BLE001 - report and continue
                    failed_tickers.append(ticker)
                    errors.append(f"{ticker}: {exc}")
                    continue

                # On an incremental run an empty frame is the normal case — it
                # means nothing new has traded since the last backfill — so it
                # only counts as a failure during a cold full fetch.
                if not ticker_rows:
                    if cold:
                        failed_tickers.append(ticker)
                        errors.append(f"{ticker}: no data returned")
                    continue

                rows.extend(ticker_rows)

    rows_upserted = _upsert_rows(
        "daily_close_prices", rows, "date,ticker", errors
    )

    # Stored closes just moved; the frontier's cache must not serve the old ones.
    with _price_cache_lock:
        _price_column_cache.clear()

    return _backfill_result(
        started,
        requested=len(all_tickers),
        failed=failed_tickers,
        rows_fetched=len(rows),
        rows_upserted=rows_upserted,
        errors=errors,
    )


def _run_fundamentals_backfill(tickers: list[str], profile_only: bool) -> dict:
    """Shared body of the fundamentals and profile backfills.

    `.info`, the three statements and `.dividends` all come from a single
    `yf.Ticker`, so one worker pass populates all three tables. Threading is
    what makes this practical: serially it is ~28 minutes, at 8 workers ~3.6.
    """
    started = time.monotonic()
    failed: list[str] = []
    errors: list[str] = []

    quarter_rows: list[dict] = []
    profile_rows: list[dict] = []
    dividend_rows: list[dict] = []

    with ThreadPoolExecutor(max_workers=FUNDAMENTALS_MAX_WORKERS) as executor:
        for result in executor.map(fundamentals.fetch_ticker_fundamentals, tickers):
            if result["error"]:
                failed.append(result["ticker"])
                errors.append(f"{result['ticker']}: {result['error']}")
                continue

            if result["profile"]:
                profile_rows.append(result["profile"])

            if not profile_only:
                quarter_rows.extend(result["quarters"])
                dividend_rows.extend(result["dividends"])

    rows_upserted = 0
    # Profiles are snapshots that change in place, so they must overwrite.
    rows_upserted += _upsert_rows(
        "company_profile", profile_rows, "ticker", errors, ignore_duplicates=False
    )

    if not profile_only:
        # Quarters get restated, so these overwrite too.
        rows_upserted += _upsert_rows(
            "quarterly_fundamentals",
            quarter_rows,
            "ticker,period_end",
            errors,
            ignore_duplicates=False,
        )
        # A paid dividend never changes.
        rows_upserted += _upsert_rows(
            "dividend_history", dividend_rows, "ticker,ex_date", errors
        )

    fetched = len(profile_rows) + len(quarter_rows) + len(dividend_rows)

    return _backfill_result(
        started,
        requested=len(tickers),
        failed=failed,
        rows_fetched=fetched,
        rows_upserted=rows_upserted,
        errors=errors,
    )


@app.post("/backfill/quarterly-fundamentals")
def backfill_quarterly_fundamentals():
    """Quarterly statements, company profile and dividend history.

    The heavy one (~3.6 min). Populates three tables in a single pass because
    they all derive from the same yfinance objects — splitting them would
    triple the network work for no benefit.
    """
    return _run_fundamentals_backfill(SP500_TICKERS, profile_only=False)


@app.post("/backfill/company-profile")
def backfill_company_profile():
    """Prices, sector and analyst aggregates only — a cheap refresh for the
    fields that move daily, without re-pulling the statements."""
    return _run_fundamentals_backfill(SP500_TICKERS, profile_only=True)


def _fetch_all_rows(table: str, columns: str) -> list[dict]:
    """Every row of `table`, paginated.

    Supabase caps a response at 1000 rows regardless of the requested range
    (`max_rows` in config.toml), so the page size is the ceiling, not a choice.
    """
    rows: list[dict] = []
    start = 0

    while True:
        page = _supabase_read(
            lambda db, start=start: db.table(table)
            .select(columns)
            .range(start, start + SELECT_PAGE_SIZE - 1)
            .execute()
        ).data
        rows.extend(page)
        if len(page) < SELECT_PAGE_SIZE:
            break
        start += SELECT_PAGE_SIZE

    return rows


def _fetch_recent_prices() -> pd.DataFrame:
    """Close prices within the valuation window, pivoted wide.

    Bounded to `PRICE_WINDOW_DAYS` rather than reading the whole table: the
    models only ever look at 252 trading days, so an unbounded read would grow
    the egress bill every time history accumulates, for data that is discarded.
    """
    cutoff = (date.today() - timedelta(days=engine.PRICE_WINDOW_DAYS)).isoformat()

    rows: list[dict] = []
    start = 0
    while True:
        page = _supabase_read(
            lambda db, start=start: db.table("daily_close_prices")
            .select("date, ticker, close")
            .gte("date", cutoff)
            .order("date")
            .order("ticker")
            .range(start, start + SELECT_PAGE_SIZE - 1)
            .execute()
        ).data
        rows.extend(page)
        if len(page) < SELECT_PAGE_SIZE:
            break
        start += SELECT_PAGE_SIZE

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No close price data. Run /backfill/sp500-daily-close first.",
        )

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["close"] = pd.to_numeric(df["close"])
    df = df.drop_duplicates(subset=["date", "ticker"])
    return df.pivot(index="date", columns="ticker", values="close").sort_index()


@app.post("/backfill/valuations")
def backfill_valuations():
    """Recompute every model for every stock and replace the valuations table.

    The models cost ~0.08s for the whole universe; the bulk reads below are
    essentially the entire runtime. That asymmetry is why this is precomputed
    rather than served on demand.
    """
    started = time.monotonic()
    errors: list[str] = []

    prices = _fetch_recent_prices()

    factor_rows = _fetch_all_rows("factor_returns", "date, mkt_rf, smb, hml, rmw, cma, umd, rf")
    if not factor_rows:
        raise HTTPException(
            status_code=404,
            detail="No factor data. Run /backfill/factor-returns first.",
        )
    factor_df = pd.DataFrame(factor_rows)
    factor_df["date"] = pd.to_datetime(factor_df["date"])
    for column in ("mkt_rf", "smb", "hml", "rmw", "cma", "umd", "rf"):
        factor_df[column] = pd.to_numeric(factor_df[column], errors="coerce")

    ttm_rows = _fetch_all_rows("ttm_fundamentals", "*")
    if not ttm_rows:
        raise HTTPException(
            status_code=404,
            detail=(
                "No fundamentals. Run /backfill/quarterly-fundamentals first."
            ),
        )
    ttm_by_ticker = {row["ticker"]: row for row in ttm_rows}

    profile_rows = _fetch_all_rows("company_profile", "*")
    profiles = {row["ticker"]: row for row in profile_rows}

    dividend_rows = _fetch_all_rows("dividend_history", "ticker, ex_date, amount")
    dividends_by_ticker: dict[str, pd.DataFrame] = {}
    if dividend_rows:
        dividend_df = pd.DataFrame(dividend_rows)
        dividend_df["ex_date"] = pd.to_datetime(dividend_df["ex_date"])
        dividend_df["amount"] = pd.to_numeric(dividend_df["amount"])
        for ticker, group in dividend_df.groupby("ticker"):
            dividends_by_ticker[ticker] = group

    risk_free = get_average_risk_free_rate()

    rows, unvalued, stats = engine.compute_universe(
        prices,
        factor_df,
        ttm_by_ticker,
        profiles,
        dividends_by_ticker,
        risk_free,
        SP500_INDEX_TICKER,
    )

    supabase = get_supabase()
    # A model that stopped applying must lose its row, so the table is cleared
    # rather than upserted into — otherwise a stale verdict would outlive the
    # data that justified it.
    try:
        supabase.table("valuations").delete().neq("ticker", "").execute()
    except Exception as exc:  # noqa: BLE001 - report and continue
        errors.append(f"clearing valuations: {exc}")

    # Statistics describe the window, not the models, so they are upserted in
    # place rather than cleared — a ticker no model could value still has a
    # measurable return and volatility.
    _upsert_rows(
        "ticker_statistics", stats, "ticker", errors, ignore_duplicates=False
    )

    rows_upserted = _upsert_rows(
        "valuations", rows, "ticker,method", errors, ignore_duplicates=False
    )

    valued = len({row["ticker"] for row in rows})

    return {
        **_backfill_result(
            started,
            requested=valued + len(unvalued),
            failed=unvalued,
            rows_fetched=len(rows),
            rows_upserted=rows_upserted,
            errors=errors,
        ),
        "tickers_valued": valued,
        "verdicts_per_ticker": round(len(rows) / valued, 2) if valued else 0,
    }


def _optional_float(value) -> float | None:
    """Coerce a Supabase numeric to float, preserving None.

    `float(x or 0)` -- the idiom used elsewhere in this file -- would turn a
    genuinely absent rate into 0.0, which the discount-rate panel would then
    render as a real 0% WACC.
    """
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@app.post("/backfill/all")
def backfill_all(full: bool = False, skip_fundamentals: bool = False):
    """Every backfill stage, in dependency order, in one call.

    The stages were deliberately separate buttons so a 20-second factor refresh
    need not drag an eight-minute fundamentals fetch behind it. That reasoning
    holds for routine upkeep and fails for the case it did not anticipate:
    bringing a stale database fully current, where running them by hand means
    knowing the order and noticing that valuations must come last. Both are
    easy to get wrong and neither is interesting.

    Order matters. Valuations read prices, factors and fundamentals, so they run
    last; the three feeders are independent of one another. A stage that fails
    does not stop the ones after it — the report says what happened to each —
    except that valuations are skipped if every feeder failed, since they would
    only recompute the same numbers from the same stale tables.

    `skip_fundamentals=true` drops the ~8 minute stage, which is the right
    choice for a daily refresh: statements change quarterly, prices change
    every session. That leaves prices, factors and valuations — about two
    minutes.
    """
    started = time.monotonic()

    stages: list[tuple[str, Callable[[], dict]]] = [
        ("daily_close_prices", lambda: backfill_sp500_daily_close(full=full)),
        ("factor_returns", backfill_factor_returns),
    ]
    if not skip_fundamentals:
        # This one pass already writes the statements, the company profile and
        # the dividend history — they all come off the same yfinance objects.
        # Adding a separate profile refresh here would re-walk all 500 tickers
        # for tables this stage has just written.
        stages.append(("quarterly_fundamentals", backfill_quarterly_fundamentals))

    results: dict[str, dict] = {}
    feeders_ok = 0

    for name, run in stages:
        try:
            results[name] = run()
            if not results[name].get("errors"):
                feeders_ok += 1
            else:
                feeders_ok += 1  # partial success still refreshes the table
        except HTTPException as exc:
            results[name] = {"failed": True, "detail": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001 - one stage must not sink the rest
            results[name] = {"failed": True, "detail": f"{type(exc).__name__}: {exc}"}

    if feeders_ok == 0:
        results["valuations"] = {
            "skipped": True,
            "detail": "Every upstream stage failed; valuations would only "
            "recompute the same numbers from the same stale tables.",
        }
    else:
        try:
            results["valuations"] = backfill_valuations()
        except HTTPException as exc:
            results["valuations"] = {"failed": True, "detail": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            results["valuations"] = {"failed": True, "detail": f"{type(exc).__name__}: {exc}"}

    failed = [name for name, result in results.items() if result.get("failed")]

    return {
        "ok": not failed,
        "failed_stages": failed,
        "duration_seconds": round(time.monotonic() - started, 1),
        "stages": results,
    }


@app.get("/valuations")
def get_valuations():
    """The scored universe, in the shape the screener consumes.

    Reads the precomputed table, so this stays fast enough to serve on a page
    load — roughly 500 stocks with their verdicts attached.
    """
    risk_free = get_average_risk_free_rate()

    valuation_rows = _fetch_all_rows(
        "valuations",
        "ticker, method, fair_value, margin_of_safety, confidence, price_at_calc, computed_at",
    )
    if not valuation_rows:
        raise HTTPException(
            status_code=404,
            detail="No valuations. Run /backfill/valuations first.",
        )

    profiles = {
        row["ticker"]: row for row in _fetch_all_rows("company_profile", "*")
    }
    prices = {
        row["ticker"]: row
        for row in _fetch_all_rows("latest_close_prices", "ticker, date, close")
    }
    ttm = {row["ticker"]: row for row in _fetch_all_rows("ttm_fundamentals", "*")}
    # The discount-rate columns arrive with 20260821000000_add_discount_rates.
    # Selecting them before that migration is applied fails the whole request,
    # which would make deploying this code require lock-step timing with the
    # database. Fall back to the columns that have always existed instead: the
    # panel simply does not render until the migration lands.
    statistics_columns = (
        "ticker, realised_return, volatility, beta_252, cost_of_equity,"
        " cost_of_equity_source, capm_cost_of_equity, wacc, cost_of_debt,"
        " equity_weight, tax_rate"
    )
    try:
        statistics_rows = _fetch_all_rows("ticker_statistics", statistics_columns)
    except Exception:  # noqa: BLE001 - missing columns, not a fatal condition
        statistics_rows = _fetch_all_rows(
            "ticker_statistics", "ticker, realised_return, volatility, beta_252"
        )
    statistics = {row["ticker"]: row for row in statistics_rows}

    by_ticker: dict[str, list[dict]] = {}
    computed_at = None
    for row in valuation_rows:
        by_ticker.setdefault(row["ticker"], []).append(row)
        computed_at = computed_at or row.get("computed_at")

    stocks = []
    for ticker, verdicts in sorted(by_ticker.items()):
        profile = profiles.get(ticker, {})
        price_row = prices.get(ticker, {})
        price = float(
            price_row.get("close") or verdicts[0]["price_at_calc"]
        )

        stats_row = statistics.get(ticker, {})
        fundamentals_row = ttm.get(ticker, {})
        eps = fundamentals_row.get("ttm_diluted_eps") or profile.get("trailing_eps")
        pe_ratio = (
            float(price) / float(eps) if eps and float(eps) > 0 else 0.0
        )

        stocks.append(
            {
                "ticker": ticker,
                "name": profile.get("name") or ticker,
                "sector": profile.get("sector") or "Unclassified",
                "price": price,
                "marketCap": float(profile.get("market_cap") or 0) / 1e9,
                # Prefer the beta measured over the same 252-day window the
                # models used; yfinance's own figure uses its own period and is
                # only the fallback.
                "beta": float(
                    stats_row.get("beta_252") or profile.get("beta_yf") or 0
                ),
                "realisedReturn": float(stats_row.get("realised_return") or 0),
                "volatility": float(stats_row.get("volatility") or 0),
                "peRatio": round(pe_ratio, 2),
                "dividendYield": float(profile.get("dividend_yield") or 0) / 100,
                # The rates every verdict below was discounted at. Null rather
                # than 0 where they could not be computed: a missing WACC is
                # not a WACC of zero, and the panel must be able to say so.
                # Omitted entirely pre-migration, so the panel stays hidden
                # rather than rendering a card full of em dashes.
                **({} if "cost_of_equity" not in stats_row else {
                "discountRates": {
                    "riskFree": risk_free,
                    "costOfEquity": _optional_float(stats_row.get("cost_of_equity")),
                    "costOfEquitySource": stats_row.get("cost_of_equity_source"),
                    "capmCostOfEquity": _optional_float(
                        stats_row.get("capm_cost_of_equity")
                    ),
                    "wacc": _optional_float(stats_row.get("wacc")),
                    "costOfDebt": _optional_float(stats_row.get("cost_of_debt")),
                    "equityWeight": _optional_float(stats_row.get("equity_weight")),
                    "taxRate": _optional_float(stats_row.get("tax_rate")),
                },
                }),
                "verdicts": [
                    {
                        "method": verdict["method"],
                        "fairValue": float(verdict["fair_value"]),
                        "marginOfSafety": float(verdict["margin_of_safety"]),
                        "confidence": float(verdict["confidence"]),
                    }
                    for verdict in verdicts
                ],
            }
        )

    return {"computed_at": computed_at, "count": len(stocks), "stocks": stocks}


def _fetch_price_page(chunk: list[str], start: int) -> list[dict]:
    """One page of closes for `chunk`, starting at row `start`.

    Reading the index in parallel is enough to have the far end hang up
    mid-request on its own, on top of the connection ageing out that
    `_supabase_read` describes -- so this was where the retry originally lived.
    It is shared now because every other read had the same problem.
    """
    return _supabase_read(
        lambda db: db.table("daily_close_prices")
        .select("date, ticker, close")
        .in_("ticker", chunk)
        .order("date")
        .order("ticker")
        .range(start, start + SELECT_PAGE_SIZE - 1)
        .execute()
    ).data


def _fetch_price_chunk(chunk: list[str]) -> list[dict]:
    """Every stored close for one group of tickers, paged to exhaustion."""
    rows: list[dict] = []
    start = 0
    while True:
        page = _fetch_price_page(chunk, start)
        rows.extend(page)
        if len(page) < SELECT_PAGE_SIZE:
            break
        start += SELECT_PAGE_SIZE
    return rows


def get_prices_df(tickers: list[str]) -> pd.DataFrame:
    """Daily closes for exactly `tickers`, pivoted wide (index=date, columns=ticker).

    Three things about how this reads, all of which were costing ~80s per
    optimisation:

    PostgREST caps a response at `SELECT_PAGE_SIZE` rows, so the whole index is
    ~258 sequential round trips. They do not depend on each other, so they are
    now issued in parallel.

    It used to fetch all 500 constituents no matter how few were asked for,
    which meant optimising ten screened names paid the full-index read. The
    caller's ticker list is now pushed all the way down into the query.

    Closes for a completed session never change, so a frame once read is worth
    keeping. The cache is per-ticker rather than per-request, so a small
    screened solve warms the columns a later, wider solve reuses.

    Deliberately does not fetch the risk-free series or compute log returns —
    the frontier only needs prices plus a single average risk-free rate, which
    comes from `get_average_risk_free_rate()`.
    """
    global _price_cache_stamp

    with _price_cache_lock:
        if time.time() - _price_cache_stamp > PRICE_CACHE_TTL_SECONDS:
            _price_column_cache.clear()
            _price_cache_stamp = time.time()
        missing = [t for t in tickers if t not in _price_column_cache]

    if missing:
        # Force the client's lazily-built internals into existence on this
        # thread before any others touch it. Letting six workers race that
        # construction produced rare, unrelated-looking errors from inside the
        # library on the first wide read after the cache emptied.
        get_supabase().table("daily_close_prices")

        chunks = list(_chunk(missing, FETCH_CHUNK_SIZE))
        with ThreadPoolExecutor(max_workers=PRICE_FETCH_MAX_WORKERS) as executor:
            fetched = list(executor.map(_fetch_price_chunk, chunks))

        rows = [row for chunk_rows in fetched for row in chunk_rows]
        if rows:
            frame = pd.DataFrame(rows)
            frame["date"] = pd.to_datetime(frame["date"])
            frame["close"] = pd.to_numeric(frame["close"])
            frame = frame.drop_duplicates(subset=["date", "ticker"])
            wide = frame.pivot(index="date", columns="ticker", values="close")
            with _price_cache_lock:
                for ticker in wide.columns:
                    _price_column_cache[ticker] = wide[ticker]

        # A ticker with no stored rows is cached as empty rather than re-read on
        # every request; `build_efficient_frontier` drops it for short history.
        with _price_cache_lock:
            for ticker in missing:
                _price_column_cache.setdefault(
                    ticker, pd.Series(dtype="float64", name=ticker)
                )

    with _price_cache_lock:
        columns = {
            ticker: _price_column_cache[ticker]
            for ticker in tickers
            if ticker in _price_column_cache
            and not _price_column_cache[ticker].empty
        }

    if not columns:
        raise HTTPException(
            status_code=404,
            detail="No close price data. Run /backfill/sp500-daily-close first.",
        )

    return pd.DataFrame(columns).sort_index()


def _weight_cap(n_assets: int) -> float:
    """The per-stock cap actually enforceable over `n_assets` names.

    A cap `c` combined with `sum(w) == 1` implies `c * n >= 1`, so the 3% target
    quietly demands 34 holdings. Screened subsets are routinely smaller than
    that, and the optimisation was not failing to *find* a good portfolio in
    those cases -- it was being handed a constraint set with no feasible point
    at all, then reporting it as an opaque solver error.

    Widening the cap to `CAP_SLACK / n` for small universes keeps the
    diversification intent (no name may dominate) while guaranteeing the
    feasible set is non-empty and roomy enough to choose within.
    """
    return max(MAX_STOCK_WEIGHT, CAP_SLACK / n_assets)


class Constraints(NamedTuple):
    """What the solver was actually told, after defaults and feasibility.

    Kept as one value so every solve in a single frontier trace provably shares
    the same rules -- the anchors, the sweep and the tangency refinement each
    build their own `EfficientFrontier`, and a frontier assembled from points
    solved under different constraints is not a frontier.
    """

    lower: float
    upper: float
    gamma: float


def _resolve_constraints(
    n_assets: int,
    short_allowed: bool,
    min_weight: float | None,
    max_weight: float | None,
    gamma: float,
) -> Constraints:
    """Turn the request's position-size controls into bounds a solve can meet.

    Box bounds interact with `sum(w) == 1` in a way that is easy to get wrong
    from the outside: an upper bound below `1/n` cannot add up to a whole
    portfolio, and a lower bound above `1/n` cannot either. Both are infeasible
    rather than merely strict, and CVXPY reports infeasibility as an opaque
    solver failure -- so they are caught here, where the message can name the
    number the reader has to change.

    Omitting a bound keeps the behaviour the page had before the controls
    existed: the upper bound scales to the universe (see `_weight_cap`), and
    the lower bound is either zero or, with shorting on, the mirror of the cap.
    """
    if not 0.0 <= gamma <= MAX_L2_GAMMA:
        raise HTTPException(
            status_code=422,
            detail=f"gamma must be between 0 and {MAX_L2_GAMMA}.",
        )

    upper = _weight_cap(n_assets) if max_weight is None else float(max_weight)
    if min_weight is None:
        lower = -upper if short_allowed else 0.0
    else:
        lower = float(min_weight)

    if not -1.0 <= lower <= 1.0 or not -1.0 <= upper <= 1.0:
        raise HTTPException(
            status_code=422,
            detail="Position sizes must be between -100% and 100%.",
        )
    if lower > upper:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Minimum position ({lower:.2%}) is above the maximum "
                f"({upper:.2%})."
            ),
        )

    # `sum(w) == 1` with `w <= upper` needs `upper * n >= 1`; likewise
    # `w >= lower` needs `lower * n <= 1`. Report the threshold, not the
    # violation, so there is something to type into the box.
    if upper * n_assets < 1.0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"A {upper:.2%} maximum position cannot fill a portfolio of "
                f"{n_assets} stocks — the weights would sum to at most "
                f"{upper * n_assets:.0%}. Raise it to at least "
                f"{1.0 / n_assets:.2%}, or screen for fewer stocks."
            ),
        )
    if lower * n_assets > 1.0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"A {lower:.2%} minimum position across {n_assets} stocks "
                f"already commits {lower * n_assets:.0%} of the portfolio. "
                f"Lower it to at most {1.0 / n_assets:.2%}."
            ),
        )

    return Constraints(lower=lower, upper=upper, gamma=float(gamma))


def _make_efficient_frontier(
    mu: pd.Series, S: pd.DataFrame, constraints: Constraints
) -> EfficientFrontier:
    """Build an EfficientFrontier under one shared set of constraints.

    The bounds go in as PyPortfolioOpt's own `weight_bounds` rather than as an
    added constraint, so an asymmetric range (a -1% floor against a 5% cap, say)
    means what it says. An earlier version bounded shorts symmetrically via
    `|w| <= cap`, which quietly made the floor unreachable from the API.
    """
    ef = EfficientFrontier(
        mu,
        S,
        weight_bounds=(constraints.lower, constraints.upper),
        solver="CLARABEL",
    )
    if constraints.gamma > 0:
        ef.add_objective(objective_functions.L2_reg, gamma=constraints.gamma)
    return ef


def _portfolio_stats(
    weights: np.ndarray, mu: pd.Series, S: pd.DataFrame, risk_free_rate: float
) -> tuple[float, float, float]:
    """Expected return, volatility and Sharpe for an arbitrary weight vector,
    evaluated directly against mu/S rather than via a solve."""
    annual_return = float(weights @ mu.values)
    volatility = float(np.sqrt(weights @ S.values @ weights))
    sharpe = (annual_return - risk_free_rate) / volatility if volatility else 0.0
    return annual_return, volatility, sharpe


def _solve_at_return(
    ef: EfficientFrontier, target: float, mu: pd.Series
) -> np.ndarray | None:
    """Minimum-variance weights subject to a return floor, or None if that
    target is out of reach.

    Called repeatedly on one `EfficientFrontier`. The first call builds the
    CVXPY problem and later ones only rebind the target parameter, which is
    what makes sweeping the whole frontier affordable.
    """
    try:
        ef.efficient_return(target_return=float(target))
    except Exception:
        return None
    return pd.Series(ef.clean_weights()).reindex(mu.index).fillna(0.0).values


def _trace_frontier(
    mu: pd.Series,
    S: pd.DataFrame,
    risk_free_rate: float,
    constraints: Constraints,
    n_points: int,
) -> list[dict]:
    """The efficient frontier itself: `n_points` genuinely solved portfolios,
    ordered from minimum volatility to maximum return.

    This replaces two anchor solves plus a straight-line blend between them,
    and it is the fix for the tangency portfolio going missing.
    `EfficientFrontier.max_sharpe` re-parameterises the problem so that
    `(mu - rf) @ w == 1`, which has no solution whenever the constraints admit
    no portfolio out-earning the risk-free rate. That is not an edge case here:
    a value screen selects names on weak trailing returns, and the per-stock
    cap forces the portfolio to hold enough of them that its attainable return
    lands under the T-bill rate. The solve then failed outright, taking the
    whole response with it.

    Every solve below instead minimises variance at a target return, which is
    feasible for any target between the minimum-variance portfolio's return and
    the maximum attainable one. The tangency portfolio is then *found* among
    the results rather than solved for directly, so it can no longer fail to
    exist -- when nothing beats the risk-free rate the best Sharpe is simply
    negative, which is a true statement about the screened set rather than an
    error.

    A blend of two anchors was also never the frontier: it is a chord across a
    convex set, sitting 25-50bp inside the real curve, and it stopped dead at
    the tangency point so the frontier's high-return arm was never drawn.
    """
    ef = _make_efficient_frontier(mu, S, constraints)
    ef.min_volatility()
    floor_weights = pd.Series(ef.clean_weights()).reindex(mu.index).fillna(0.0).values
    return_floor = float(floor_weights @ mu.values)

    # `_max_return` mutates the instance it runs on, so it gets a throwaway.
    return_ceiling = float(
        _make_efficient_frontier(mu, S, constraints)._max_return()
    )

    def described(weights: np.ndarray) -> dict:
        annual_return, volatility, sharpe = _portfolio_stats(
            weights, mu, S, risk_free_rate
        )
        return {
            "return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "weights": weights,
        }

    if return_ceiling - return_floor <= RETURN_SPAN_EPSILON:
        return [described(floor_weights)]

    sweep = _make_efficient_frontier(mu, S, constraints)
    points = [described(floor_weights)]

    # The ceiling came from a different instance, so the last target is pulled
    # a hair inside it rather than risking a rejection on a rounding
    # difference. Interior targets are unaffected.
    span = return_ceiling - return_floor
    targets = np.linspace(return_floor, return_ceiling - span * 1e-9, n_points)
    for target in targets[1:]:
        weights = _solve_at_return(sweep, target, mu)
        if weights is not None:
            points.append(described(weights))

    return points


def _refine_tangency(
    points: list[dict],
    mu: pd.Series,
    S: pd.DataFrame,
    risk_free_rate: float,
    constraints: Constraints,
) -> dict:
    """The maximum-Sharpe portfolio, found on the frontier and then sharpened.

    The grid gives the tangency point to within one step. Sharpe is unimodal
    along the frontier, so a ternary search over the bracketing interval closes
    that gap for a dozen extra solves -- worth it, because the capital market
    line is drawn through this point and a visibly non-tangent CML is the
    thing this chart exists to show.
    """
    best_index = max(range(len(points)), key=lambda i: points[i]["sharpe"])
    best = points[best_index]

    if len(points) < 3:
        return best

    low = points[max(best_index - 1, 0)]["return"]
    high = points[min(best_index + 1, len(points) - 1)]["return"]
    if high - low <= RETURN_SPAN_EPSILON:
        return best

    sweep = _make_efficient_frontier(mu, S, constraints)

    def sharpe_at(target: float) -> dict | None:
        weights = _solve_at_return(sweep, target, mu)
        if weights is None:
            return None
        annual_return, volatility, sharpe = _portfolio_stats(
            weights, mu, S, risk_free_rate
        )
        return {
            "return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "weights": weights,
        }

    for _ in range(TANGENCY_REFINEMENT_STEPS):
        if high - low <= RETURN_SPAN_EPSILON:
            break
        left_target = low + (high - low) / 3.0
        right_target = high - (high - low) / 3.0
        left, right = sharpe_at(left_target), sharpe_at(right_target)
        if left is None or right is None:
            break
        for candidate in (left, right):
            if candidate["sharpe"] > best["sharpe"]:
                best = candidate
        if left["sharpe"] < right["sharpe"]:
            low = left_target
        else:
            high = right_target

    return best


def _risk_contributions(
    weights: np.ndarray, S: pd.DataFrame
) -> dict[str, float]:
    """Each holding's share of total portfolio variance, summing to 1.

    Weight is not risk. A 3% position in a volatile name correlated with
    everything else can carry several times the risk of a 3% position in a
    defensive one, and a weight table alone cannot show that -- it is the
    difference between what the portfolio owns and what it is exposed to.

    The standard Euler decomposition: `w_i * (Sw)_i / (w'Sw)`. It is exact
    rather than an approximation because variance is homogeneous of degree two,
    so the parts genuinely add up to the whole. A contribution can be negative
    when a short or a hedging position reduces total variance -- that is a real
    result and is reported rather than clipped.
    """
    variance = float(weights @ S.values @ weights)
    if variance <= 0:
        return {}
    marginal = S.values @ weights
    return {
        ticker: float(weights[index] * marginal[index] / variance)
        for index, ticker in enumerate(S.index)
    }


_sector_map_cache: dict[str, str] | None = None
_sector_map_stamp: float = 0.0
_sector_map_lock = Lock()


def _sector_map() -> dict[str, str]:
    """Ticker -> sector, cached, and never allowed to fail a solve.

    Sector labels are decoration on the frontier response: they let the page
    show that a mathematically diversified portfolio is three-quarters one
    sector, which is the failure mode mean-variance optimisation is worst at
    advertising. They are not worth turning a completed optimisation into an
    error over, so a read failure yields an empty map and the page omits the
    breakdown.
    """
    global _sector_map_cache, _sector_map_stamp

    with _sector_map_lock:
        if (
            _sector_map_cache is not None
            and time.time() - _sector_map_stamp <= RISK_FREE_CACHE_TTL_SECONDS
        ):
            return _sector_map_cache

    try:
        rows = _fetch_all_rows("company_profile", "ticker, sector")
    except Exception:  # noqa: BLE001 - decoration must not fail the solve
        return {}

    mapping = {
        row["ticker"]: row.get("sector") or "Unclassified"
        for row in rows
        if row.get("ticker")
    }
    with _sector_map_lock:
        _sector_map_cache = mapping
        _sector_map_stamp = time.time()
    return mapping


def build_efficient_frontier(
    ShortAllowed: bool,
    n_portfolios: int = ENVELOPE_POINTS,
    tickers: list[str] | None = None,
    min_weight: float | None = None,
    max_weight: float | None = None,
    gamma: float = DEFAULT_L2_GAMMA,
) -> dict:
    """Build the efficient frontier for a universe of stocks.

    Traces the frontier as `n_portfolios` separately solved minimum-variance
    portfolios, then reads the tangency (max-Sharpe) and minimum-volatility
    anchors off it. Doing it in that order — frontier first, anchors second —
    is what keeps the tangency portfolio from going missing; see
    `_trace_frontier` for why solving for it directly kept failing.

    `tickers` narrows the optimisation to a screened subset. This is the whole
    point of screening before optimising: the frontier is drawn over companies
    that passed a value filter, so the optimiser cannot allocate into a stock
    that is merely rising fast. Passing None optimises the full index.

    `min_weight`, `max_weight` and `gamma` are the shape controls: the first two
    are the box the weights live in, the third is how hard the solve is pushed
    away from the corners of that box. See `_resolve_constraints` and
    `MAX_L2_GAMMA`. All three apply identically to every solve in the trace,
    which is what makes the resulting points a single frontier.
    """
    if not MIN_ENVELOPE_POINTS <= n_portfolios <= MAX_ENVELOPE_POINTS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"n_portfolios must be between {MIN_ENVELOPE_POINTS} and "
                f"{MAX_ENVELOPE_POINTS}"
            ),
        )

    # ^GSPC is deliberately not requested: it is an index, not an investable
    # holding, and nothing downstream of here uses it.
    universe = SP500_TICKERS
    if tickers:
        requested = {t.strip().upper() for t in tickers if t.strip()}
        universe = [t for t in SP500_TICKERS if t.upper() in requested]

        # Two names cannot support a covariance estimate worth optimising, and
        # a silent fallback to the full index would misreport what was solved.
        if len(universe) < MIN_FRONTIER_TICKERS:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Need at least {MIN_FRONTIER_TICKERS} known tickers to "
                    f"build a frontier; got {len(universe)}."
                ),
            )

    # Only the names being optimised are read. A ten-stock screened solve used
    # to pay for all 500.
    stock_prices = get_prices_df(universe)

    # A ticker that only listed part-way through the window reaches the
    # covariance estimator with its missing returns zero-filled, which reads as
    # unnaturally low risk and attracts weight the company never earned. Drop
    # those before anything is estimated from them.
    coverage = stock_prices.notna().sum() / len(stock_prices.index)
    short_history = sorted(coverage.index[coverage < MIN_HISTORY_COVERAGE])
    stock_prices = stock_prices[coverage.index[coverage >= MIN_HISTORY_COVERAGE]]

    if stock_prices.shape[1] < MIN_FRONTIER_TICKERS:
        # Name the dropped tickers. Without them this reads as "your 5 stocks
        # are somehow only 4", which is not something a reader can act on.
        because = (
            f" {', '.join(short_history)} "
            f"{'was' if len(short_history) == 1 else 'were'} excluded for "
            f"having under {MIN_HISTORY_COVERAGE:.0%} of the price history the "
            f"risk model needs."
            if short_history
            else ""
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {stock_prices.shape[1]} of the {len(universe)} requested "
                f"tickers can be optimised; need {MIN_FRONTIER_TICKERS}.{because}"
            ),
        )

    mu = expected_returns.mean_historical_return(stock_prices)
    mu = mu.clip(lower=-MU_CLIP, upper=MU_CLIP)
    S = risk_models.CovarianceShrinkage(stock_prices).ledoit_wolf()
    risk_free_rate = get_average_risk_free_rate()
    constraints = _resolve_constraints(
        int(stock_prices.shape[1]), ShortAllowed, min_weight, max_weight, gamma
    )

    points = _trace_frontier(mu, S, risk_free_rate, constraints, n_portfolios)
    tangency = _refine_tangency(points, mu, S, risk_free_rate, constraints)
    # The frontier is traced upward from the minimum-variance portfolio, so its
    # first point is that anchor by construction.
    minimum_variance = points[0]

    contributions = _risk_contributions(tangency["weights"], S)

    def _summarise(point: dict) -> dict:
        weights = pd.Series(point["weights"], index=mu.index)
        holdings = weights[weights.abs() > 1e-4].sort_values(ascending=False)
        return {
            "return": point["return"],
            "volatility": point["volatility"],
            "sharpe": point["sharpe"],
            "weights": {
                ticker: round(float(weight), 4) for ticker, weight in holdings.items()
            },
        }

    max_sharpe = _summarise(tangency)
    # Only for the tangency portfolio: it is the one the page presents as "the"
    # portfolio, and the decomposition costs a matrix-vector product per set.
    max_sharpe["risk_contributions"] = {
        ticker: round(contributions[ticker], 4)
        for ticker in max_sharpe["weights"]
        if ticker in contributions
    }

    envelope = [
        {
            # Position along the frontier, min-volatility end to max-return
            # end. Kept for the chart's benefit; it is an ordering, not a
            # blend weight as it was when two anchors were interpolated.
            "t": float(index / (len(points) - 1)) if len(points) > 1 else 0.0,
            "return": point["return"],
            "volatility": point["volatility"],
            "sharpe": point["sharpe"],
        }
        for index, point in enumerate(points)
    ]

    # Capital market line: from the risk-free asset through the tangency
    # (max-Sharpe) portfolio, extended past it into levered territory. It only
    # describes anything when some portfolio actually out-earns the risk-free
    # asset; below that the "line" would slope downwards and imply that taking
    # risk pays negatively, so it is withheld and the flag says why.
    tangency_beats_risk_free = max_sharpe["sharpe"] > 0
    capital_market_line: list[dict] = []
    if tangency_beats_risk_free and max_sharpe["volatility"]:
        slope = (max_sharpe["return"] - risk_free_rate) / max_sharpe["volatility"]
        max_volatility = (
            max(point["volatility"] for point in envelope) * CML_LEVERAGE_EXTENSION
        )
        capital_market_line = [
            {"volatility": volatility, "return": risk_free_rate + slope * volatility}
            for volatility in (0.0, max_volatility)
        ]

    return {
        "short_allowed": ShortAllowed,
        "n_portfolios": len(points),
        "n_assets": int(stock_prices.shape[1]),
        "risk_free_rate": risk_free_rate,
        # Surfaced because it is not always what was asked for: over a small
        # screened set the cap has to widen for the problem to have a solution
        # at all, and the reader is owed the constraints that were used rather
        # than the ones they typed.
        "max_stock_weight": constraints.upper,
        "min_stock_weight": constraints.lower,
        "l2_gamma": constraints.gamma,
        "excluded_short_history": short_history,
        # Sector labels for the holdings only. Absent keys mean the profile
        # table had nothing for that ticker; an empty map means it was
        # unreadable, and either way the page just omits the breakdown.
        "sectors": {
            ticker: sector
            for ticker, sector in _sector_map().items()
            if ticker in max_sharpe["weights"]
        },
        "tangency_beats_risk_free": tangency_beats_risk_free,
        "max_sharpe": max_sharpe,
        "min_volatility": _summarise(minimum_variance),
        "capital_market_line": capital_market_line,
        "envelope": envelope,
    }


@app.post("/efficient-frontier")
def post_efficient_frontier(
    short_allowed: bool = False,
    n_portfolios: int = ENVELOPE_POINTS,
    tickers: str | None = None,
    min_weight: float | None = None,
    max_weight: float | None = None,
    gamma: float = DEFAULT_L2_GAMMA,
):
    """Solve the frontier.

    `tickers` is a comma-separated screened subset; omit it for the full index.
    `min_weight`/`max_weight` are the per-position bounds as fractions (0.03 is
    3%); omit either to let `_resolve_constraints` pick it from the universe
    size and `short_allowed`. A negative `min_weight` permits shorting on its
    own, so `short_allowed` is only the default-setting shorthand.
    `gamma` is the L2 penalty that spreads weight across more holdings.
    """
    subset = tickers.split(",") if tickers else None
    return build_efficient_frontier(
        short_allowed, n_portfolios, subset, min_weight, max_weight, gamma
    )

