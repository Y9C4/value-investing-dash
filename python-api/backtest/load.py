"""Stage 0: pull the backtest dataset from yfinance into the `backtest` schema.

    python -m backtest.load                      # everything, then the report
    python -m backtest.load --only prices        # one dataset
    python -m backtest.load --only fundamentals --tickers AAPL,MSFT
    python -m backtest.load --report             # quality report only

Run from python-api/. Every dataset is replaced wholesale (or per ticker with
--tickers), never merged, so the tables always hold one consistent pull.
Raw values only: the point-in-time rules live in the views and in pit.py.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

import pandas as pd
import yfinance as yf

import config
import factors
from backtest import db, report

# Prices from 2015: share-count history starts there, the 252-day betas for the
# first rebalance (Apr 2023) need 2022, and it keeps the optional 2015-2026
# optimiser comparison in backtests.md §7 possible without a second pull.
PRICE_START = "2015-01-01"
SHARES_START = "2015-01-01"

# Benchmarks and series that are not constituents. ^SP500TR is the total-return
# index (dividends reinvested), RSP the equal-weight S&P 500 ETF, ^IRX the
# 13-week T-bill yield and ^TNX the 10-year Treasury yield, both in percent.
EXTRA_PRICE_TICKERS = ["^GSPC", "^SP500TR", "RSP", "^IRX", "^TNX"]

# Same worker count the nightly fundamentals job settled on: 8 sustained
# ~0.4 s/ticker against Yahoo with no throttling.
MAX_WORKERS = 8
FETCH_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2.0
PRICE_CHUNK_SIZE = 50
# Yahoo pages earnings dates; 40 reaches back about ten years.
EARNINGS_DATES_LIMIT = 40

# The validation design, backtests.md §4. Rebalances are the last trading day
# of these months.
REBALANCE_MONTHS = (1, 4, 7, 10)
FIRST_REBALANCE = "2023-04"
LAST_DEVELOPMENT = "2025-01"
EMBARGO = ("2025-04",)
LAST_HOLDOUT = "2026-07"
# Not a rebalance: the date that closes the last holdout window.
TERMINAL = "2026-10"

DATASETS = ("universe", "prices", "fundamentals", "factors", "calendar")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _finite(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) or math.isinf(result) else result


def _log_run(
    conn,
    dataset: str,
    started: datetime,
    rows: int,
    ok: int | None = None,
    failed: list[str] | None = None,
    detail: dict | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into backtest.load_runs "
            "(dataset, started_at, rows_loaded, tickers_ok, tickers_failed, detail) "
            "values (%s, %s, %s, %s, %s, %s)",
            (dataset, started, rows, ok, failed or [], json.dumps(detail or {})),
        )
    conn.commit()


def _say(message: str) -> None:
    print(message, flush=True)


# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------


def load_universe(conn, tickers: list[str]) -> None:
    """Today's constituents with the sector the product already stores."""
    started = datetime.now(timezone.utc)
    profiles = db.query_df(
        conn, "select ticker, name, sector, industry from public.company_profile"
    ).set_index("ticker")

    rows = []
    missing = []
    for ticker in tickers:
        if ticker in profiles.index:
            p = profiles.loc[ticker]
            rows.append((ticker, p["name"], p["sector"], p["industry"]))
        else:
            # Kept in the universe: a missing sector costs sector-relative
            # signals for this name, not its prices or statements.
            missing.append(ticker)
            rows.append((ticker, None, None, None))

    n = db.replace_rows(
        conn, "backtest.universe", ["ticker", "name", "sector", "industry"], rows
    )
    _log_run(conn, "universe", started, n, len(rows) - len(missing), missing)
    _say(f"universe: {n} tickers ({len(missing)} without a profile)")


# ---------------------------------------------------------------------------
# Prices and splits
# ---------------------------------------------------------------------------


def _download_chunk(chunk: list[str]) -> pd.DataFrame:
    last_exc: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            return yf.download(
                tickers=chunk,
                start=PRICE_START,
                # Exclusive: today's bar may still be trading.
                end=date.today().isoformat(),
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                actions=True,
                threads=True,
                progress=False,
            )
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            last_exc = exc
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    raise RuntimeError(f"download failed: {last_exc}")


