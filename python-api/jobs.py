"""Recording what the scheduled ingest jobs did, and when.

The dashboard needs to state when its data was *gathered*, which is not the
same question as when the models last ran. Valuations recompute in eight
seconds over whatever the feeder tables happen to hold, so a fresh
`computed_at` on the universe snapshot is compatible with prices a fortnight
old — precisely the state a freshness indicator exists to reveal.

The three ingest stages and the warehouse refresh are recorded. The site
treats the newest ingest as "when data was gathered" and leaves the refresh
out of that, since it fetches nothing. The default-frontier precompute at the
end of a refresh is not recorded at all.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import db

# The pipeline's stages, matching the check constraint in migration
# 20261117000002. The refresh is recorded even though it fetches nothing: it is
# what turns the fetched rows into the numbers the site shows.
PRICES = "prices"
FACTORS = "factor_returns"
FUNDAMENTALS = "fundamentals"
REFRESH = "refresh"

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
