"""Recording what the scheduled ingest jobs did, and when.

The dashboard needs to state when its data was *gathered*, which is not the
same question as when the models last ran. Valuations recompute in eight
seconds over whatever the feeder tables happen to hold, so a fresh
`computed_at` on the universe snapshot is compatible with prices a fortnight
old — precisely the state a freshness indicator exists to reveal.

Only the ingest stages are recorded. The default-frontier precompute at the
tail of a valuations run is a derived solve over data these rows already
cover, so recording it would put the newest timestamp in the table on the one
job that fetched nothing.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import db

# The stages, matching the check constraint in migration 20260904010000.
PRICES = "daily_close_prices"
FACTORS = "factor_returns"
FUNDAMENTALS = "quarterly_fundamentals"
PROFILE = "company_profile"
VALUATIONS = "valuations"

# Anything longer than this in `errors` is a stack trace's worth of noise in a
# column meant to be read at a glance.
MAX_DETAIL_ERRORS = 20


def status_of(res: dict) -> str:
    """Three states, because the backfills are deliberately partial-tolerant.

    A run that lost eleven tickers out of 493 still refreshed the table and is
    not a failure — but calling it a success hides a provider outage eating a
    slice of the universe every night. Only a run that saved nothing counts as
    failed.
    """
    failed = res.get("tickers_failed") or []
    if res.get("rows_upserted", 0) == 0 and (failed or res.get("errors")):
        return "failed"
    if failed or res.get("errors"):
        return "partial"
    return "succeeded"


def record(job: str, res: dict) -> None:
    """Write one run to `job_runs`. Never raises.

    A bookkeeping row must not be able to fail a backfill that has already
    written its data — the ingest is the product, this is the label on it.
    """
    try:
        finished = datetime.now(timezone.utc)
        duration = float(res.get("duration_seconds") or 0)
        errors = res.get("errors") or []
        failed = res.get("tickers_failed") or []

        db.client().table("job_runs").insert(
            {
                "job": job,
                "status": status_of(res),
                # Derived rather than threaded through every stage: the stages
                # time themselves on a monotonic clock, which has no wall-clock
                # origin to report.
                "started_at": (finished - timedelta(seconds=duration)).isoformat(),
                "finished_at": finished.isoformat(),
                "duration_seconds": round(duration, 1),
                "rows_upserted": res.get("rows_upserted"),
                "tickers_failed": len(failed),
                "detail": {
                    "tickers_requested": res.get("tickers_requested"),
                    "rows_fetched": res.get("rows_fetched"),
                    "failed": failed[:MAX_DETAIL_ERRORS],
                    "errors": errors[:MAX_DETAIL_ERRORS],
                },
            }
        ).execute()
    except Exception:  # noqa: BLE001 - see docstring
        pass


def latest() -> dict[str, dict]:
    """The most recent run of each stage, keyed by job.

    Baked into the universe snapshot so the front end gets freshness for free
    on a payload it already reads. Empty on any failure: a missing freshness
    block hides one strip of chrome, and must never take the screener with it.
    """
    try:
        rows = db.read(
            lambda client: client.table("latest_job_runs")
            .select("job, status, finished_at, duration_seconds, rows_upserted")
            .execute()
        ).data
    except Exception:  # noqa: BLE001 - chrome, not data
        return {}

    return {
        row["job"]: {
            "status": row["status"],
            "finishedAt": row["finished_at"],
            "durationSeconds": (
                float(row["duration_seconds"])
                if row.get("duration_seconds") is not None
                else None
            ),
            "rowsUpserted": row.get("rows_upserted"),
        }
        for row in rows or []
    }
