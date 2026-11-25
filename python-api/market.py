"""Reading market data back out of Supabase: prices, returns and the risk-free
rate, with the caches that keep a solve from paying for them twice."""

from __future__ import annotations

import time
from datetime import date, timedelta
from threading import Lock

import pandas as pd
from fastapi import HTTPException

import config
import dw

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
    """The annualised 13-week treasury rate (252-day average), cached.

    The optimiser's cash rate, for its Sharpe ratios. The valuation models
    discount at the 10-year yield instead; both come off `market_summary`.
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

    rows = dw.fetch("select short_rate from public.market_summary")

    if not rows or rows[0][0] is None:
        raise HTTPException(status_code=404, detail="No risk-free rate data")

    with _risk_free_lock:
        _risk_free_rate = float(rows[0][0])
        _risk_free_stamp = time.time()

    return _risk_free_rate


def clear_price_cache() -> None:
    """Called after a warehouse refresh, so the frontier cannot serve stale
    closes or a stale cash rate (both change with the same ingest)."""
    global _risk_free_rate
    with _price_cache_lock:
        _price_column_cache.clear()
    with _risk_free_lock:
        _risk_free_rate = None


def _window_start() -> date:
    return date.today() - timedelta(days=config.PRICE_WINDOW_DAYS)


def prices_df(tickers: list[str]) -> pd.DataFrame:
    """Dividend-adjusted daily closes for exactly `tickers` over the last
    `config.PRICE_WINDOW_DAYS`, pivoted wide (index=date, columns=ticker).

    Adjusted, so expected returns include dividends. Windowed, because
    `raw.daily_prices` holds history back to 2015 and an unbounded read pulled
    ~1.45M rows on every cold start.

    Two details, together worth ~80s per optimisation:

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
        rows = dw.fetch(
            "select date, ticker, adj_close::float8 from public.stock_prices"
            " where ticker = any(%s) and date >= %s order by date, ticker",
            (missing, _window_start()),
        )
        if rows:
            frame = pd.DataFrame(rows, columns=["date", "ticker", "adj_close"])
            frame["date"] = pd.to_datetime(frame["date"])
            wide = frame.pivot(index="date", columns="ticker", values="adj_close")
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
            detail="No close price data. Run /backfill/prices first.",
        )

    return pd.DataFrame(columns).sort_index()

