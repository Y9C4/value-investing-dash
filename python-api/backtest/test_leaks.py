"""Leak tests: nothing a rebalance date reads may be dated after it.

    cd python-api && python -m pytest backtest -q

Run against the loaded local dataset rather than fixtures, because the leak
that matters is in the real data (a fiscal year visible too early, a share
count from next month), not in a toy frame built to pass. Skips when the
database is down or Stage 0 has not been run.
"""

from __future__ import annotations

from datetime import timedelta

import pandas as pd
import pytest

from backtest import db, pit

PUBLICATION_LAG_DAYS = 90


@pytest.fixture(scope="module")
def conn():
    try:
        connection = db.connect()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"local database unreachable: {exc}")
    loaded = db.query_df(connection, "select count(*) as n from backtest.rebalance_dates")
    if loaded["n"][0] == 0:
        connection.close()
        pytest.skip("backtest dataset not loaded: run python -m backtest.load")
    yield connection
    connection.close()


@pytest.fixture(scope="module")
def dates(conn) -> list[pd.Timestamp]:
    calendar = pit.rebalance_dates(conn)
    return list(calendar.loc[calendar["period"] != "terminal", "rebalance_date"])


def test_fundamentals_are_published_by_the_rebalance_date(conn, dates):
    for as_of in dates:
        frame = pit.annual_fundamentals(conn, as_of)
        assert len(frame), f"no fundamentals at all on {as_of.date()}"
        assert (frame["available_from"] <= as_of).all()
        assert (frame["period_end"] <= as_of - timedelta(days=PUBLICATION_LAG_DAYS)).all()


def test_publication_lag_is_applied_to_every_fiscal_year(conn):
    frame = db.query_df(
        conn, "select period_end, available_from from backtest.annual_fundamentals"
    )
    lag = (frame["available_from"] - frame["period_end"]).dt.days
    assert (lag == PUBLICATION_LAG_DAYS).all()


def test_a_fiscal_year_appears_on_day_90_and_not_before(conn):
    """The boundary itself, on a real row: absent the day before, present on it."""
    row = db.query_df(
        conn,
        "select ticker, period_end from backtest.annual_fundamentals "
        "order by period_end desc limit 1 offset 50",
    ).iloc[0]

    def visible(as_of) -> bool:
        frame = pit.annual_fundamentals(conn, as_of)
        return bool(
            ((frame["ticker"] == row["ticker"]) & (frame["period_end"] == row["period_end"])).any()
        )

    assert not visible(row["period_end"] + timedelta(days=PUBLICATION_LAG_DAYS - 1))
    assert visible(row["period_end"] + timedelta(days=PUBLICATION_LAG_DAYS))


@pytest.mark.parametrize("column", ["close", "adj_close"])
def test_prices_end_on_the_rebalance_date(conn, dates, column):
    for as_of in dates:
        frame = pit.prices(conn, as_of, lookback_days=400, column=column)
        assert frame.index.max() <= as_of
        # The rebalance date is a trading day by construction, so it is the
        # last row, not some earlier one.
        assert frame.index.max() == as_of


def test_share_counts_are_on_or_before_the_rebalance_date(conn, dates):
    for as_of in dates:
        frame = pit.shares(conn, as_of)
        assert len(frame)
        assert (frame["date"] <= as_of).all()


def test_factors_end_on_or_before_the_rebalance_date(conn, dates):
    for as_of in dates:
        frame = pit.factors(conn, as_of, lookback_days=400)
        assert len(frame)
        assert frame.index.max() <= as_of


def test_embargo_keeps_development_windows_out_of_the_holdout(conn):
    calendar = pit.rebalance_dates(conn)
    development = calendar[calendar["period"] == "development"]
    holdout = calendar[calendar["period"] == "holdout"]
    assert len(development) and len(holdout)
    # The last development return window must close before the first holdout
    # date, or a development result would have seen holdout returns.
    assert development["next_date"].max() < holdout["rebalance_date"].min()
    # Every window closes on the next date in the calendar.
    windows = calendar.dropna(subset=["next_date"])
    assert (windows["next_date"].values == calendar["rebalance_date"].values[1:]).all()


# Splits where the count moves for a reason other than the split, checked by
# hand. CVNA: Yahoo's history switches from Class A + B (~220M) to Class A
# only (~143M) three weeks before its May 2026 5-for-1 split.
SPLIT_EXCEPTIONS = {("CVNA", "2026-05-08")}


def test_split_adjusted_share_counts_are_continuous_across_splits(conn):
    """Not a leak, but the failure that would silently wreck every market cap:
    a split counted zero or two times moves the count by the split ratio.

    True splits only (integer ratios, either way). Yahoo also records spin-offs
    as fractional "splits" (DHR 1.319 for Fortive) to scale old prices down;
    there the adjusted count is meant to jump, so that close x shares stays the
    pre-spin-off market cap that matches the pre-spin-off statements. From 2022
    on, because nothing earlier feeds a rebalance date.
    """
    splits = db.query_df(
        conn, "select ticker, date, ratio from backtest.splits where date >= '2022-01-01'"
    )
    true_split = splits["ratio"].where(splits["ratio"] >= 1, 1 / splits["ratio"])
    splits = splits[(true_split >= 2) & ((true_split - true_split.round()).abs() < 0.01)]

    checked, broken = 0, []
    for split in splits.itertuples():
        if (split.ticker, split.date.date().isoformat()) in SPLIT_EXCEPTIONS:
            continue
        before = pit.shares(conn, split.date - timedelta(days=10))
        after = pit.shares(conn, split.date + timedelta(days=45))
        if split.ticker not in before.index or split.ticker not in after.index:
            continue
        ratio = after.loc[split.ticker, "shares"] / before.loc[split.ticker, "shares"]
        if not 0.8 < ratio < 1.25:
            broken.append(f"{split.ticker} {split.date.date()} ({split.ratio:g}:1) moved {ratio:.2f}x")
        checked += 1
    assert checked >= 10, f"only {checked} splits had share history on both sides"
    assert not broken, broken
