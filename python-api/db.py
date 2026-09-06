"""Supabase access layer: one client, one retry policy, and the paging and
batching every caller would otherwise repeat."""

from __future__ import annotations

import time
from typing import Any, Callable, Iterator

from fastapi import HTTPException
from supabase import Client, create_client

import config

# The pooled session drops the occasional connection, both under concurrency
# and simply from age. Retrying costs a moment; not retrying cost a 500.
READ_ATTEMPTS = 4
READ_BACKOFF_SECONDS = 0.25

_client: Client | None = None
if config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY:
    _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)


def client() -> Client:
    if _client is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY in api/.env."
            ),
        )
    return _client


def read(build: Callable[[Client], Any]) -> Any:
    """Run one Supabase read, retrying a dropped connection.

    PostgREST retires a pooled HTTP/2 connection with GOAWAY after a few
    hundred streams, killing whatever request is in flight. The trigger is the
    connection's age rather than the query, so the failures looked random.
    Every caller here is a read, so re-running one is free of side effects.
    """
    for attempt in range(READ_ATTEMPTS):
        try:
            return build(client())
        except HTTPException:
            # A deliberate 404 from inside the query is an answer, not a fault.
            raise
        except Exception:  # noqa: BLE001 - see docstring
            if attempt == READ_ATTEMPTS - 1:
                raise
            time.sleep(READ_BACKOFF_SECONDS * (2**attempt))
    return None


def chunk(items: list, size: int) -> Iterator[list]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def fetch_all_rows(table: str, columns: str) -> list[dict]:
    """Every row of `table`, paged to exhaustion."""
    rows: list[dict] = []
    start = 0

    while True:
        page = read(
            lambda db, start=start: db.table(table)
            .select(columns)
            .range(start, start + config.SELECT_PAGE_SIZE - 1)
            .execute()
        ).data
        rows.extend(page)
        if len(page) < config.SELECT_PAGE_SIZE:
            break
        start += config.SELECT_PAGE_SIZE

    return rows


def latest_stored_date(table: str, column: str = "date") -> str | None:
    """The newest value of `column`, or None when the table is empty.

    This is what makes the backfills incremental: each asks what it already has
    and fetches only the gap, so a run after a five-day outage catches up with
    no special casing.
    """
    res = read(
        lambda db: db.table(table)
        .select(column)
        .order(column, desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0][column] if res.data else None


def earliest_stored_date(table: str, column: str = "date") -> str | None:
    """The oldest value of `column`, or None when the table is empty."""
    res = read(
        lambda db: db.table(table).select(column).order(column).limit(1).execute()
    )
    return res.data[0][column] if res.data else None


def upsert_rows(
    table: str,
    rows: list[dict],
    on_conflict: str,
    errors: list[str],
    *,
    ignore_duplicates: bool = True,
) -> int:
    """Upsert `rows` in batches, collecting failures rather than raising.

    `ignore_duplicates` must be False for rows that change in place (a company
    profile) or get restated (a quarter). It stays True for immutable facts
    like a paid dividend.
    """
    supabase = client()
    upserted = 0

    for batch in chunk(rows, config.UPSERT_CHUNK_SIZE):
        try:
            supabase.table(table).upsert(
                batch, on_conflict=on_conflict, ignore_duplicates=ignore_duplicates
            ).execute()
            upserted += len(batch)
        except Exception as exc:  # noqa: BLE001 - report and continue
            errors.append(f"{table} upsert at row {upserted}: {exc}")

    return upserted
