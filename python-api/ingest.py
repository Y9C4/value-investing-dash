"""Extract and load: provider rows into the `raw` schema, untouched.

The E and L of the warehouse (python-api/notebooks/backtests.md §17). Nothing
here derives a number. Statements are stored as long line items exactly as
yfinance labels them, prices as both closes Yahoo publishes, and every
transformation — pivots, trailing twelve months, betas, valuations, the signal —
happens in SQL when `warehouse.refresh()` runs.

Every write is an upsert, so a rerun is safe and history accumulates past the
four years of statements yfinance returns at any one time.

Three stages, each returning the shape `job_runs` records:

    prices()        daily bars, dividends and splits      (daily, incremental)
    factor_returns() Fama-French daily factors            (daily)
    fundamentals()  statements, share counts, earnings, profiles  (weekly)
"""

from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import yfinance as yf

import config
import dw
import factors

# History depth for a ticker seen for the first time, and for a ticker whose
# adjusted history Yahoo has just restated. 2015 matches the backtest dataset.
PRICE_START = "2015-01-01"
SHARES_START = "2015-01-01"
# Re-fetch a few sessions past each ticker's own newest bar: the last session
# can be partial, and a same-day run would otherwise store an unsettled close.
INCREMENTAL_OVERLAP_DAYS = 5

# Not constituents: the benchmark, the 10-year yield the models discount at, and
# the 13-week bill the optimiser's Sharpe ratio uses.
EXTRA_PRICE_TICKERS = [
    config.SP500_INDEX_TICKER,
    config.LONG_RISK_FREE_TICKER,
    config.RISK_FREE_TICKER,
]

# 8 workers sustained ~0.4 s/ticker against Yahoo with no throttling.
MAX_WORKERS = 8
FETCH_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2.0
PRICE_CHUNK_SIZE = 50
# Yahoo pages earnings dates; 40 reaches back about ten years.
EARNINGS_DATES_LIMIT = 40


def _result(
    started: float,
    *,
    requested: int,
    failed: list[str],
    rows_fetched: int,
    rows_upserted: int,
    errors: list[str],
) -> dict:
    """The shape every stage returns, so job_runs and the data page read one format."""
    return {
        "tickers_requested": requested,
        "tickers_succeeded": requested - len(failed),
        "tickers_failed": failed,
        "rows_fetched": rows_fetched,
        "rows_upserted": rows_upserted,
        "duration_seconds": round(time.monotonic() - started, 1),
        "errors": errors,
    }


def _finite(value) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) or math.isinf(result) else result


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


# ---------------------------------------------------------------------------
# Prices, dividends, splits
# ---------------------------------------------------------------------------


def _download(chunk: list[str], start: str) -> pd.DataFrame:
    last: Exception | None = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            return yf.download(
                tickers=chunk,
                start=start,
                interval="1d",
                group_by="ticker",
                # Both closes: split-adjusted for market caps, dividend-adjusted
                # for returns. actions=True brings dividends and splits along.
                auto_adjust=False,
                actions=True,
                threads=True,
                progress=False,
            )
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            last = exc
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    raise RuntimeError(f"download failed: {last}")


def _bars(ticker: str, frame: pd.DataFrame) -> tuple[list, list, list]:
    """Price, dividend and split rows for one ticker's slice of a download."""
    frame = frame.dropna(subset=["Close"])
    prices, dividends, splits = [], [], []
    close = frame["Close"]
    # Indices publish no separate adjusted series.
    adj = frame["Adj Close"].fillna(close) if "Adj Close" in frame else close
    volume = frame["Volume"] if "Volume" in frame else pd.Series(index=frame.index, dtype=float)
    days = frame.index.date

    for day, c, a, v in zip(days, close, adj, volume):
        prices.append((ticker, day, float(c), float(a), _finite(v)))
    if "Dividends" in frame:
        for day, amount in zip(days, frame["Dividends"]):
            value = _finite(amount)
            if value and value > 0:
                dividends.append((ticker, day, value))
    if "Stock Splits" in frame:
        for day, ratio in zip(days, frame["Stock Splits"]):
            value = _finite(ratio)
            if value and value > 0:
                splits.append((ticker, day, value))
    return prices, dividends, splits


def _slice(data: pd.DataFrame, ticker: str) -> pd.DataFrame:
    return data[ticker] if isinstance(data.columns, pd.MultiIndex) else data


