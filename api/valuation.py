"""The valuation models.

Each model is a pure function over plain inputs, returning a verdict dict or
None. Returning None is a first-class outcome and the reason the models are
trustworthy: a bank has no meaningful free cash flow, a non-payer has no
dividend stream, a loss-maker has no Graham number. In every one of those cases
the honest answer is silence, not a number. `valuations` rows are only written
for models that produced something, so absence in the UI means "this model
does not apply here" rather than "fair value is zero".

Factor models are the one place where the fair-value contract is a stretch.
FF3/FF5 produce an expected return, not an intrinsic value per share, so they
are used two ways: they supply the cost of equity the cash-flow models discount
at (the genuinely correct use), and they emit a verdict by mapping annualised
alpha to an implied price. That mapping is disclosed in the model blurb, capped
hard, and given at most half the confidence of a cash-flow model so a noisy
regression cannot dominate the consensus.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

TRADING_DAYS = 252

# Cost of equity is clamped before it is ever used as a discount rate. An
# unclamped ke that drifts near the terminal growth rate makes the Gordon
# denominator collapse and fair values explode into the millions.
MIN_COST_OF_EQUITY = 0.06
MAX_COST_OF_EQUITY = 0.20
# Minimum spread between discount rate and terminal growth. Below this the
# perpetuity is numerically meaningless and the model must refuse.
MIN_DISCOUNT_SPREAD = 0.02
# Long-run nominal growth: roughly real GDP plus inflation. Held below every
# discount rate by MIN_DISCOUNT_SPREAD.
TERMINAL_GROWTH = 0.03
# A 5-year explicit window suits mature businesses but understates companies
# still compounding fast; 10 years lets more of the growth land inside the
# projection rather than being forced into a GDP-rate perpetuity.
PROJECTION_YEARS = 10
# No company compounds faster than nominal GDP forever.
MAX_GROWTH = 0.06

# Factor regressions need enough overlapping observations to mean anything.
MIN_REGRESSION_OBS = 120
MIN_REGRESSION_R2 = 0.10
# Alpha is a noisy estimate; cap how far it can move an implied price.
MAX_ALPHA = 0.30
MAX_FACTOR_CONFIDENCE = 0.5

MAX_COST_OF_DEBT = 0.15
MIN_COST_OF_DEBT = 0.02

# DDM values the dividend stream and nothing else, so it can only speak to
# companies that actually return most of their value that way. Below roughly a
# 1.5% yield the dividend explains so little of the price that Gordon growth
# reduces to a statement about payout policy rather than about value — Apple at
# a 0.35% yield cannot be justified at any sane discount rate. Such names get
# no DDM verdict rather than a uniformly bearish one.
MIN_DDM_YIELD = 0.015

# Sectors where capex-based cash-flow models do not apply. Banks fund
# themselves with deposits and debt, so "free cash flow" is not owner earnings;
# REITs are depreciation-heavy and are valued on FFO rather than earnings.
NO_CASHFLOW_MODEL_SECTORS = {"Financial Services", "Real Estate"}


def _finite(value) -> float | None:
    """A usable float, or None. Guards every arithmetic entry point."""
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) or math.isinf(result) else result


def _verdict(
    method: str, fair_value: float, price: float, confidence: float
) -> dict | None:
    """Assemble a verdict, rejecting nonsense fair values.

    A fair value at or below zero, or wildly above the market price, means the
    model's assumptions broke rather than that a bargain was found.
    """
    fair = _finite(fair_value)
    if fair is None or fair <= 0 or price <= 0:
        return None
    if fair > price * 10:
        return None

    return {
        "method": method,
        "fair_value": round(fair, 4),
        "margin_of_safety": round((fair - price) / price, 6),
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "price_at_calc": round(price, 4),
    }


def _stability(values: list[float | None]) -> float:
    """1 − coefficient of variation, clamped to [0, 1].

    A series that swings wildly quarter to quarter is a weaker basis for
    projection than a steady one, and confidence should say so.
    """
    clean = [v for v in (_finite(v) for v in values) if v is not None]
    if len(clean) < 2:
        return 0.5

    mean = sum(clean) / len(clean)
    if mean == 0:
        return 0.3

    variance = sum((v - mean) ** 2 for v in clean) / len(clean)
    cov = math.sqrt(variance) / abs(mean)
    return max(0.0, min(1.0, 1.0 - cov))


def _two_stage_pv(
    base: float, growth: float, discount: float, terminal: float
) -> float | None:
    """Present value of a cash flow growing at `growth` for PROJECTION_YEARS,
    then at `terminal` in perpetuity."""
    if discount - terminal < MIN_DISCOUNT_SPREAD:
        return None

    pv = 0.0
    flow = base
    for year in range(1, PROJECTION_YEARS + 1):
        flow = flow * (1 + growth)
        pv += flow / ((1 + discount) ** year)

    terminal_value = flow * (1 + terminal) / (discount - terminal)
    pv += terminal_value / ((1 + discount) ** PROJECTION_YEARS)
    return pv


# --------------------------------------------------------------------------
# Factor models
# --------------------------------------------------------------------------


def factor_regression(
    excess_returns: pd.Series, factor_df: pd.DataFrame, columns: list[str]
) -> dict | None:
    """OLS of excess stock returns on factor returns.

    Runs on the date INTERSECTION of the two series — never on the raw last-252
    price dates, because the Fama-French library publishes weeks in arrears and
    assuming coverage would silently regress against misaligned dates.
    """
    joined = pd.concat([excess_returns.rename("y"), factor_df[columns]], axis=1)
    joined = joined.dropna()

    if len(joined) < MIN_REGRESSION_OBS:
        return None

    joined = joined.tail(TRADING_DAYS)

    y = joined["y"].to_numpy(dtype=float)
    x = joined[columns].to_numpy(dtype=float)
    design = np.column_stack([np.ones(len(x)), x])

    try:
        coefficients, *_ = np.linalg.lstsq(design, y, rcond=None)
    except np.linalg.LinAlgError:
        return None

    fitted = design @ coefficients
    residuals = y - fitted
    total_variance = float(np.var(y))
    if total_variance == 0:
        return None

    r_squared = 1.0 - float(np.var(residuals)) / total_variance

    return {
        "alpha_daily": float(coefficients[0]),
        "betas": {name: float(b) for name, b in zip(columns, coefficients[1:])},
        "r_squared": r_squared,
        "n_obs": len(joined),
    }


def factor_cost_of_equity(
    betas: dict[str, float], premia: dict[str, float], risk_free: float
) -> float:
    """Cost of equity implied by factor loadings: rf + sum(beta_i * lambda_i)."""
    total = risk_free + sum(
        beta * premia.get(name, 0.0) for name, beta in betas.items()
    )
    return max(MIN_COST_OF_EQUITY, min(MAX_COST_OF_EQUITY, total))


def factor_verdict(method: str, regression: dict, price: float) -> dict | None:
    """Map a factor regression to a verdict via annualised alpha.

    This is the deliberate stretch described in the module docstring. Alpha is
    the return the factors did not explain; treating it as a one-year
    convergence gives an implied price. Capped and low-confidence by design.
    """
    if regression["r_squared"] < MIN_REGRESSION_R2:
        return None

    alpha_annual = regression["alpha_daily"] * TRADING_DAYS
    alpha_annual = max(-MAX_ALPHA, min(MAX_ALPHA, alpha_annual))

    confidence = min(
        MAX_FACTOR_CONFIDENCE,
        MAX_FACTOR_CONFIDENCE
        * min(1.0, regression["r_squared"] / 0.5)
        * (regression["n_obs"] / TRADING_DAYS),
    )

    return _verdict(method, price * (1 + alpha_annual), price, confidence)


# --------------------------------------------------------------------------
# Cash-flow and accounting models
# --------------------------------------------------------------------------


def ddm_verdict(
    price: float,
    trailing_dividend: float | None,
    dividend_growth: float | None,
    cost_of_equity: float,
    payment_count: int,
    payout_ratio: float | None,
    payment_stability: float,
) -> dict | None:
    """Gordon growth on the dividend stream.

    Refuses for non-payers rather than returning zero — the absence of a
    dividend is not evidence of zero value, it means this model has nothing to
    say about the company.
    """
    dividend = _finite(trailing_dividend)
    if dividend is None or dividend <= 0 or payment_count < 8:
        return None

    # A token dividend does not make a company valuable as a dividend stream.
    if dividend / price < MIN_DDM_YIELD:
        return None

    requested_growth = max(0.0, _finite(dividend_growth) or 0.0)

    # Checked against the REQUESTED growth, before the MAX_GROWTH clamp.
    # Clamping first would rescue an invalid ke <= g input into a
    # plausible-looking number — exactly the failure this guards against.
    if cost_of_equity - requested_growth < MIN_DISCOUNT_SPREAD:
        return None

    growth = min(MAX_GROWTH, requested_growth)

    fair_value = dividend * (1 + growth) / (cost_of_equity - growth)

    # DDM only speaks for companies that genuinely return value as dividends,
    # and MIN_DDM_YIELD has already excluded the ones it cannot describe.
    confidence = 0.6 * payment_stability
    payout = _finite(payout_ratio)
    # A payout above earnings is being funded from somewhere other than
    # profit, so the stream is less durable than its history suggests.
    if payout is not None and payout > 0.9:
        confidence *= 0.6

    return _verdict("ddm", fair_value, price, confidence)


def fcfe_verdict(
    price: float,
    ttm_operating_cf: float | None,
    ttm_capex: float | None,
    ttm_net_borrowing: float | None,
    shares: float | None,
    cost_of_equity: float,
    growth: float,
    quarters_used: int,
    sector: str | None,
    stability: float,
) -> dict | None:
    """Free cash flow to equity, discounted at the cost of equity.

    FCFE = operating cash flow + capex + net borrowing. Capex is stored
    negative, so this is an addition.
    """
    if sector in NO_CASHFLOW_MODEL_SECTORS:
        return None
    if quarters_used < 4:
        return None

    ocf = _finite(ttm_operating_cf)
    capex = _finite(ttm_capex)
    share_count = _finite(shares)
    if ocf is None or capex is None or share_count is None or share_count <= 0:
        return None

    fcfe = ocf + capex + (_finite(ttm_net_borrowing) or 0.0)
    if fcfe <= 0:
        return None

    # Spread is checked against the requested growth before clamping, so an
    # unreasonable growth estimate refuses rather than being capped into
    # looking reasonable.
    if cost_of_equity - max(0.0, growth) < MIN_DISCOUNT_SPREAD:
        return None

    equity_value = _two_stage_pv(
        fcfe, min(growth, MAX_GROWTH), cost_of_equity, TERMINAL_GROWTH
    )
    if equity_value is None:
        return None

    confidence = 0.75 * stability
    # Cash flow propped up by borrowing is not owner earnings.
    borrowing = _finite(ttm_net_borrowing) or 0.0
    if borrowing > 0.5 * fcfe:
        confidence *= 0.6

    return _verdict("fcfe", equity_value / share_count, price, confidence)


def fcff_verdict(
    price: float,
    ttm_ebit: float | None,
    ttm_depreciation: float | None,
    ttm_capex: float | None,
    ttm_working_capital: float | None,
    tax_rate: float | None,
    total_debt: float | None,
    net_debt: float | None,
    market_cap: float | None,
    ttm_interest: float | None,
    shares: float | None,
    risk_free: float,
    cost_of_equity: float,
    growth: float,
    quarters_used: int,
    sector: str | None,
    stability: float,
) -> dict | None:
    """Free cash flow to the firm, discounted at WACC, bridged to equity."""
    if sector in NO_CASHFLOW_MODEL_SECTORS:
        return None
    if quarters_used < 4:
        return None

    ebit = _finite(ttm_ebit)
    capex = _finite(ttm_capex)
    share_count = _finite(shares)
    equity_mv = _finite(market_cap)
    if ebit is None or capex is None or share_count is None or share_count <= 0:
        return None
    if equity_mv is None or equity_mv <= 0:
        return None

    rate = _finite(tax_rate)
    imputed_tax = rate is None
    if imputed_tax:
        rate = 0.21
    rate = max(0.0, min(0.5, rate))

    depreciation = _finite(ttm_depreciation) or 0.0
    working_capital = _finite(ttm_working_capital) or 0.0
    fcff = ebit * (1 - rate) + depreciation + capex - working_capital
    if fcff <= 0:
        return None

    debt = _finite(total_debt) or 0.0
    interest = _finite(ttm_interest)
    if debt > 0 and interest is not None and interest > 0:
        cost_of_debt = interest / debt
    else:
        cost_of_debt = risk_free + 0.02
    cost_of_debt = max(MIN_COST_OF_DEBT, min(MAX_COST_OF_DEBT, cost_of_debt))

    total_capital = equity_mv + debt
    wacc = (equity_mv / total_capital) * cost_of_equity + (
        debt / total_capital
    ) * cost_of_debt * (1 - rate)
    wacc = max(MIN_COST_OF_EQUITY, min(MAX_COST_OF_EQUITY, wacc))

    # As in FCFE: validate the spread against the requested growth first.
    if wacc - max(0.0, growth) < MIN_DISCOUNT_SPREAD:
        return None

    enterprise_value = _two_stage_pv(
        fcff, min(growth, MAX_GROWTH), wacc, TERMINAL_GROWTH
    )
    if enterprise_value is None:
        return None

    equity_value = enterprise_value - (_finite(net_debt) or 0.0)
    if equity_value <= 0:
        return None

    confidence = 0.8 * stability
    if imputed_tax:
        confidence *= 0.8

    return _verdict("fcff", equity_value / share_count, price, confidence)


def graham_verdict(
    price: float, eps: float | None, book_value_ps: float | None, quarters_used: int
) -> dict | None:
    """Graham number: sqrt(22.5 * EPS * book value per share).

    Refuses on non-positive inputs. sqrt of a negative product is the classic
    silent-NaN source in this formula.
    """
    earnings = _finite(eps)
    book = _finite(book_value_ps)
    if earnings is None or book is None or earnings <= 0 or book <= 0:
        return None

    fair_value = math.sqrt(22.5 * earnings * book)
    # A 1930s defensive screen: the 22.5 constant encodes 15x earnings and 1.5x
    # book, which almost nothing clears in a modern market. Useful as a
    # deep-value flag, far too blunt to weigh against a cash-flow model.
    confidence = 0.3 * min(1.0, quarters_used / 4)
    return _verdict("graham", fair_value, price, confidence)


def epv_verdict(
    price: float,
    ttm_ebit: float | None,
    tax_rate: float | None,
    ttm_depreciation: float | None,
    ttm_capex: float | None,
    net_debt: float | None,
    shares: float | None,
    discount_rate: float,
    sector: str | None,
    quarters_used: int,
    stability: float,
) -> dict | None:
    """Greenwald earnings power value: sustainable earnings capitalised with no
    growth assumption, adjusted for maintenance capex."""
    if sector in NO_CASHFLOW_MODEL_SECTORS or quarters_used < 4:
        return None

    ebit = _finite(ttm_ebit)
    share_count = _finite(shares)
    if ebit is None or ebit <= 0 or share_count is None or share_count <= 0:
        return None

    rate = _finite(tax_rate)
    rate = 0.21 if rate is None else max(0.0, min(0.5, rate))

    earnings = ebit * (1 - rate)
    # Where capex exceeds depreciation the excess is growth spending, which
    # EPV explicitly does not pay for.
    depreciation = _finite(ttm_depreciation) or 0.0
    capex = abs(_finite(ttm_capex) or 0.0)
    if capex > depreciation:
        earnings -= capex - depreciation
    if earnings <= 0:
        return None

    if discount_rate <= 0:
        return None

    equity_value = earnings / discount_rate - (_finite(net_debt) or 0.0)
    if equity_value <= 0:
        return None

    # EPV assumes no growth at all, which caps any company at roughly 1/r times
    # earnings — about 11x at a 9% discount rate. Against a market trading well
    # above that it reads bearish by construction, so it carries deliberately
    # low weight: it is a floor on value, not an estimate of it.
    return _verdict("epv", equity_value / share_count, price, 0.35 * stability)


def rim_verdict(
    price: float,
    book_value_ps: float | None,
    eps: float | None,
    cost_of_equity: float,
    payout_ratio: float | None,
    quarters_used: int,
) -> dict | None:
    """Residual income: book value plus earnings above the cost of equity.

    Robust where cash flows are lumpy, and the right model for banks — which is
    why it carries no sector exclusion. Refuses on negative book value, which
    makes the model meaningless and does occur among buyback-heavy large caps.
    """
    book = _finite(book_value_ps)
    earnings = _finite(eps)
    if book is None or earnings is None or book <= 0 or quarters_used < 4:
        return None

    payout = _finite(payout_ratio)
    retention = 1.0 - (payout if payout is not None and 0 <= payout <= 1 else 0.4)

    value = book
    carried_book = book
    for year in range(1, PROJECTION_YEARS + 1):
        residual = earnings - cost_of_equity * carried_book
        value += residual / ((1 + cost_of_equity) ** year)
        carried_book += earnings * retention

    # Like EPV, RIM anchors on book value and credits no growth beyond
    # retained earnings, so it reads low for asset-light compounders whose
    # value is not on the balance sheet. Weighted accordingly.
    return _verdict("rim", value, price, 0.35 * min(1.0, quarters_used / 4))


def damp_cashflow_confidence(verdicts: list[dict]) -> list[dict]:
    """Scale down confidence when several cash-flow models agree.

    FCFE, FCFF and EPV all discount the same underlying cash generation. Left
    alone they would give one methodology three votes in a confidence-weighted
    consensus, so each is scaled by 1/sqrt(n) when more than one fires.
    """
    cashflow_methods = {"fcfe", "fcff", "epv"}
    firing = [v for v in verdicts if v["method"] in cashflow_methods]
    if len(firing) <= 1:
        return verdicts

    scale = 1.0 / math.sqrt(len(firing))
    for verdict in firing:
        verdict["confidence"] = round(verdict["confidence"] * scale, 4)
    return verdicts
