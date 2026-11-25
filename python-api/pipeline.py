"""The scheduled pipeline: extract and load, then let the warehouse transform.

Replaces backfill.py. The stages, in dependency order:

    prices          ingest.prices          raw.daily_prices, dividends, splits
    factor_returns  ingest.factor_returns  raw.factor_returns
    fundamentals    ingest.fundamentals    raw.statement_items, shares, earnings, profiles
    refresh         warehouse.refresh()    every derived number, then the frontier snapshot

Each stage is recorded in public.job_runs, which is what the site's freshness
strip reads. The refresh does in SQL, in a few seconds, what the old
valuations stage did in Python after a minute of bulk reads.
"""

from __future__ import annotations

import logging
import time
from typing import Callable

import dw
import frontier
import ingest
import jobs
import market

log = logging.getLogger("uvicorn.error")


def _recorded(job: str, run: Callable[[], dict]) -> dict:
    """Run one stage and log it to job_runs, including a stage that raised."""
    started = time.monotonic()
    try:
        res = run()
    except Exception as exc:  # noqa: BLE001 - recorded, then reported
        # The full message stays in the service log. What is returned and stored
        # is read by the browser (job_runs is anon-readable), and a database or
        # provider error can name hosts or SQL.
        log.exception("stage %s raised", job)
        name = type(exc).__name__
        res = {
            "detail": name,
            "rows_upserted": 0,
            "errors": [name],
            "duration_seconds": round(time.monotonic() - started, 1),
        }
    # Ingest stages report trouble as `tickers_failed` and `errors` rather than
    # by raising, so "failed" has to come from the same rule job_runs uses.
    # Otherwise a run that saved nothing is recorded as failed and reported ok.
    res["failed"] = jobs.status_of(res) == "failed"
    jobs.record(job, res)
    return res


def prices(full: bool = False) -> dict:
    return _recorded(jobs.PRICES, lambda: ingest.prices(full=full))


def factor_returns() -> dict:
    return _recorded(jobs.FACTORS, ingest.factor_returns)


def fundamentals() -> dict:
    return _recorded(jobs.FUNDAMENTALS, ingest.fundamentals)


def _refresh_warehouse() -> dict:
    started = time.monotonic()
    with dw.connect() as conn:
        summary = dw.refresh(conn)
    stocks = summary.get("stocks") or 0
    return {
        **summary,
        "tickers_requested": stocks,
        "tickers_succeeded": stocks,
        "tickers_failed": [],
        "rows_fetched": 0,
        "rows_upserted": stocks,
        "duration_seconds": round(time.monotonic() - started, 1),
        "errors": [],
    }


def refresh() -> dict:
    """Rebuild the warehouse, then re-solve the default frontier over it.

    The caches are cleared between the two: the optimiser reads closes and the
    cash rate through the serving layer, and a cached copy would solve
    yesterday's prices.
    """
    res = _recorded(jobs.REFRESH, _refresh_warehouse)
    if res.get("failed"):
        return res

    market.clear_price_cache()
    frontier.clear_solve_cache()
    return {**res, "frontier_snapshot": frontier.precompute_default()}


def everything(full: bool = False, skip_fundamentals: bool = False) -> dict:
    """Every stage in dependency order. `skip_fundamentals` is the daily shape:
    statements change quarterly, prices every session.

    A failed stage does not stop the ones after it, except that the refresh is
    skipped when every feeder failed: it would rebuild the same numbers from
    the same rows.
    """
    started = time.monotonic()
    stages: list[tuple[str, Callable[[], dict]]] = [
        (jobs.PRICES, lambda: prices(full=full)),
        (jobs.FACTORS, factor_returns),
    ]
    if not skip_fundamentals:
        stages.append((jobs.FUNDAMENTALS, fundamentals))

    results: dict[str, dict] = {}
    for name, run in stages:
        results[name] = run()

    if all(item.get("failed") for item in results.values()):
        results[jobs.REFRESH] = {
            "skipped": True,
            "detail": "Every upstream stage failed; a refresh would rebuild the same numbers.",
        }
    else:
        results[jobs.REFRESH] = refresh()

    failed = [name for name, item in results.items() if item.get("failed")]
    return {
        "ok": not failed,
        "failed_stages": failed,
        "duration_seconds": round(time.monotonic() - started, 1),
        "stages": results,
    }