def prices(full: bool = False) -> dict:
    """Daily bars since each ticker's own newest stored date.

    Anchored per ticker, not to the table's global newest date. The old
    backfill fetched one window for everyone, so a ticker that failed once sat
    outside every later window and stayed gapped for good (^IRX, Sep 2026).

    A new dividend or split inside the window means Yahoo has rescaled that
    ticker's whole adjusted history (a split rescales the closes too), so the
    stored rows are no longer in the same basis as the new ones. Those tickers
    are re-pulled in full; on a normal day that is a handful of names.
    """
    started = time.monotonic()
    tickers = [*config.SP500_TICKERS, *EXTRA_PRICE_TICKERS]
    failed: list[str] = []
    errors: list[str] = []

    with dw.connect() as conn:
        newest = dict(dw.query(conn, "select ticker, max(date) from raw.daily_prices group by ticker"))
        recent = date.today() - timedelta(days=60)
        known_actions = {
            (t, d)
            for t, d in dw.query(
                conn,
                "select ticker, ex_date from raw.dividends where ex_date >= %s"
                " union all select ticker, date from raw.splits where date >= %s",
                (recent, recent),
            )
        }

    windows: dict[str, list[str]] = {}
    for ticker in tickers:
        if full or ticker not in newest:
            start = PRICE_START
        else:
            start = (newest[ticker] - timedelta(days=INCREMENTAL_OVERLAP_DAYS)).isoformat()
        windows.setdefault(start, []).append(ticker)

    price_rows: list[tuple] = []
    dividend_rows: list[tuple] = []
    split_rows: list[tuple] = []
    restated: set[str] = set()

    def collect(chunk: list[str], start: str, *, incremental: bool) -> None:
        try:
            data = _download(chunk, start)
        except Exception as exc:  # noqa: BLE001 - report and continue
            failed.extend(chunk)
            errors.append(f"{chunk[0]}..{chunk[-1]}: {exc}")
            return

        for ticker in chunk:
            try:
                bars, dividends, splits = _bars(ticker, _slice(data, ticker))
            except Exception as exc:  # noqa: BLE001 - report and continue
                failed.append(ticker)
                errors.append(f"{ticker}: {type(exc).__name__}: {exc}")
                continue

            # Empty is normal on an incremental run: nothing new has traded.
            if not bars:
                if not incremental:
                    failed.append(ticker)
                    errors.append(f"{ticker}: no data returned")
                continue

            new_actions = [
                (t, d) for t, d, _ in (*dividends, *splits) if (t, d) not in known_actions
            ]
            if incremental and new_actions:
                restated.add(ticker)
                continue

            price_rows.extend(bars)
            dividend_rows.extend(dividends)
            split_rows.extend(splits)

    for start, members in windows.items():
        for chunk in _chunks(members, PRICE_CHUNK_SIZE):
            collect(chunk, start, incremental=start != PRICE_START)

    for chunk in _chunks(sorted(restated), PRICE_CHUNK_SIZE):
        collect(chunk, PRICE_START, incremental=False)
    if restated:
        errors.append("re-pulled in full after a dividend or split: " + ", ".join(sorted(restated)))

    with dw.connect() as conn:
        upserted = dw.upsert(
            conn, "raw.daily_prices", ["ticker", "date", "close", "adj_close", "volume"],
            ["ticker", "date"], price_rows,
        )
        dw.upsert(conn, "raw.dividends", ["ticker", "ex_date", "amount"], ["ticker", "ex_date"], dividend_rows)
        dw.upsert(conn, "raw.splits", ["ticker", "date", "ratio"], ["ticker", "date"], split_rows)

    return _result(
        started,
        requested=len(tickers),
        failed=sorted(set(failed)),
        rows_fetched=len(price_rows),
        rows_upserted=upserted,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Factors
# ---------------------------------------------------------------------------


def factor_returns() -> dict:
    """The whole Fama-French daily history, upserted.

    One ~150KB download either way, and the library revises past values, so the
    full series is reloaded rather than only the dates after the newest stored.
    """
    started = time.monotonic()
    try:
        frame = factors.fetch_factor_returns()
    except Exception as exc:  # noqa: BLE001 - report and continue
        return _result(started, requested=1, failed=["fama-french"], rows_fetched=0,
                       rows_upserted=0, errors=[f"factor download/parse: {exc}"])

    columns = ["date", "mkt_rf", "smb", "hml", "rmw", "cma", "umd", "rf"]
    rows = [
        (r.date.date(), *(_finite(getattr(r, c)) for c in columns[1:]))
        for r in frame.itertuples(index=False)
    ]
    with dw.connect() as conn:
        upserted = dw.upsert(conn, "raw.factor_returns", columns, ["date"], rows)

    return _result(started, requested=1, failed=[], rows_fetched=len(rows),
                   rows_upserted=upserted, errors=[])


# ---------------------------------------------------------------------------
# Statements, share counts, earnings, profiles
# ---------------------------------------------------------------------------


def _statement_rows(symbol: str, frequency: str, statement: str, frame, fetched_at) -> dict:
    """Melt one statement frame (items x period ends) to long rows, keyed so a
    duplicated item label cannot break the primary key."""
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
            out.setdefault(key, (symbol, frequency, statement, period_end, str(item), v, fetched_at))
    return out


def _fetch_company(symbol: str) -> dict:
    """Everything per company from one yf.Ticker. Statements are required and
    retried (an empty pull is how Yahoo throttling shows up); the profile,
    share history and earnings dates fail soft."""
    fetched_at = datetime.now(timezone.utc)
    result = {"ticker": symbol, "items": [], "shares": [], "earnings": [],
              "profile": None, "error": None, "warnings": []}

    ticker = None
    for attempt in range(FETCH_ATTEMPTS):
        try:
            ticker = yf.Ticker(symbol)
            items: dict = {}
            for frequency, frames in (
                ("annual", (("income", ticker.income_stmt), ("balance", ticker.balance_sheet),
                            ("cashflow", ticker.cashflow))),
                ("quarterly", (("income", ticker.quarterly_income_stmt),
                               ("balance", ticker.quarterly_balance_sheet),
                               ("cashflow", ticker.quarterly_cashflow))),
            ):
                for statement, frame in frames:
                    items.update(_statement_rows(symbol, frequency, statement, frame, fetched_at))
            if not any(key[0] == "annual" for key in items):
                raise RuntimeError("no annual statements returned")
            result["items"] = list(items.values())
            result["error"] = None
            break
        except Exception as exc:  # noqa: BLE001 - retried, then reported
            result["error"] = f"{type(exc).__name__}: {exc}"
            time.sleep(RETRY_BACKOFF_SECONDS * (2**attempt))
    if result["error"] or ticker is None:
        return result

    try:
        info = ticker.info or {}
        result["profile"] = (
            symbol,
            info.get("longName") or info.get("shortName"),
            info.get("sector"),
            info.get("industry"),
            info.get("currency"),
            True,
            fetched_at,
        )
    except Exception as exc:  # noqa: BLE001
        result["warnings"].append(f"profile: {exc}")

    try:
        shares = ticker.get_shares_full(start=SHARES_START)
        if shares is not None and len(shares):
            series = shares[shares > 0]
            series.index = [pd.Timestamp(i).date() for i in series.index]
            # Several filings can land on one day; the last is the latest word.
            series = series.groupby(level=0).last()
            result["shares"] = [(symbol, d, float(v)) for d, v in series.items()]
    except Exception as exc:  # noqa: BLE001
        result["warnings"].append(f"shares: {exc}")

    try:
        earnings = ticker.get_earnings_dates(limit=EARNINGS_DATES_LIMIT)
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


def fundamentals(tickers: list[str] | None = None) -> dict:
    """Statements, share counts, earnings dates and profiles for the universe.

    Threaded: serially ~28 minutes, at 8 workers a few. A ticker that fails
    keeps whatever an earlier pull stored, since nothing here deletes.
    """
    started = time.monotonic()
    universe = tickers or config.SP500_TICKERS
    items: list[tuple] = []
    shares: list[tuple] = []
    earnings: list[tuple] = []
    profiles: list[tuple] = []
    failed: list[str] = []
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        for res in pool.map(_fetch_company, universe):
            if res["error"]:
                failed.append(res["ticker"])
                errors.append(f"{res['ticker']}: {res['error']}")
                continue
            items.extend(res["items"])
            shares.extend(res["shares"])
            earnings.extend(res["earnings"])
            if res["profile"]:
                profiles.append(res["profile"])
            if res["warnings"]:
                errors.append(f"{res['ticker']}: " + "; ".join(res["warnings"]))

    with dw.connect() as conn:
        upserted = dw.upsert(
            conn, "raw.statement_items",
            ["ticker", "frequency", "statement", "period_end", "item", "value", "fetched_at"],
            ["ticker", "frequency", "statement", "period_end", "item"], items,
        )
        upserted += dw.upsert(conn, "raw.shares_outstanding", ["ticker", "date", "shares"],
                              ["ticker", "date"], shares)
        upserted += dw.upsert(conn, "raw.earnings",
                              ["ticker", "report_date", "eps_estimate", "reported_eps"],
                              ["ticker", "report_date"], earnings)
        upserted += dw.upsert(conn, "raw.company_profile",
                              ["ticker", "name", "sector", "industry", "currency", "in_universe", "fetched_at"],
                              ["ticker"], profiles)
        # Membership follows the ticker list on a full pull, so a company that
        # leaves the index keeps its history and drops off the screener.
        if tickers is None:
            with conn.cursor() as cur:
                cur.execute(
                    "update raw.company_profile set in_universe = (ticker = any(%s))",
                    (list(config.SP500_TICKERS),),
                )
            conn.commit()

    return _result(
        started,
        requested=len(universe),
        failed=failed,
        rows_fetched=len(items) + len(shares) + len(earnings) + len(profiles),
        rows_upserted=upserted,
        errors=errors,
    )
