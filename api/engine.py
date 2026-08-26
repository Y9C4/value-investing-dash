"""Runs every valuation model across the whole universe.

The shape of this module is dictated by one measurement: the models take
~0.08s for all 500 stocks, while reading the data they need takes ~35s. So
everything is bulk-loaded once into in-memory frames and the per-ticker loop
touches no network at all. It is also why valuations are precomputed into a
table rather than derived on request.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

import valuation as V

# Models need 252 trading days; fetching much more just inflates egress on
# every run. 400 calendar days comfortably covers 252 trading ones.
PRICE_WINDOW_DAYS = 400
DIVIDEND_HISTORY_YEARS = 6
# Dividend growth is measured over this many years of payment history.
GROWTH_LOOKBACK_YEARS = 5


def _annualised_premia(factors: pd.DataFrame, columns: list[str]) -> dict[str, float]:
    """Mean daily factor premia, annualised over 252 trading days."""
    return {
        column: float(factors[column].mean()) * V.TRADING_DAYS for column in columns
    }


def _dividend_stats(payments: pd.DataFrame) -> dict:
    """Trailing dividend, growth rate and payment stability for one ticker.

    Returns zeros for a non-payer; callers must check `count` rather than
    treating a 0.0 dividend as a valuation input.
    """
    if payments.empty:
        return {"trailing": 0.0, "growth": 0.0, "count": 0, "stability": 0.0}

    payments = payments.sort_values("ex_date")
    latest = payments["ex_date"].max()

    trailing = float(
        payments.loc[
            payments["ex_date"] > latest - pd.Timedelta(days=365), "amount"
        ].sum()
    )

    # Compound annual growth between the earliest and latest full years on
    # record, rather than a point-to-point read of two single payments.
    window_start = latest - pd.Timedelta(days=365 * GROWTH_LOOKBACK_YEARS)
    early = payments.loc[
        (payments["ex_date"] > window_start)
        & (payments["ex_date"] <= window_start + pd.Timedelta(days=365)),
        "amount",
    ].sum()
    growth = 0.0
    if early > 0 and trailing > 0:
        years = GROWTH_LOOKBACK_YEARS - 1
        if years > 0:
            growth = (trailing / float(early)) ** (1.0 / years) - 1.0

    recent = payments.tail(8)["amount"].tolist()
    return {
        "trailing": trailing,
        "growth": float(np.clip(growth, -0.5, 0.5)),
        "count": int(len(payments)),
        "stability": V._stability(recent),
    }


def _shares_for(ttm: dict | None, profile: dict | None) -> float | None:
    """Share count for one ticker, TTM first, profile as fallback."""
    return V._finite((ttm or {}).get("shares_outstanding")) or V._finite(
        (profile or {}).get("shares_outstanding")
    )


def sector_multiples(
    prices: pd.DataFrame,
    ttm_by_ticker: dict[str, dict],
    profiles: dict[str, dict],
    index_ticker: str,
) -> dict[str, dict[str, float]]:
    """Median EV/EBITDA and P/E for every sector with enough usable peers.

    This is why the universe is valued in two passes: a relative valuation needs
    the peer set priced first, and `value_one` sees one ticker at a time.
    Sectors below `MIN_COMPS_PEERS` are omitted rather than given a thin median,
    and `comps_verdict` then refuses for those companies.
    """
    buckets: dict[str, dict[str, list[float]]] = {}

    for ticker in prices.columns:
        if ticker == index_ticker:
            continue

        ttm = ttm_by_ticker.get(ticker)
        if not ttm or int(ttm.get("quarters_used") or 0) < 4:
            continue

        profile = profiles.get(ticker) or {}
        sector = profile.get("sector")
        if not sector:
            continue

        series = prices[ticker].dropna()
        if series.empty:
            continue
        price = V._finite(series.iloc[-1])
        shares = _shares_for(ttm, profile)
        if price is None or price <= 0 or shares is None or shares <= 0:
            continue

        bucket = buckets.setdefault(sector, {"ev_ebitda": [], "pe": []})

        ebitda = V._finite(ttm.get("ttm_ebitda"))
        if ebitda is not None and ebitda > 0:
            enterprise = price * shares + (V._finite(ttm.get("net_debt")) or 0.0)
            if enterprise > 0:
                bucket["ev_ebitda"].append(enterprise / ebitda)

        eps = V._finite(ttm.get("ttm_diluted_eps")) or V._finite(
            profile.get("trailing_eps")
        )
        if eps is not None and eps > 0:
            bucket["pe"].append(price / eps)

    medians: dict[str, dict[str, float]] = {}
    for sector, bucket in buckets.items():
        entry = {
            key: float(np.median(values))
            for key, values in bucket.items()
            if len(values) >= V.MIN_COMPS_PEERS
        }
        if entry:
            medians[sector] = entry
    return medians


def _per_share(total: float | None, shares: float | None) -> float | None:
    value = V._finite(total)
    count = V._finite(shares)
    if value is None or count is None or count <= 0:
        return None
    return value / count


def value_one(
    ticker: str,
    price: float,
    excess_returns: pd.Series,
    factors: pd.DataFrame,
    ff3_premia: dict[str, float],
    ff5_premia: dict[str, float],
    ttm: dict | None,
    profile: dict | None,
    dividends: pd.DataFrame,
    risk_free: float,
    market_premium: float,
    beta: float | None,
    multiples: dict[str, float] | None = None,
) -> tuple[list[dict], dict]:
    """Every model's verdict on one stock, plus the discount rates used.

    Models that do not apply are absent rather than present with a zero. The
    rates come back separately because a cost of equity is not a fair value per
    share, but the UI has to show what these numbers were discounted at.
    """
    verdicts: list[dict] = []
    sector = (profile or {}).get("sector")

    # --- Factor regressions. These emit no verdict of their own: an expected
    # --- return is not an intrinsic value per share. They exist to supply the
    # --- cost of equity every model below discounts at.
    ff3 = V.factor_regression(excess_returns, factors, ["mkt_rf", "smb", "hml"])
    ff5 = V.factor_regression(
        excess_returns, factors, ["mkt_rf", "smb", "hml", "rmw", "cma"]
    )

    # CAPM cost of equity is the fallback when the factor regression could not
    # run (too few overlapping dates, usually a recent listing).
    capm_ke = V.MIN_COST_OF_EQUITY
    if beta is not None:
        capm_ke = max(
            V.MIN_COST_OF_EQUITY,
            min(V.MAX_COST_OF_EQUITY, risk_free + beta * market_premium),
        )

    if ff5:
        cost_of_equity = V.factor_cost_of_equity(ff5["betas"], ff5_premia, risk_free)
    elif ff3:
        cost_of_equity = V.factor_cost_of_equity(ff3["betas"], ff3_premia, risk_free)
    else:
        cost_of_equity = capm_ke

    rates: dict = {
        "cost_of_equity": V._finite(cost_of_equity),
        "cost_of_equity_source": "ff5" if ff5 else "ff3" if ff3 else "capm",
        "capm_cost_of_equity": V._finite(capm_ke) if beta is not None else None,
        "wacc": None,
        "cost_of_debt": None,
        "equity_weight": None,
        "tax_rate": None,
    }

    if ttm is None:
        return V.damp_cashflow_confidence(verdicts), rates

    quarters = int(ttm.get("quarters_used") or 0)
    shares = _shares_for(ttm, profile)

    # --- Dividend discount
    stats = _dividend_stats(dividends)
    ddm = V.ddm_verdict(
        price,
        stats["trailing"],
        stats["growth"],
        cost_of_equity,
        stats["count"],
        V._finite((profile or {}).get("payout_ratio")),
        stats["stability"],
    )
    if ddm:
        verdicts.append(ddm)

    # Growth for the cash-flow models. Revenue growth is the steadiest of the
    # available estimates; earnings growth swings too hard on one-off items.
    # Halved on the way in, because a single year's rate does not persist for a
    # decade, then capped so no name can grow its way to an absurd perpetuity.
    revenue_growth = V._finite((profile or {}).get("revenue_growth"))
    earnings_growth = V._finite((profile or {}).get("earnings_growth"))
    observed = revenue_growth if revenue_growth is not None else earnings_growth
    # NOT redundant with MAX_GROWTH, which clamps only what reaches the
    # projection. The discount-spread guards test the rate BEFORE that clamp,
    # so an absurd estimate refuses instead of being capped into looking
    # reasonable. Without this ceiling a 40% revenue-growth figure halves to
    # 20%, exceeds every cost of equity, and silently costs 89 names a verdict.
    growth = 0.04 if observed is None else max(0.0, min(0.12, observed * 0.5))

    fcfe = V.fcfe_verdict(
        price,
        ttm.get("ttm_operating_cash_flow"),
        ttm.get("ttm_capital_expenditure"),
        ttm.get("ttm_net_borrowing"),
        shares,
        cost_of_equity,
        growth,
        quarters,
        sector,
    )
    if fcfe:
        verdicts.append(fcfe)

    fcff = V.fcff_verdict(
        price,
        ttm.get("ttm_ebit"),
        ttm.get("ttm_depreciation_amortisation"),
        ttm.get("ttm_capital_expenditure"),
        ttm.get("ttm_change_in_working_capital"),
        ttm.get("avg_tax_rate"),
        ttm.get("total_debt"),
        ttm.get("net_debt"),
        ttm.get("ttm_interest_expense"),
        shares,
        risk_free,
        cost_of_equity,
        growth,
        quarters,
        sector,
    )
    if fcff:
        verdicts.append(fcff)

    book_ps = _per_share(ttm.get("stockholders_equity"), shares) or V._finite(
        (profile or {}).get("book_value_ps")
    )
    eps = V._finite(ttm.get("ttm_diluted_eps")) or V._finite(
        (profile or {}).get("trailing_eps")
    )

    rim = V.rim_verdict(
        price,
        book_ps,
        eps,
        cost_of_equity,
        V._finite((profile or {}).get("payout_ratio")),
        quarters,
    )
    if rim:
        verdicts.append(rim)

    comps = V.comps_verdict(
        price,
        ttm.get("ttm_ebitda"),
        eps,
        ttm.get("net_debt"),
        shares,
        multiples,
        quarters,
    )
    if comps:
        verdicts.append(comps)

    # The same call `fcff_verdict` makes, so the panel cannot drift from the
    # rate the model discounted at. Recorded even when FCFF itself refuses --
    # a reader is owed the discount rate that led to the refusal.
    if shares is not None and shares > 0 and quarters >= 4:
        tax = V._finite(ttm.get("avg_tax_rate"))
        tax = 0.21 if tax is None else max(0.0, min(0.5, tax))
        components = V.wacc_components(
            price * shares,
            tax,
            ttm.get("total_debt"),
            ttm.get("net_debt"),
            ttm.get("ttm_interest_expense"),
            risk_free,
            cost_of_equity,
        )
        rates.update(
            {
                "wacc": V._finite(components["wacc"]),
                "cost_of_debt": V._finite(components["cost_of_debt"]),
                "equity_weight": V._finite(components["equity_weight"]),
                "tax_rate": V._finite(components["tax_rate"]),
            }
        )

    return V.damp_cashflow_confidence(verdicts), rates


def compute_universe(
    prices: pd.DataFrame,
    factors: pd.DataFrame,
    ttm_by_ticker: dict[str, dict],
    profiles: dict[str, dict],
    dividends_by_ticker: dict[str, pd.DataFrame],
    risk_free: float,
    index_ticker: str,
) -> tuple[list[dict], list[str], list[dict]]:
    """Run every model over every ticker with usable price history.

    `prices` is wide (index=date, columns=ticker). Returns the verdict rows
    ready for upsert, the tickers that produced nothing at all, and the
    per-ticker return statistics measured over the same window.
    """
    log_returns = np.log(prices / prices.shift(1))

    if index_ticker not in log_returns.columns:
        raise ValueError(f"Index {index_ticker} missing from price frame")

    market_returns = log_returns[index_ticker]
    market_annual = float(market_returns.tail(V.TRADING_DAYS).mean()) * V.TRADING_DAYS
    market_premium = market_annual - risk_free
    market_variance = float(market_returns.tail(V.TRADING_DAYS).var())

    daily_rf = risk_free / V.TRADING_DAYS
    factors = factors.set_index("date").sort_index()

    ff3_columns = ["mkt_rf", "smb", "hml"]
    ff5_columns = [*ff3_columns, "rmw", "cma"]
    ff3_premia = _annualised_premia(factors, ff3_columns)
    ff5_premia = _annualised_premia(factors, ff5_columns)

    # Pass one. Comps measure a company against its peers, so the peer set has
    # to be priced before any single company can be valued against it.
    multiples_by_sector = sector_multiples(
        prices, ttm_by_ticker, profiles, index_ticker
    )

    rows: list[dict] = []
    unvalued: list[str] = []
    stats: list[dict] = []

    for ticker in prices.columns:
        if ticker == index_ticker:
            continue

        series = log_returns[ticker].dropna()
        if len(series) < 30:
            unvalued.append(ticker)
            continue

        window = series.tail(V.TRADING_DAYS)
        price = V._finite(prices[ticker].dropna().iloc[-1]) if not prices[
            ticker
        ].dropna().empty else None
        if price is None or price <= 0:
            unvalued.append(ticker)
            continue

        aligned_market = market_returns.reindex(window.index)
        covariance = float(window.cov(aligned_market))
        beta = covariance / market_variance if market_variance else None

        # Measured on the same window the models use, so the risk numbers in
        # the screener and the valuations beside them describe one period.
        # Recorded for every ticker with history, including ones no model could
        # value — return and volatility do not depend on a verdict existing.
        statistics_row = {
            "ticker": ticker,
            "realised_return": V._finite(float(window.mean()) * V.TRADING_DAYS),
            "volatility": V._finite(float(window.std()) * math.sqrt(V.TRADING_DAYS)),
            "beta_252": V._finite(beta),
            "observations": int(len(window)),
        }
        stats.append(statistics_row)

        verdicts, rates = value_one(
            ticker,
            price,
            window - daily_rf,
            factors,
            ff3_premia,
            ff5_premia,
            ttm_by_ticker.get(ticker),
            profiles.get(ticker),
            dividends_by_ticker.get(ticker, pd.DataFrame(columns=["ex_date", "amount"])),
            risk_free,
            market_premium,
            beta,
            multiples_by_sector.get((profiles.get(ticker) or {}).get("sector")),
        )
        statistics_row.update(rates)

        if not verdicts:
            unvalued.append(ticker)
            continue

        for verdict in verdicts:
            rows.append({"ticker": ticker, **verdict})

    return rows, unvalued, stats
