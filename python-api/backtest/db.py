"""A direct Postgres connection to the local Supabase database.

Direct rather than through PostgREST like the service: the loader writes ~1.5M
rows and Stage 1 reads them back whole, which over a REST API capped at 1000
rows a page is thousands of round trips. COPY does it in one.
"""

from __future__ import annotations

import os
from urllib.parse import urlparse

import pandas as pd
import psycopg

LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


def database_url() -> str:
    """The backtest database, refusing anything but a local one by default.

    The loader truncates tables. Pointed at the cloud project by a stray
    environment variable, that is not a mistake to discover afterwards.
    """
    url = os.environ.get("BACKTEST_DATABASE_URL", LOCAL_DATABASE_URL)
    host = urlparse(url).hostname
    if host not in LOCAL_HOSTS and os.environ.get("BACKTEST_ALLOW_REMOTE") != "1":
        raise RuntimeError(
            f"BACKTEST_DATABASE_URL points at {host}, not a local database. "
            "Set BACKTEST_ALLOW_REMOTE=1 if that is really intended."
        )
    return url


def connect() -> psycopg.Connection:
    return psycopg.connect(database_url())


def query_df(
    conn: psycopg.Connection, sql: str, params: tuple | dict | None = None
) -> pd.DataFrame:
    """Run a query and return a DataFrame, with dates as Timestamps."""
    with conn.cursor() as cur:
        cur.execute(sql, params)
        columns = [col.name for col in cur.description]
        frame = pd.DataFrame(cur.fetchall(), columns=columns)

    for column in frame.columns:
        if column in ("date", "period_end", "available_from", "rebalance_date",
                      "next_date", "report_date"):
            frame[column] = pd.to_datetime(frame[column])
    return frame


def replace_rows(
    conn: psycopg.Connection,
    table: str,
    columns: list[str],
    rows: list[tuple],
    tickers: list[str] | None = None,
) -> int:
    """Replace a table's contents (or just some tickers') in one transaction.

    Replace rather than upsert because yfinance restates: a line item that
    disappeared from the source must disappear here too, or the dataset becomes
    a mix of two different pulls.
    """
    with conn.transaction(), conn.cursor() as cur:
        if tickers is None:
            cur.execute(f"truncate {table}")
        else:
            cur.execute(f"delete from {table} where ticker = any(%s)", (tickers,))
        with cur.copy(f"copy {table} ({', '.join(columns)}) from stdin") as copy:
            for row in rows:
                copy.write_row(row)
    return len(rows)
