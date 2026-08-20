"""Runs every valuation model across the whole universe.

The shape of this module is dictated by one measurement: the models themselves
take ~0.08s for all 500 stocks, while reading the data they need takes ~35s.
The cost is entirely I/O, so everything is bulk-loaded exactly once into
in-memory frames and the per-ticker loop touches no network at all.

That is also why valuations are precomputed into a table rather than derived on
request — the read is a fixed cost that does not shrink when only one stock is
wanted.
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
) -> list[dict]:
    """Every model's verdict on one stock. Models that do not apply are absent
    from the returned list rather than present with a zero."""
    verdicts: list[dict] = []
    sector = (profile or {}).get("sector")

    # --- Factor models: both a verdict and the discount rate for everything
    # --- downstream.
    ff3 = V.factor_regression(excess_returns, factors, ["mkt_rf", "smb", "hml"])
    ff5 = V.factor_regression(
        excess_returns, factors, ["mkt_rf", "smb", "hml", "rmw", "cma"]
    )

    if ff3:
        verdict = V.factor_verdict("ff3", ff3, price)
        if verdict:
            verdicts.append(verdict)
    if ff5:
        verdict = V.factor_verdict("ff5", ff5, price)
        if verdict:
            verdicts.append(verdict)

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

    if ttm is None:
        return V.damp_cashflow_confidence(verdicts)

    quarters = int(ttm.get("quarters_used") or 0)
    shares = V._finite(ttm.get("shares_outstanding")) or V._finite(
        (profile or {}).get("shares_outstanding")
    )

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
    growth = 0.04 if observed is None else max(0.0, min(0.12, observed * 0.5))

    stability = 0.8

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
        stability,
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
        V._finite((profile or {}).get("market_cap")),
        ttm.get("ttm_interest_expense"),
        shares,
        risk_free,
        cost_of_equity,
        growth,
        quarters,
        sector,
        stability,
    )
    if fcff:
        verdicts.append(fcff)

    book_ps = _per_share(ttm.get("stockholders_equity"), shares) or V._finite(
        (profile or {}).get("book_value_ps")
    )
    eps = V._finite(ttm.get("ttm_diluted_eps")) or V._finite(
        (profile or {}).get("trailing_eps")
    )

    graham = V.graham_verdict(price, eps, book_ps, quarters)
    if graham:
        verdicts.append(graham)

    epv = V.epv_verdict(
        price,
        ttm.get("ttm_ebit"),
        ttm.get("avg_tax_rate"),
        ttm.get("ttm_depreciation_amortisation"),
        ttm.get("ttm_capital_expenditure"),
        ttm.get("net_debt"),
        shares,
        cost_of_equity,
        sector,
        quarters,
        stability,
    )
    if epv:
        verdicts.append(epv)

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

    return V.damp_cashflow_confidence(verdicts)


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
        stats.append(
            {
                "ticker": ticker,
                "realised_return": V._finite(float(window.mean()) * V.TRADING_DAYS),
                "volatility": V._finite(
                    float(window.std()) * math.sqrt(V.TRADING_DAYS)
                ),
                "beta_252": V._finite(beta),
                "observations": int(len(window)),
            }
        )

        verdicts = value_one(
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
        )

        if not verdicts:
            unvalued.append(ticker)
            continue

        for verdict in verdicts:
            rows.append({"ticker": ticker, **verdict})

    return rows, unvalued, stats