def load_prices(conn, tickers: list[str], subset: bool) -> None:
    started = datetime.now(timezone.utc)
    symbols = tickers if subset else [*tickers, *EXTRA_PRICE_TICKERS]

    price_rows: list[tuple] = []
    split_rows: list[tuple] = []
    failed: list[str] = []
    errors: dict[str, str] = {}

    for i in range(0, len(symbols), PRICE_CHUNK_SIZE):
        chunk = symbols[i : i + PRICE_CHUNK_SIZE]
        try:
            data = _download_chunk(chunk)
        except Exception as exc:  # noqa: BLE001
            failed.extend(chunk)
            errors[f"{chunk[0]}..{chunk[-1]}"] = str(exc)
            continue

        for ticker in chunk:
            try:
                frame = data[ticker] if isinstance(data.columns, pd.MultiIndex) else data
            except KeyError:
                failed.append(ticker)
                errors[ticker] = "absent from download"
                continue

            frame = frame.dropna(subset=["Close"])
            if frame.empty:
                failed.append(ticker)
                errors[ticker] = "no rows"
                continue

            close = frame["Close"]
            # Indices carry no separate adjusted series; fall back to Close.
            adj = frame["Adj Close"].fillna(close) if "Adj Close" in frame else close
            volume = frame["Volume"] if "Volume" in frame else pd.Series(index=frame.index)
            days = frame.index.date
            for day, c, a, v in zip(days, close, adj, volume):
                price_rows.append((ticker, day, float(c), float(a), _finite(v)))
            if "Stock Splits" in frame:
                for day, ratio in zip(days, frame["Stock Splits"]):
                    r = _finite(ratio)
                    if r and r > 0:
                        split_rows.append((ticker, day, r))

        _say(f"  prices: {min(i + PRICE_CHUNK_SIZE, len(symbols))}/{len(symbols)}")

    # As with fundamentals: a failed ticker keeps its earlier rows.
    ok = [t for t in symbols if t not in failed]
    scope = ok if subset or failed else None
    n = db.replace_rows(
        conn,
        "backtest.daily_prices",
        ["ticker", "date", "close", "adj_close", "volume"],
        price_rows,
        scope,
    )
    s = db.replace_rows(
        conn, "backtest.splits", ["ticker", "date", "ratio"], split_rows, scope
    )
    _log_run(conn, "prices", started, n, len(symbols) - len(failed), failed, errors)
    _log_run(conn, "splits", started, s)
    _say(f"prices: {n} bars, {s} splits, {len(failed)} failed {failed[:10]}")


# ---------------------------------------------------------------------------
# Statements, share counts, earnings dates
# ---------------------------------------------------------------------------


def _statement_rows(symbol: str, frequency: str, statement: str, frame) -> dict:
    """Melt one yfinance statement frame (items x period ends) to long rows,
    keyed so a duplicated item label cannot break the primary key."""
    out: dict[tuple, tuple] = {}
    if frame is None or frame.empty:
        return out
    for item, series in frame.iterrows():
        for period, value in series.items():
            v = _finite(value)
            if v is None:
                continue
            period_end = pd.Timestamp(period).date()
            key = (frequency, statement, period_end, str(item))
            out.setdefault(key, (symbol, frequency, statement, period_end, str(item), v))
    return out


