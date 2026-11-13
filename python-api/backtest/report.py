"""Stage 0 quality report: what the dataset covers, and where it cannot be trusted.

Printed at the end of every full load and on `python -m backtest.load --report`.
Each section answers a question the later stages would otherwise discover the
hard way.
"""

from __future__ import annotations

import pandas as pd

from backtest import pit
from backtest.db import query_df

# A share count moving more than this between two filings is far more often a
# data error than a real event. Real buybacks run a few percent a year.
SHARE_JUMP = 1.5


def _section(title: str) -> None:
    print(f"\n== {title} ==")


def _table(frame: pd.DataFrame) -> None:
    with pd.option_context("display.width", 160, "display.max_columns", 20):
        print(frame.to_string(index=False))


def tables(conn) -> None:
    _section("Tables")
    _table(query_df(conn, """
        select 'daily_prices' as table_name, count(*) as rows, count(distinct ticker) as tickers,
               min(date)::text as first, max(date)::text as last from backtest.daily_prices
        union all select 'splits', count(*), count(distinct ticker), min(date)::text, max(date)::text from backtest.splits
        union all select 'statement_items (annual)', count(*), count(distinct ticker), min(period_end)::text, max(period_end)::text
                  from backtest.statement_items where frequency = 'annual'
        union all select 'statement_items (quarterly)', count(*), count(distinct ticker), min(period_end)::text, max(period_end)::text
                  from backtest.statement_items where frequency = 'quarterly'
        union all select 'shares_outstanding', count(*), count(distinct ticker), min(date)::text, max(date)::text from backtest.shares_outstanding
        union all select 'earnings_dates', count(*), count(distinct ticker), min(report_date)::text, max(report_date)::text from backtest.earnings_dates
        union all select 'factor_returns', count(*), null, min(date)::text, max(date)::text from backtest.factor_returns
        union all select 'universe', count(*), count(distinct ticker), null, null from backtest.universe
    """))


def failures(conn) -> None:
    _section("Latest load per dataset")
    _table(query_df(conn, """
        select distinct on (dataset) dataset, finished_at::timestamp(0)::text as loaded,
               rows_loaded, tickers_ok, cardinality(tickers_failed) as failed,
               array_to_string(tickers_failed[1:8], ',') as examples
        from backtest.load_runs order by dataset, finished_at desc
    """))


def coverage(conn) -> None:
    """How many stocks each model could even attempt, per rebalance date."""
    _section("Coverage per rebalance date (of the universe)")
    tickers = set(pit.universe(conn)["ticker"])
    rows = []
    for r in pit.rebalance_dates(conn).itertuples():
        as_of = r.rebalance_date
        latest = pit.latest_fundamentals(conn, as_of)
        px = pit.prices(conn, as_of, 7)
        priced = set(px.columns[px.iloc[-1].notna()]) if not px.empty else set()
        sh = pit.shares(conn, as_of)
        fcf = latest["free_cash_flow"]
        rows.append({
            "date": as_of.date().isoformat(),
            "period": r.period,
            "priced": len(priced & tickers),
            "has_fy": len(latest),
            "fcf>0": int((fcf > 0).sum()),
            "fcf<=0": int((fcf <= 0).sum()),
            "no_fcf": int(fcf.isna().sum()),
            "book>0": int((latest["book_equity"] > 0).sum()),
            "shares": len(sh),
            "fy_age_days(med)": int((as_of - latest["period_end"]).dt.days.median())
            if len(latest) else None,
        })
    print(f"universe: {len(tickers)}")
    _table(pd.DataFrame(rows))


def publication_lag(conn) -> None:
    """Is "usable 90 days after fiscal year end" ever too early?

    Compares each annual period's assumed availability with the first earnings
    announcement after it. Results are public at the announcement; the 10-K
    with the full cash flow statement can follow a few weeks later, which the
    90-day rule is meant to cover.
    """
    _section("Publication lag check (annual periods vs first earnings date after)")
    lag = query_df(conn, """
        with periods as (
          select distinct ticker, period_end from backtest.statement_items
          where frequency = 'annual'
        )
        select p.ticker, p.period_end, e.report_date,
               e.report_date - p.period_end as lag_days
        from periods p
        left join lateral (
          select min(report_date) as report_date from backtest.earnings_dates ed
          where ed.ticker = p.ticker and ed.report_date > p.period_end
            and ed.report_date <= p.period_end + 150
        ) e on true
    """)
    matched = lag.dropna(subset=["report_date"])
    late = matched[matched["lag_days"] > 90].sort_values("lag_days", ascending=False)
    print(
        f"annual periods: {len(lag)}, matched to an announcement: {len(matched)}, "
        f"median lag {matched['lag_days'].median():.0f} days, "
        f"p95 {matched['lag_days'].quantile(0.95):.0f}, "
        f"announced after day 90: {len(late)}"
    )
    if len(late):
        print("latest announcers:")
        _table(late.head(10).assign(
            period_end=lambda f: f["period_end"].dt.date,
            report_date=lambda f: f["report_date"].dt.date,
        ))


def share_counts(conn) -> None:
    """Share-history glitches, and agreement with the statements' counts."""
    _section("Share counts")
    jumps = query_df(conn, """
        select ticker, date, shares, prev, shares / prev as ratio from (
          select ticker, date, shares,
                 lag(shares) over (partition by ticker order by date) as prev
          from backtest.shares_adjusted
        ) s
        where prev is not null and (shares / prev > %s or prev / shares > %s)
        order by ticker, date
    """, (SHARE_JUMP, SHARE_JUMP))
    print(
        f"observations jumping by more than {SHARE_JUMP}x vs the previous filing: "
        f"{len(jumps)} across {jumps['ticker'].nunique()} tickers "
        "(isolated spikes are data errors; Stage 1 should use a rolling median)"
    )
    if len(jumps):
        _table(jumps.groupby("ticker").size().sort_values(ascending=False)
               .head(10).rename("jumps").reset_index())

    agree = query_df(conn, """
        select f.ticker, f.period_end, f.shares_outstanding as statement_shares,
               s.shares as history_shares
        from backtest.annual_fundamentals f
        join lateral (
          select shares from backtest.shares_adjusted sa
          where sa.ticker = f.ticker and sa.date between f.period_end - 45 and f.period_end + 45
          order by abs(sa.date - f.period_end) limit 1
        ) s on true
        where f.shares_outstanding > 0
    """)
    ratio = agree["history_shares"] / agree["statement_shares"]
    off = agree[(ratio > 1.2) | (ratio < 1 / 1.2)]
    print(
        f"history vs statement share count at fiscal year end: {len(agree)} pairs, "
        f"median ratio {ratio.median():.3f}, off by more than 20%: {len(off)} "
        f"({off['ticker'].nunique()} tickers)"
    )


def factor_window(conn) -> None:
    _section("Factor coverage")
    last = pd.Timestamp(
        query_df(conn, "select max(date) as last from backtest.factor_returns")["last"][0]
    )
    windows = pit.rebalance_dates(conn)
    uncovered = windows[windows["next_date"].notna() & (windows["next_date"] > last)]
    print(f"last factor date: {last.date()}")
    if len(uncovered):
        print(
            "forward windows extending past it (need the market-excess fallback "
            "until Ken French updates): "
            + ", ".join(d.date().isoformat() for d in uncovered["rebalance_date"])
        )


def print_report(conn) -> None:
    tables(conn)
    failures(conn)
    coverage(conn)
    publication_lag(conn)
    share_counts(conn)
    factor_window(conn)
