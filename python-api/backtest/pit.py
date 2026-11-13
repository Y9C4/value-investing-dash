"""Point-in-time reads of the backtest dataset.

Every input a rebalance date may use comes through a function here that takes
`as_of` and filters on the date the fact became *known*, not the date it
describes. Stage 1 must not query the tables directly; test_leaks.py checks
these functions, and that check only covers code that goes through them.

The one deliberate exception is `forward_returns`, the target, which by
definition looks past `as_of`. It is named as such and nothing that builds a
signal should call it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from backtest.db import query_df

DateLike = date | str | pd.Timestamp


def _d(value: DateLike) -> date:
    return pd.Timestamp(value).date()


def universe(conn) -> pd.DataFrame:
    """Ticker, name, sector and industry: today's values (acknowledged look-ahead)."""
    return query_df(conn, "select * from backtest.universe order by ticker")


def rebalance_dates(conn, period: str | None = None) -> pd.DataFrame:
    """The calendar: rebalance_date, period, next_date. `period` filters it."""
    sql = "select * from backtest.rebalance_dates"
    params: tuple = ()
    if period:
        sql += " where period = %s"
        params = (period,)
    return query_df(conn, sql + " order by rebalance_date", params)


def annual_fundamentals(conn, as_of: DateLike) -> pd.DataFrame:
    """Every fiscal year published by `as_of`, newest first per ticker.

    `years_back` is 0 for the latest usable year, 1 for the one before, and so
    on, so trailing growth can be computed without re-sorting.
    """
    return query_df(
        conn,
        """
        select *,
               (row_number() over (partition by ticker order by period_end desc)) - 1
                 as years_back
        from backtest.annual_fundamentals
        where available_from <= %s
        order by ticker, period_end desc
        """,
        (_d(as_of),),
    )


def latest_fundamentals(conn, as_of: DateLike) -> pd.DataFrame:
    """The latest published fiscal year per ticker, indexed by ticker."""
    frame = annual_fundamentals(conn, as_of)
    return frame[frame["years_back"] == 0].set_index("ticker")


# Window for the share-count median. Yahoo's history interleaves two sources
# (NVDA alternates 2.50bn / 2.57bn week to week) and sometimes posts the
# post-split count days before the split date, which split adjustment then
# multiplies a second time. A median over a quarter absorbs both.
SHARES_MEDIAN_DAYS = 90


def shares(conn, as_of: DateLike, max_age_days: int = 400) -> pd.DataFrame:
    """Split-adjusted share count per ticker as of `as_of`.

    The median of the observations in the SHARES_MEDIAN_DAYS before the latest
    one, not the latest alone (see above). Indexed by ticker, with `date` the
    latest observation so staleness is visible. Tickers whose latest count is
    older than `max_age_days` are dropped rather than carried forward.
    """
    as_of_d = _d(as_of)
    return query_df(
        conn,
        """
        with recent as (
          select ticker, date, shares,
                 max(date) over (partition by ticker) as latest
          from backtest.shares_adjusted
          where date <= %s and date > %s
        )
        select ticker, max(date) as date,
               percentile_cont(0.5) within group (order by shares) as shares,
               count(*) as observations
        from recent
        where date > latest - %s
        group by ticker
        """,
        (as_of_d, as_of_d - timedelta(days=max_age_days), SHARES_MEDIAN_DAYS),
    ).set_index("ticker")


def prices(
    conn, as_of: DateLike, lookback_days: int, column: str = "close"
) -> pd.DataFrame:
    """Wide daily prices (index date, columns ticker) for the window ending
    at `as_of`, inclusive.

    `column="close"` is split-adjusted only, for market cap. `"adj_close"` also
    reinvests dividends, for returns and betas.
    """
    if column not in ("close", "adj_close"):
        raise ValueError(f"unknown price column {column!r}")
    as_of_d = _d(as_of)
    long = query_df(
        conn,
        f"""
        select ticker, date, {column} as value
        from backtest.daily_prices
        where date <= %s and date > %s
        """,
        (as_of_d, as_of_d - timedelta(days=lookback_days)),
    )
    if long.empty:
        return pd.DataFrame()
    return long.pivot(index="date", columns="ticker", values="value").sort_index()


def factors(conn, as_of: DateLike, lookback_days: int) -> pd.DataFrame:
    """Daily Fama-French factors for the window ending at `as_of`, indexed by date."""
    as_of_d = _d(as_of)
    return query_df(
        conn,
        "select * from backtest.factor_returns where date <= %s and date > %s "
        "order by date",
        (as_of_d, as_of_d - timedelta(days=lookback_days)),
    ).set_index("date")


def forward_returns(conn, start: DateLike, end: DateLike) -> pd.Series:
    """TARGET ONLY: total return per ticker from the close on `start` to the
    close on `end`, using dividend-adjusted prices.

    Tickers without a price on both days are dropped, not zero-filled.
    """
    frame = query_df(
        conn,
        """
        select s.ticker, e.adj_close / s.adj_close - 1 as ret
        from backtest.daily_prices s
        join backtest.daily_prices e on e.ticker = s.ticker and e.date = %s
        where s.date = %s
        """,
        (_d(end), _d(start)),
    )
    return frame.set_index("ticker")["ret"].astype(float)
