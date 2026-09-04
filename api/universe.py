"""Assembling the scored universe the screener reads.

Everything here comes out of the precomputed `valuations` table, so this stays
fast enough to serve on a page load: ~500 stocks with every model's verdict
attached.
"""

from __future__ import annotations

from fastapi import HTTPException

import config
import db
import jobs
import market

# Added by migration 20260821000000. Selecting them before it is applied fails
# the whole request, which would make deploying this code require lock-step
# timing with the database.
DISCOUNT_RATE_COLUMNS = (
    "ticker, realised_return, volatility, beta_252, cost_of_equity,"
    " cost_of_equity_source, capm_cost_of_equity, wacc, cost_of_debt,"
    " equity_weight, tax_rate"
)
BASE_STATISTICS_COLUMNS = "ticker, realised_return, volatility, beta_252"


def _optional_float(value) -> float | None:
    """Coerce a Supabase numeric to float, preserving None.

    `float(x or 0)` would turn a genuinely absent rate into 0.0, which the
    discount-rate panel would then render as a real 0% WACC.
    """
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _statistics() -> dict[str, dict]:
    """Per-ticker statistics, falling back to the pre-migration columns."""
    try:
        rows = db.fetch_all_rows("ticker_statistics", DISCOUNT_RATE_COLUMNS)
    except Exception:  # noqa: BLE001 - missing columns, not a fatal condition
        rows = db.fetch_all_rows("ticker_statistics", BASE_STATISTICS_COLUMNS)
    return {row["ticker"]: row for row in rows}


def _discount_rates(stats: dict, risk_free: float) -> dict:
    """The rates every verdict was discounted at.

    Null rather than 0 where they could not be computed — a missing WACC is not
    a WACC of zero — and omitted entirely pre-migration, so the panel stays
    hidden rather than rendering a card full of em dashes.
    """
    if "cost_of_equity" not in stats:
        return {}
    return {
        "discountRates": {
            "riskFree": risk_free,
            "costOfEquity": _optional_float(stats.get("cost_of_equity")),
            "costOfEquitySource": stats.get("cost_of_equity_source"),
            "capmCostOfEquity": _optional_float(stats.get("capm_cost_of_equity")),
            "wacc": _optional_float(stats.get("wacc")),
            "costOfDebt": _optional_float(stats.get("cost_of_debt")),
            "equityWeight": _optional_float(stats.get("equity_weight")),
            "taxRate": _optional_float(stats.get("tax_rate")),
        }
    }


def _index_level() -> dict | None:
    """The benchmark's last close and its one-session change.

    The market context bar states where the index stands, which is the piece
    of a real dashboard that says the numbers beside it are current. Two rows
    off the covering index added by migration 20260904000000, so this costs a
    single index-only scan rather than anything proportional to the universe.

    None on any failure: a missing index level hides one strip of chrome and
    must never take the screener down with it.
    """
    try:
        rows = db.read(
            lambda client: client.table("daily_close_prices")
            .select("date, close")
            .eq("ticker", config.SP500_INDEX_TICKER)
            .order("date", desc=True)
            .limit(2)
            .execute()
        ).data
    except Exception:  # noqa: BLE001 - chrome, not data
        return None

    if not rows:
        return None

    close = float(rows[0]["close"])
    # A single stored session means there is a level but no change to report;
    # null beats inventing a 0.00% move on the first day of a fresh database.
    previous = float(rows[1]["close"]) if len(rows) > 1 else None

    return {
        "ticker": config.SP500_INDEX_TICKER,
        "date": rows[0]["date"],
        "close": close,
        "change": (close / previous - 1) if previous else None,
    }


def scored() -> dict:
    """Every stock with its verdicts, in the shape the screener consumes."""
    risk_free = market.average_risk_free_rate()

    valuation_rows = db.fetch_all_rows(
        "valuations",
        "ticker, method, fair_value, margin_of_safety, confidence,"
        " price_at_calc, computed_at",
    )
    if not valuation_rows:
        raise HTTPException(
            status_code=404, detail="No valuations. Run /backfill/valuations first."
        )

    profiles = {row["ticker"]: row for row in db.fetch_all_rows("company_profile", "*")}
    prices = {
        row["ticker"]: row
        for row in db.fetch_all_rows("latest_close_prices", "ticker, date, close")
    }
    ttm = {row["ticker"]: row for row in db.fetch_all_rows("ttm_fundamentals", "*")}
    statistics = _statistics()

    by_ticker: dict[str, list[dict]] = {}
    computed_at = None
    for row in valuation_rows:
        by_ticker.setdefault(row["ticker"], []).append(row)
        computed_at = computed_at or row.get("computed_at")

    stocks = []
    for ticker, verdicts in sorted(by_ticker.items()):
        profile = profiles.get(ticker, {})
        stats = statistics.get(ticker, {})
        price = float(
            prices.get(ticker, {}).get("close") or verdicts[0]["price_at_calc"]
        )

        eps = ttm.get(ticker, {}).get("ttm_diluted_eps") or profile.get("trailing_eps")
        pe_ratio = float(price) / float(eps) if eps and float(eps) > 0 else 0.0

        stocks.append(
            {
                "ticker": ticker,
                "name": profile.get("name") or ticker,
                "sector": profile.get("sector") or "Unclassified",
                "price": price,
                "marketCap": float(profile.get("market_cap") or 0) / 1e9,
                # Prefer the beta measured over the same 252-day window the
                # models used; yfinance's own figure is only the fallback.
                "beta": float(stats.get("beta_252") or profile.get("beta_yf") or 0),
                "realisedReturn": float(stats.get("realised_return") or 0),
                "volatility": float(stats.get("volatility") or 0),
                "peRatio": round(pe_ratio, 2),
                "dividendYield": float(profile.get("dividend_yield") or 0) / 100,
                **_discount_rates(stats, risk_free),
                "verdicts": [
                    {
                        "method": verdict["method"],
                        "fairValue": float(verdict["fair_value"]),
                        "marginOfSafety": float(verdict["margin_of_safety"]),
                        "confidence": float(verdict["confidence"]),
                    }
                    for verdict in verdicts
                ],
            }
        )

    return {
        "computed_at": computed_at,
        "count": len(stocks),
        "risk_free_rate": risk_free,
        "index": _index_level(),
        # When each feeder table was last filled, as opposed to when the models
        # last ran over it. Carried in the payload so the front end gets it on
        # a read it already makes, rather than paying a second round trip for
        # one line of chrome.
        "data_freshness": jobs.latest(),
        "stocks": stocks,
    }