def _fetch_one(symbol: str) -> dict:
    """Everything per-company, from one yf.Ticker. Statements are required;
    share history and earnings dates are optional and fail soft."""
    result = {"ticker": symbol, "items": [], "shares": [], "earnings": [],
              "error": None, "warnings": []}

    for attempt in range(FETCH_ATTEMPTS):
        try:
            t = yf.Ticker(symbol)
            items: dict = {}
            for frequency, frames in (
                ("annual", (("income", t.income_stmt), ("balance", t.balance_sheet),
                            ("cashflow", t.cashflow))),
                ("quarterly", (("income", t.quarterly_income_stmt),
                               ("balance", t.quarterly_balance_sheet),
                               ("cashflow", t.quarterly_cashflow))),
            ):
                for statement, frame in frames:
                    items.update(_statement_rows(symbol, frequency, statement, frame))

            # An empty pull is how Yahoo throttling usually shows up, so it is
            # retried like an exception rather than accepted as "no data".
            if not any(k[0] == "annual" for k in items):
                raise RuntimeError("no annual statements returned")
            result["items"] = list(items.values())
            break
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    else:
        return result
    result["error"] = None

    try:
        shares = t.get_shares_full(start=SHARES_START)
        if shares is not None and len(shares):
            series = shares[shares > 0]
            series.index = [pd.Timestamp(i).date() for i in series.index]
            # Several filings can land on one day; the last is the latest word.
            series = series.groupby(level=0).last()
            result["shares"] = [(symbol, d, float(v)) for d, v in series.items()]
    except Exception as exc:  # noqa: BLE001
        result["warnings"].append(f"shares: {exc}")

    try:
        earnings = t.get_earnings_dates(limit=EARNINGS_DATES_LIMIT)
        if earnings is not None and not earnings.empty:
            today = date.today()
            seen: dict = {}
            for idx, row in earnings.iterrows():
                day = pd.Timestamp(idx).date()
                # Future rows are Yahoo's schedule, not an announcement.
                if day > today or day in seen:
                    continue
                seen[day] = (symbol, day, _finite(row.get("EPS Estimate")),
                             _finite(row.get("Reported EPS")))
            result["earnings"] = list(seen.values())
    except Exception as exc:  # noqa: BLE001
        result["warnings"].append(f"earnings dates: {exc}")

    return result


def load_fundamentals(conn, tickers: list[str], subset: bool) -> None:
    started = datetime.now(timezone.utc)
    items: list[tuple] = []
    shares: list[tuple] = []
    earnings: list[tuple] = []
    failed: list[str] = []
    errors: dict[str, str] = {}
    no_shares: list[str] = []
    no_earnings: list[str] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for n_done, res in enumerate(pool.map(_fetch_one, tickers), start=1):
            if res["error"]:
                failed.append(res["ticker"])
                errors[res["ticker"]] = res["error"]
            items.extend(res["items"])
            shares.extend(res["shares"])
            earnings.extend(res["earnings"])
            if not res["shares"]:
                no_shares.append(res["ticker"])
            if not res["earnings"]:
                no_earnings.append(res["ticker"])
            if res["warnings"]:
                errors[res["ticker"]] = "; ".join(res["warnings"])
            if n_done % 50 == 0 or n_done == len(tickers):
                _say(f"  fundamentals: {n_done}/{len(tickers)}")

    # A ticker that failed outright keeps whatever an earlier pull stored,
    # rather than being wiped by a scoped delete with nothing to replace it.
    ok = [t for t in tickers if t not in failed]
    scope = ok if subset or failed else None

    n = db.replace_rows(
        conn, "backtest.statement_items",
        ["ticker", "frequency", "statement", "period_end", "item", "value"],
        items, scope,
    )
    s = db.replace_rows(
        conn, "backtest.shares_outstanding", ["ticker", "date", "shares"], shares, scope
    )
    e = db.replace_rows(
        conn, "backtest.earnings_dates",
        ["ticker", "report_date", "eps_estimate", "reported_eps"], earnings, scope,
    )
    _log_run(conn, "statement_items", started, n, len(ok), failed, errors)
    _log_run(conn, "shares_outstanding", started, s, len(tickers) - len(no_shares),
             no_shares)
    _log_run(conn, "earnings_dates", started, e, len(tickers) - len(no_earnings),
             no_earnings)
    _say(
        f"fundamentals: {n} line items, {s} share counts, {e} earnings dates; "
        f"{len(failed)} failed {failed[:10]}, {len(no_shares)} without share "
        f"history, {len(no_earnings)} without earnings dates"
    )
    if failed:
        _say("  retry with: python -m backtest.load --only fundamentals --tickers "
             + ",".join(failed))


