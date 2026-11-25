"""Who is in the S&P 500, and where each member is listed.

`raw.company_profile.in_universe` is the record. The daily price job keeps it in
step with Wikipedia's constituent table (S&P's own list is licensed), and
overwrites `exchange` from Yahoo: both are type 1, with no history kept.
data/sp500_tickers.json only seeds an empty database.
"""

from __future__ import annotations

import io
import re

import pandas as pd
import requests
from yfinance.data import YfData

import config
import dw

SOURCE_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
# shortcut: an undocumented Yahoo endpoint reached through yfinance internals
# (version pinned); recheck it when upgrading yfinance.
QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
QUOTE_CHUNK_SIZE = 200

# Anyone can edit the source page, so a list that looks wrong changes nothing.
SIZE_RANGE = (495, 510)
# A quarterly rebalance is a handful each way.
MAX_CHANGES = 40


def _stored() -> list[str]:
    rows = dw.fetch("select ticker from raw.company_profile where in_universe order by ticker")
    return [row[0] for row in rows]


def tickers() -> list[str]:
    """Current members."""
    return _stored() or sorted(config.SP500_TICKERS)


def constituents() -> list[str]:
    page = requests.get(SOURCE_URL, headers={"User-Agent": "value-investing-dash"}, timeout=30)
    page.raise_for_status()
    table = pd.read_html(io.StringIO(page.text), attrs={"id": "constituents"})[0]
    # Yahoo writes share classes with a dash: BRK.B is BRK-B.
    return sorted({str(symbol).strip().replace(".", "-") for symbol in table["Symbol"]})


def diff(current: set[str], latest: list[str]) -> tuple[list[str], list[str]]:
    """(added, removed), or ValueError when `latest` is not believable."""
    new = set(latest)
    malformed = [t for t in new if not re.fullmatch(r"[A-Z]{1,5}(-[A-Z])?", t)]
    if malformed or not SIZE_RANGE[0] <= len(new) <= SIZE_RANGE[1]:
        raise ValueError(f"implausible list: {len(new)} names, {len(malformed)} malformed")
    added, removed = sorted(new - current), sorted(current - new)
    if len(added) + len(removed) > MAX_CHANGES:
        raise ValueError(f"{len(added)} additions and {len(removed)} removals at once")
    return added, removed


def exchange_name(full: str) -> str:
    # NasdaqGS/GM/CM are tiers of one exchange, not three; "Cboe US" is Cboe.
    return "NASDAQ" if full.startswith("Nasdaq") else full.removesuffix(" US")


def exchanges(symbols: list[str]) -> dict[str, str]:
    """Listing exchange of every symbol Yahoo quotes, a few requests for the index."""
    out: dict[str, str] = {}
    for i in range(0, len(symbols), QUOTE_CHUNK_SIZE):
        chunk = ",".join(symbols[i : i + QUOTE_CHUNK_SIZE])
        data = YfData().get_raw_json(QUOTE_URL, params={"symbols": chunk})
        for quote in data["quoteResponse"]["result"]:
            if quote.get("fullExchangeName"):
                out[quote["symbol"]] = exchange_name(quote["fullExchangeName"])
    return out


def sync() -> dict[str, list[str]]:
    """Bring `in_universe` in step with the source; raises if it cannot be trusted.

    A company that leaves keeps its rows and history, and drops off the screener
    at the next warehouse refresh.
    """
    stored = set(_stored())
    latest = constituents()
    # An empty database takes the whole list; there is nothing to compare with.
    added, removed = diff(stored or set(latest), latest)
    if not stored:
        added = latest
    # A name Yahoo does not quote has no prices to load: likely a typo upstream.
    quoted = exchanges(added) if added else {}
    unknown = [t for t in added if t not in quoted]
    added = [t for t in added if t in quoted]

    with dw.connect() as conn:
        conn.execute(
            "insert into raw.company_profile (ticker) select unnest(%s::text[])"
            " on conflict (ticker) do update set in_universe = true",
            (added,),
        )
        conn.execute(
            "update raw.company_profile set in_universe = false where ticker = any(%s)",
            (removed,),
        )
    return {"added": added, "removed": removed, "unknown": unknown}


def update_exchanges(symbols: list[str]) -> list[str]:
    """Overwrite any exchange that has changed; returns what changed.

    A symbol Yahoo no longer quotes keeps its last value.
    """
    found = exchanges(symbols)
    with dw.connect() as conn:
        rows = conn.execute(
            "update raw.company_profile c set exchange = n.exchange"
            " from unnest(%s::text[], %s::text[]) as n(ticker, exchange)"
            " where c.ticker = n.ticker and c.exchange is distinct from n.exchange"
            " returning c.ticker, c.exchange",
            (list(found), list(found.values())),
        ).fetchall()
    return [f"{ticker} {exchange}" for ticker, exchange in rows]
