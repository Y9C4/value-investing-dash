"""The backfill jobs, in the order they depend on each other.

Every stage is incremental — it asks what it already has and fetches only the
gap — and every write is an upsert, so re-running is safe and cheap. Valuations
read the three tables above them, so they always run last.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Callable

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

import config
import db
import engine
import factors
import fundamentals
import market

# Re-fetch a few days past the newest stored row: the last session can be
# partial, and a same-day run would otherwise store an unsettled close.
INCREMENTAL_OVERLAP_DAYS = 5
# yfinance is an unofficial API and will rate-limit. Probing showed 8 workers
# sustained ~0.43 s/ticker with no failures across the full universe.
FUNDAMENTALS_MAX_WORKERS = 8


def result(
    started: float,
    *,
    requested: int,
    failed: list[str],
    rows_fetched: int,
    rows_upserted: int,
    errors: list[str],
) -> dict:
    """The shape every backfill returns, so one client component renders all."""
    return {
        "tickers_requested": requested,
        "tickers_succeeded": requested - len(failed),
        "tickers_failed": failed,
        "rows_fetched": rows_fetched,
        "rows_upserted": rows_upserted,
        "duration_seconds": round(time.monotonic() - started, 1),
        "errors": errors,
    }


def factor_returns() -> dict:
    """Fama-French daily factors (FF5 + momentum).

    Cheap enough to re-run freely: one ~150KB download. Counted as a single
    "ticker" so the result matches the ticker-oriented backfills.
    """
    started = time.monotonic()
    errors: list[str] = []

    latest = db.latest_stored_date("factor_returns")
    try:
        rows = factors.factor_rows_since(latest)
    except Exception as exc:  # noqa: BLE001 - report and continue
        return result(
            started,
            requested=1,
            failed=["fama-french"],
            rows_fetched=0,
            rows_upserted=0,
            errors=[f"factor download/parse: {exc}"],
        )

    upserted = db.upsert_rows(
        "factor_returns", rows, "date", errors, ignore_duplicates=False
    )
    return result(
        started,
        requested=1,
        failed=[],
        rows_fetched=len(rows),
        rows_upserted=upserted,
        errors=errors,
    )


def _close_rows(ticker: str, frame) -> list[dict]:
    series = frame["Close"].dropna()
    return [
        {"date": idx.date().isoformat(), "ticker": ticker, "close": float(value)}
        for idx, value in series.items()
    ]


def _needing_full_history(candidates: list[str]) -> set[str]:
    """Tickers that must be fetched over the whole window, not just the gap.

    The incremental window comes from one global newest-date, which is right
    for a ticker tracked all along and wrong for one that is not: a name added
    to sp500_tickers.json later starts from "five days ago", lands a handful of
    rows, and from then on looks up to date — accruing history one day at a
    time and never filling in the two years behind it.

    The test is one query: whoever traded on the earliest date the table holds
    is fully tracked. A genuinely recent listing is re-fetched harmlessly.
    """
    earliest = db.earliest_stored_date("daily_close_prices")
    if earliest is None:
        return set(candidates)

    present = {
        row["ticker"]
        for row in db.read(
            lambda client: client.table("daily_close_prices")
            .select("ticker")
            .eq("date", earliest)
            .execute()
        ).data
    }
    return {ticker for ticker in candidates if ticker not in present}


def daily_close(full: bool = False) -> dict:
    """Daily closes for the S&P 500 plus the index and risk-free series.

    Incremental: only the span since the newest stored date is fetched, ~24s
    against the ~4min a full two-year refresh takes. An empty table falls back
    to the full window, as does any ticker not yet fully tracked.
    """
    started = time.monotonic()

    all_tickers = [
        *config.SP500_TICKERS,
        config.SP500_INDEX_TICKER,
        config.RISK_FREE_TICKER,
    ]
    rows: list[dict] = []
    failed: list[str] = []
    errors: list[str] = []

    latest = db.latest_stored_date("daily_close_prices")
    fetch_start = (
        date.fromisoformat(latest) - timedelta(days=INCREMENTAL_OVERLAP_DAYS)
        if latest and not full
        else None
    )

    cold_tickers = (
        set(all_tickers) if fetch_start is None else _needing_full_history(all_tickers)
    )
    if cold_tickers and fetch_start is not None:
        errors.append(
            "full-window backfill for untracked tickers: "
            + ", ".join(sorted(cold_tickers))
        )

    incremental = [t for t in all_tickers if t not in cold_tickers]

    passes: list[tuple[list[str], dict]] = []
    if incremental:
        passes.append((incremental, {"start": fetch_start.isoformat()}))
    if cold_tickers:
        passes.append(
            (sorted(cold_tickers), {"period": market.PRICE_HISTORY_PERIOD})
        )

    for pass_tickers, window in passes:
        cold = "period" in window
        for chunk in db.chunk(pass_tickers, config.FETCH_CHUNK_SIZE):
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
                failed.extend(chunk)
                errors.append(f"chunk {chunk[0]}..{chunk[-1]}: {exc}")
                continue

            for ticker in chunk:
                try:
                    frame = data[ticker] if len(chunk) > 1 else data
                    ticker_rows = _close_rows(ticker, frame)
                except Exception as exc:  # noqa: BLE001 - report and continue
                    failed.append(ticker)
                    errors.append(f"{ticker}: {exc}")
                    continue

                # On an incremental run an empty frame is the normal case: it
                # means nothing new has traded. Only a cold fetch counts it.
                if not ticker_rows:
                    if cold:
                        failed.append(ticker)
                        errors.append(f"{ticker}: no data returned")
                    continue

                rows.extend(ticker_rows)

    upserted = db.upsert_rows("daily_close_prices", rows, "date,ticker", errors)
    market.clear_price_cache()

    return result(
        started,
        requested=len(all_tickers),
        failed=failed,
        rows_fetched=len(rows),
        rows_upserted=upserted,
        errors=errors,
    )


def company_fundamentals(profile_only: bool) -> dict:
    """Statements, profile and dividends in one pass.

    `.info`, the three statements and `.dividends` all come off a single
    `yf.Ticker`, so splitting them would triple the network work. Threading is
    what makes this practical: serially ~28 minutes, at 8 workers ~3.6.
    """
    started = time.monotonic()
    failed: list[str] = []
    errors: list[str] = []

    quarter_rows: list[dict] = []
    profile_rows: list[dict] = []
    dividend_rows: list[dict] = []

    with ThreadPoolExecutor(max_workers=FUNDAMENTALS_MAX_WORKERS) as executor:
        results = executor.map(
            fundamentals.fetch_ticker_fundamentals, config.SP500_TICKERS
        )
        for item in results:
            if item["error"]:
                failed.append(item["ticker"])
                errors.append(f"{item['ticker']}: {item['error']}")
                continue

            if item["profile"]:
                profile_rows.append(item["profile"])

            if not profile_only:
                quarter_rows.extend(item["quarters"])
                dividend_rows.extend(item["dividends"])

    # Profiles are snapshots that change in place, so they overwrite.
    upserted = db.upsert_rows(
        "company_profile", profile_rows, "ticker", errors, ignore_duplicates=False
    )

    if not profile_only:
        # Quarters get restated, so these overwrite too.
        upserted += db.upsert_rows(
            "quarterly_fundamentals",
            quarter_rows,
            "ticker,period_end",
            errors,
            ignore_duplicates=False,
        )
        # A paid dividend never changes.
        upserted += db.upsert_rows(
            "dividend_history", dividend_rows, "ticker,ex_date", errors
        )

    return result(
        started,
        requested=len(config.SP500_TICKERS),
        failed=failed,
        rows_fetched=len(profile_rows) + len(quarter_rows) + len(dividend_rows),
        rows_upserted=upserted,
        errors=errors,
    )


def _factor_frame() -> pd.DataFrame:
    rows = db.fetch_all_rows(
        "factor_returns", "date, mkt_rf, smb, hml, rmw, cma, umd, rf"
    )
    if not rows:
        raise HTTPException(
            status_code=404, detail="No factor data. Run /backfill/factor-returns first."
        )

    frame = pd.DataFrame(rows)
    frame["date"] = pd.to_datetime(frame["date"])
    for column in ("mkt_rf", "smb", "hml", "rmw", "cma", "umd", "rf"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def _dividends_by_ticker() -> dict[str, pd.DataFrame]:
    rows = db.fetch_all_rows("dividend_history", "ticker, ex_date, amount")
    if not rows:
        return {}

    frame = pd.DataFrame(rows)
    frame["ex_date"] = pd.to_datetime(frame["ex_date"])
    frame["amount"] = pd.to_numeric(frame["amount"])
    return {ticker: group for ticker, group in frame.groupby("ticker")}


def valuations() -> dict:
    """Recompute every model for every stock and replace the valuations table.

    The models cost ~0.08s for the whole universe; the bulk reads below are
    essentially the entire runtime. That asymmetry is why valuations are
    precomputed rather than served on demand.
    """
    started = time.monotonic()
    errors: list[str] = []

    prices = market.recent_prices_df()
    factor_frame = _factor_frame()

    ttm_rows = db.fetch_all_rows("ttm_fundamentals", "*")
    if not ttm_rows:
        raise HTTPException(
            status_code=404,
            detail="No fundamentals. Run /backfill/quarterly-fundamentals first.",
        )

    rows, unvalued, stats = engine.compute_universe(
        prices,
        factor_frame,
        {row["ticker"]: row for row in ttm_rows},
        {row["ticker"]: row for row in db.fetch_all_rows("company_profile", "*")},
        _dividends_by_ticker(),
        market.average_risk_free_rate(),
        config.SP500_INDEX_TICKER,
    )

    # A model that stopped applying must lose its row, so the table is cleared
    # rather than upserted into: a stale verdict would outlive the data that
    # justified it.
    try:
        db.client().table("valuations").delete().neq("ticker", "").execute()
    except Exception as exc:  # noqa: BLE001 - report and continue
        errors.append(f"clearing valuations: {exc}")

    # Statistics describe the window, not the models, so they are upserted in
    # place: a ticker no model could value still has a return and a volatility.
    db.upsert_rows("ticker_statistics", stats, "ticker", errors, ignore_duplicates=False)
    upserted = db.upsert_rows(
        "valuations", rows, "ticker,method", errors, ignore_duplicates=False
    )

    valued = len({row["ticker"] for row in rows})
    return {
        **result(
            started,
            requested=valued + len(unvalued),
            failed=unvalued,
            rows_fetched=len(rows),
            rows_upserted=upserted,
            errors=errors,
        ),
        "tickers_valued": valued,
        "verdicts_per_ticker": round(len(rows) / valued, 2) if valued else 0,
    }


def everything(full: bool = False, skip_fundamentals: bool = False) -> dict:
    """Every stage, in dependency order, in one call.

    The stages are separate buttons so a 20-second factor refresh need not drag
    an eight-minute fundamentals fetch behind it. That holds for routine upkeep
    and fails for bringing a stale database current, where running them by hand
    means knowing the order and remembering valuations go last.

    A failed stage does not stop the ones after it — the report says what
    happened to each — except that valuations are skipped when every feeder
    failed, since they would recompute the same numbers from the same tables.
    """
    started = time.monotonic()

    stages: list[tuple[str, Callable[[], dict]]] = [
        ("daily_close_prices", lambda: daily_close(full=full)),
        ("factor_returns", factor_returns),
    ]
    if not skip_fundamentals:
        # This pass already writes the profile and dividend tables too.
        stages.append(
            ("quarterly_fundamentals", lambda: company_fundamentals(profile_only=False))
        )

    results: dict[str, dict] = {}
    feeders_ok = 0

    for name, run in stages:
        try:
            results[name] = run()
            # Partial success still refreshes the table.
            feeders_ok += 1
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
            results["valuations"] = valuations()
        except HTTPException as exc:
            results["valuations"] = {"failed": True, "detail": str(exc.detail)}
        except Exception as exc:  # noqa: BLE001
            results["valuations"] = {
                "failed": True,
                "detail": f"{type(exc).__name__}: {exc}",
            }

    failed = [name for name, item in results.items() if item.get("failed")]
    return {
        "ok": not failed,
        "failed_stages": failed,
        "duration_seconds": round(time.monotonic() - started, 1),
        "stages": results,
    }