# ---------------------------------------------------------------------------
# Factors and the rebalance calendar
# ---------------------------------------------------------------------------


def load_factors(conn) -> None:
    started = datetime.now(timezone.utc)
    frame = factors.fetch_factor_returns()
    columns = ["date", "mkt_rf", "smb", "hml", "rmw", "cma", "umd", "rf"]
    rows = [
        (r.date.date(), *(_finite(getattr(r, c)) for c in columns[1:]))
        for r in frame.itertuples(index=False)
    ]
    n = db.replace_rows(conn, "backtest.factor_returns", columns, rows)
    _log_run(conn, "factor_returns", started, n,
             detail={"last_date": str(max(r[0] for r in rows))})
    _say(f"factors: {n} days, last {max(r[0] for r in rows)}")


def _period(month: str) -> str:
    if month <= LAST_DEVELOPMENT:
        return "development"
    if month in EMBARGO:
        return "embargo"
    if month <= LAST_HOLDOUT:
        return "holdout"
    return "terminal"


def load_calendar(conn) -> None:
    """Last S&P trading day of each rebalance month, tagged with its period."""
    started = datetime.now(timezone.utc)
    days = db.query_df(
        conn,
        "select date from backtest.daily_prices where ticker = '^GSPC' "
        "and date >= %s order by date",
        (f"{FIRST_REBALANCE}-01",),
    )["date"]
    if days.empty:
        raise RuntimeError("No ^GSPC prices: load prices before the calendar.")

    month_ends = days.groupby(days.dt.to_period("M")).max()
    chosen = [
        d for p, d in month_ends.items()
        if p.month in REBALANCE_MONTHS
        and FIRST_REBALANCE <= str(p) <= TERMINAL
    ]
    if str(pd.Timestamp(chosen[-1]).to_period("M")) != TERMINAL:
        raise RuntimeError(f"Prices do not reach the terminal month {TERMINAL}.")

    rows = []
    for i, d in enumerate(chosen):
        nxt = chosen[i + 1].date() if i + 1 < len(chosen) else None
        rows.append((d.date(), _period(str(d.to_period("M"))), nxt))

    n = db.replace_rows(
        conn, "backtest.rebalance_dates", ["rebalance_date", "period", "next_date"],
        rows,
    )
    _log_run(conn, "rebalance_dates", started, n)
    counts = pd.Series([r[1] for r in rows]).value_counts().to_dict()
    _say(f"calendar: {n} dates {counts}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--only", help=f"comma-separated subset of {DATASETS}")
    parser.add_argument("--tickers", help="comma-separated tickers (prices/fundamentals)")
    parser.add_argument("--report", action="store_true", help="quality report only")
    args = parser.parse_args(argv)

    with db.connect() as conn:
        if args.report:
            report.print_report(conn)
            return 0

        datasets = args.only.split(",") if args.only else list(DATASETS)
        unknown = set(datasets) - set(DATASETS)
        if unknown:
            parser.error(f"unknown datasets: {sorted(unknown)}")

        subset = bool(args.tickers)
        tickers = (
            [t.strip().upper() for t in args.tickers.split(",")]
            if subset else list(config.SP500_TICKERS)
        )

        started = time.monotonic()
        # Order matters only for the calendar, which reads ^GSPC prices.
        for dataset in DATASETS:
            if dataset not in datasets:
                continue
            t0 = time.monotonic()
            if dataset == "universe" and not subset:
                load_universe(conn, tickers)
            elif dataset == "prices":
                load_prices(conn, tickers, subset)
            elif dataset == "fundamentals":
                load_fundamentals(conn, tickers, subset)
            elif dataset == "factors" and not subset:
                load_factors(conn)
            elif dataset == "calendar" and not subset:
                load_calendar(conn)
            _say(f"  ({dataset} took {time.monotonic() - t0:.0f}s)")

        _say(f"done in {time.monotonic() - started:.0f}s\n")
        if not subset:
            report.print_report(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
