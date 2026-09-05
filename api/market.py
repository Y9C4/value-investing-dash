"""Reading market data back out of Supabase: prices, returns and the risk-free
rate, with the caches that keep a solve from paying for them twice."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Lock

import pandas as pd
from fastapi import HTTPException

import config
import db
import engine

# How much history to hold. Every return calculation asks for 252 trading days
# and `period="1y"` yields only ~250 rows; two years leaves headroom for the
# Fama-French series, which publishes weeks in arrears.
PRICE_HISTORY_PERIOD = "2y"
RETURNS_LOOKBACK_DAYS = 252

# Paged price reads are independent round trips, so they overlap.
PRICE_FETCH_MAX_WORKERS = 6
# Closes for a settled session do not change, and re-reading them per request
# was most of what an optimisation spent its time on.
PRICE_CACHE_TTL_SECONDS = 900
RISK_FREE_CACHE_TTL_SECONDS = 900

_price_column_cache: dict[str, pd.Series] = {}
_price_cache_stamp: float = 0.0
_price_cache_lock = Lock()

_risk_free_rate: float | None = None
_risk_free_stamp: float = 0.0
_risk_free_lock = Lock()


def average_risk_free_rate() -> float:
    """The stored annualised 13-week treasury rate, cached.

    Every frontier solve needs this one number and it was re-read each time,
    putting an extra round trip on the busiest endpoint in the app.
    """
    global _risk_free_rate, _risk_free_stamp

    with _risk_free_lock:
        if (
            _risk_free_rate is not None
            and time.time() - _risk_free_stamp <= RISK_FREE_CACHE_TTL_SECONDS
        ):
            return _risk_free_rate

    rows = db.read(
        lambda client: client.table("average_risk_free_rate")
        .select("annual_risk_free_rate")
        .execute()
    ).data

    if not rows or rows[0]["annual_risk_free_rate"] is None:
        raise HTTPException(status_code=404, detail="No risk-free rate data")

    with _risk_free_lock:
        _risk_free_rate = rows[0]["annual_risk_free_rate"]
        _risk_free_stamp = time.time()

    return _risk_free_rate


def expected_market_return() -> float | None:
    """The index's annualised log return over the same 252-day window.

    A universe-level scalar, like the risk-free rate beside it: every stock page
    reads the same figure, so it is computed once here rather than derived from
    a per-ticker response. `ticker_statistics` cannot carry it, because ^GSPC is
    the benchmark rather than a member of the universe and gets no row.

    None rather than 0.0 when there is no history: a market return of zero is a
    statement, and an absent one is not.
    """
    res = db.read(
        lambda client: client.table("daily_log_returns")
        .select("log_return")
        .eq("ticker", config.SP500_INDEX_TICKER)
        .order("date", desc=True)
        .limit(RETURNS_LOOKBACK_DAYS)
        .execute()
    )

    returns = [
        float(row["log_return"])
        for row in (res.data or [])
        if row.get("log_return") is not None
    ]
    if not returns:
        return None

    return sum(returns) / len(returns) * RETURNS_LOOKBACK_DAYS


def returns_df(ticker: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Daily log returns for `ticker` alongside ^GSPC on the same dates, plus
    their 2x2 variance-covariance matrix.

    Rows with any missing return are dropped: a ticker's first trading day has
    no prior close to diff against.
    """
    symbol = ticker.upper()

    res = db.read(
        lambda client: client.table("daily_excess_returns")
        .select("date, close, stock_log_return, market_log_return, excess_log_return")
        .eq("ticker", symbol)
        .order("date")
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail=f"No return data for '{symbol}'")

    frame = pd.DataFrame(res.data)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.set_index("date").dropna()

    returns = frame[["stock_log_return", "market_log_return"]]
    centered = returns - returns.mean()
    varcov = centered.T @ centered / len(centered)
    return frame, varcov


def clear_price_cache() -> None:
    """Called after a price backfill, so the frontier cannot serve stale closes."""
    with _price_cache_lock:
        _price_column_cache.clear()


def _fetch_price_page(chunk: list[str], start: int) -> list[dict]:
    return db.read(
        lambda client: client.table("daily_close_prices")
        .select("date, ticker, close")
        .in_("ticker", chunk)
        .order("date")
        .order("ticker")
        .range(start, start + config.SELECT_PAGE_SIZE - 1)
        .execute()
    ).data


def _fetch_price_chunk(chunk: list[str]) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = _fetch_price_page(chunk, start)
        rows.extend(page)
        if len(page) < config.SELECT_PAGE_SIZE:
            break
        start += config.SELECT_PAGE_SIZE
    return rows


def prices_df(tickers: list[str]) -> pd.DataFrame:
    """Daily closes for exactly `tickers`, pivoted wide (index=date, columns=ticker).

    Three details, together worth ~80s per optimisation:

    - The whole index is ~258 sequential pages and they do not depend on each
      other, so they are issued in parallel.
    - The ticker list is pushed down into the query. Optimising ten screened
      names used to pay for reading all 500.
    - Columns are cached per ticker rather than per request, so a small solve
      warms what a later, wider one reuses.
    """
    global _price_cache_stamp

    with _price_cache_lock:
        if time.time() - _price_cache_stamp > PRICE_CACHE_TTL_SECONDS:
            _price_column_cache.clear()
            _price_cache_stamp = time.time()
        missing = [t for t in tickers if t not in _price_column_cache]

    if missing:
        # Build the client's lazy internals on this thread first. Letting six
        # workers race that construction produced rare errors from inside the
        # library on the first wide read after the cache emptied.
        db.client().table("daily_close_prices")

        chunks = list(db.chunk(missing, config.FETCH_CHUNK_SIZE))
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

        # A ticker with no stored rows is cached empty rather than re-read every
        # request; the frontier drops it for short history.
        with _price_cache_lock:
            for ticker in missing:
                _price_column_cache.setdefault(
                    ticker, pd.Series(dtype="float64", name=ticker)
                )

    with _price_cache_lock:
        columns = {
            ticker: _price_column_cache[ticker]
            for ticker in tickers
            if ticker in _price_column_cache and not _price_column_cache[ticker].empty
        }

    if not columns:
        raise HTTPException(
            status_code=404,
            detail="No close price data. Run /backfill/sp500-daily-close first.",
        )

    return pd.DataFrame(columns).sort_index()


def recent_prices_df() -> pd.DataFrame:
    """Closes inside the valuation window, pivoted wide.

    Bounded rather than reading the whole table: the models only look at 252
    trading days, so an unbounded read would grow the egress bill as history
    accumulates, for rows that get discarded.
    """
    cutoff = (date.today() - timedelta(days=engine.PRICE_WINDOW_DAYS)).isoformat()

    rows: list[dict] = []
    start = 0
    while True:
        page = db.read(
            lambda client, start=start: client.table("daily_close_prices")
            .select("date, ticker, close")
            .gte("date", cutoff)
            .order("date")
            .order("ticker")
            .range(start, start + config.SELECT_PAGE_SIZE - 1)
            .execute()
        ).data
        rows.extend(page)
        if len(page) < config.SELECT_PAGE_SIZE:
            break
        start += config.SELECT_PAGE_SIZE

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No close price data. Run /backfill/sp500-daily-close first.",
        )

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"])
    frame["close"] = pd.to_numeric(frame["close"])
    frame = frame.drop_duplicates(subset=["date", "ticker"])
    return frame.pivot(index="date", columns="ticker", values="close").sort_index()
