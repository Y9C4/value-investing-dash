"""Direct Postgres access to the warehouse: bulk loads into `raw`, and the refresh.

Direct rather than through PostgREST, which the rest of the service uses for the
serving layer. Two reasons. `raw` and `warehouse` are deliberately not exposed
through the API, so PostgREST cannot reach them. And the load is bulk: COPY
moves a full price history in one round trip, where the REST upserts it
replaced took a request per 500 rows.

Locally this is the Supabase Postgres on :54322. In production DATABASE_URL is
the project's connection string.
"""

from __future__ import annotations

import os
from typing import Iterable, Sequence

import psycopg
from psycopg import sql

LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", LOCAL_DATABASE_URL)


def connect() -> psycopg.Connection:
    return psycopg.connect(database_url())


def upsert(
    conn: psycopg.Connection,
    table: str,
    columns: Sequence[str],
    key: Sequence[str],
    rows: Iterable[tuple],
) -> int:
    """Insert `rows` into `schema.table`, overwriting rows whose key exists.

    COPY into a temporary table first, then one INSERT ... ON CONFLICT: COPY
    cannot resolve conflicts itself, and the provider restates figures, so an
    existing row must be replaced rather than kept. DISTINCT ON is a guard: ON
    CONFLICT refuses to touch the same row twice in one statement, so a key
    repeated inside one batch would fail the whole load. Callers dedupe; which
    copy survives here is unspecified.
    """
    schema, name = table.split(".")
    target = sql.Identifier(schema, name)
    staging = sql.Identifier(f"staging_{name}")
    cols = sql.SQL(", ").join(map(sql.Identifier, columns))
    keys = sql.SQL(", ").join(map(sql.Identifier, key))
    updates = [c for c in columns if c not in key]

    with conn.cursor() as cur:
        cur.execute(
            sql.SQL(
                "create temporary table {staging} (like {target} including defaults)"
                " on commit drop"
            ).format(staging=staging, target=target)
        )
        with cur.copy(
            sql.SQL("copy {staging} ({cols}) from stdin").format(staging=staging, cols=cols)
        ) as copy:
            for row in rows:
                copy.write_row(row)

        conflict = (
            sql.SQL("do update set ")
            + sql.SQL(", ").join(
                sql.SQL("{c} = excluded.{c}").format(c=sql.Identifier(c)) for c in updates
            )
            if updates
            else sql.SQL("do nothing")
        )
        cur.execute(
            sql.SQL(
                "insert into {target} ({cols})"
                " select distinct on ({keys}) {cols} from {staging}"
                " on conflict ({keys}) "
            ).format(target=target, cols=cols, keys=keys, staging=staging)
            + conflict
        )
        written = cur.rowcount
    conn.commit()
    return written


def query(conn: psycopg.Connection, statement: str, params: tuple | None = None) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(statement, params)
        return cur.fetchall()


def fetch(statement: str, params: tuple | None = None) -> list[tuple]:
    """One read on its own short-lived connection, for the request-time paths.

    A connection per call: the pooled endpoint hands one out in milliseconds,
    and a long-lived one would have to survive Cloud Run idling the container.
    """
    with connect() as conn:
        return query(conn, statement, params)


def refresh(conn: psycopg.Connection) -> dict:
    """Rebuild the warehouse from `raw` and archive the day. See warehouse.refresh()."""
    with conn.cursor() as cur:
        cur.execute("select warehouse.refresh()")
        summary = cur.fetchone()[0]
    conn.commit()
    return summary
