"""The valuation models.

Each model is a pure function over plain inputs, returning a verdict dict or
None. Returning None is a first-class outcome and the reason the models are
trustworthy: a bank has no meaningful free cash flow, a non-payer has no
dividend stream, a loss-maker has no Graham number. Rows are only written
for models that produced something, so absence in the UI means "does not
apply here" rather than "fair value is zero".

Factor models are not verdicts. FF3/FF5 produce an expected return, not an
intrinsic value per share. What survives is their correct use: supplying the
cost of equity that the cash-flow models discount at.
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

MAX_COST_OF_DEBT = 0.15
MIN_COST_OF_DEBT = 0.02

# WACC is a blend, not a cost of equity. A levered firm's WACC belongs BELOW
# its ke, so clamping it to the ke bounds (as this once did) put a 6% floor
# under every levered discount rate -- CHTR sat four basis points above it,
# meaning its discount rate was very nearly a constant.
MIN_WACC = 0.03
MAX_WACC = 0.20
# Market-value weights make the discount rate a function of the price being
# valued. Capping the debt weight bounds that feedback; see `fcff_verdict`.
# This is a modelling judgement, not a fact about the company.
MAX_DEBT_WEIGHT = 0.60

# DDM values the dividend stream and nothing else. Below ~1.5% yield the
# dividend explains too little of the price for Gordon growth to be a statement
# about value — Apple at 0.35% cannot be justified at any sane discount rate —
# so those names get no DDM verdict rather than a uniformly bearish one.
MIN_DDM_YIELD = 0.015

# How much say each methodology gets in the consensus. These are JUDGEMENTS
# about the models, not measurements of any company: FCFF and FCFE model cash
# generation directly and are trusted most; RIM anchors on book value and reads
# low for asset-light compounders, so it is heard but not loudly. Only the
# per-company adjustments below genuinely vary.
WEIGHT_FCFF = 0.80
WEIGHT_FCFE = 0.75
# Comps answer a different question from the four models above -- "what would
# this be worth priced like its peers" rather than "what is this worth" -- so
# it is heard clearly but never louder than a discounted cash flow. If the
# whole sector is mispriced, comps inherits that mispricing wholesale.
WEIGHT_COMPS = 0.55
WEIGHT_DDM = 0.60
WEIGHT_RIM = 0.35

# A sector median drawn from a handful of names is not a median, it is an
# anecdote. Below this many usable peers the multiple is withheld entirely.
MIN_COMPS_PEERS = 5

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

    A fair value at or below zero, or an order of magnitude from the market
    price in EITHER direction, means the model's assumptions broke. The
    symmetry matters: rejecting only the high side censors the undervalued
    readings and tilts every consensus downward.
    """
    fair = _finite(fair_value)
    if fair is None or fair <= 0 or price <= 0:
        return None
    if fair > price * 10 or fair < price / 10:
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
    """Two-stage dividend discount: the trailing dividend grown explicitly for
    PROJECTION_YEARS, then at TERMINAL_GROWTH in perpetuity.

    Refuses for non-payers. No dividend is not evidence of zero value; it means
    this model has nothing to say about the company.

    Two-stage rather than single-stage Gordon because the closed form cannot
    represent a dividend growing faster than its own discount rate: its ke > g
    guard refused 109 of the index's 248 qualifying payers.
    """
    dividend = _finite(trailing_dividend)
    if dividend is None or dividend <= 0 or payment_count < 8:
        return None

    # A token dividend does not make a company valuable as a dividend stream.
    if dividend / price < MIN_DDM_YIELD:
        return None

    # Halved on the way in for the reason the cash-flow models halve revenue
    # growth: one lookback window's rate is not a decade's rate. It matters more
    # here, because a dividend reinstatement reads as a triple-digit CAGR that
    # describes an event rather than a trend.
    growth = min(MAX_GROWTH, max(0.0, _finite(dividend_growth) or 0.0) * 0.5)

    fair_value = _two_stage_pv(dividend, growth, cost_of_equity, TERMINAL_GROWTH)
    if fair_value is None:
        return None

    # DDM only speaks for companies that genuinely return value as dividends,
    # and MIN_DDM_YIELD has already excluded the ones it cannot describe.
    confidence = WEIGHT_DDM * payment_stability
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

    confidence = WEIGHT_FCFE
    # Cash flow propped up by borrowing is not owner earnings.
    borrowing = _finite(ttm_net_borrowing) or 0.0
    if borrowing > 0.5 * fcfe:
        confidence *= 0.6

    return _verdict("fcfe", equity_value / share_count, price, confidence)


def wacc_components(
    equity_value: float,
    tax_rate: float,
    total_debt: float | None,
    net_debt: float | None,
    ttm_interest: float | None,
    risk_free: float,
    cost_of_equity: float,
) -> dict:
    """Every input to WACC, and the resulting rate, as one dict.

    Extracted so the discount-rate panel shows exactly the numbers the DCF
    discounted at. A second implementation written for display is how a UI ends
    up quoting a WACC the model never used.

    `equity_value` is price x shares, measured by the caller so it agrees with
    the price the verdict is scored against.
    """
    # Cost of debt is what the company actually pays on money it has borrowed,
    # so it is a yield on GROSS debt. Netting cash out here would invent a
    # borrowing rate no lender offers.
    gross_debt = _finite(total_debt) or 0.0
    interest = _finite(ttm_interest)
    if gross_debt > 0 and interest is not None and interest > 0:
        cost_of_debt = interest / gross_debt
        imputed_debt_cost = False
    else:
        cost_of_debt = risk_free + 0.02
        imputed_debt_cost = True
    cost_of_debt = max(MIN_COST_OF_DEBT, min(MAX_COST_OF_DEBT, cost_of_debt))

    # The weights use NET debt, because the equity bridge subtracts net debt.
    # Gross weights against a net bridge counts a cash pile twice. Net cash
    # floors at zero: more cash than debt is a 100% equity weight, not a
    # subsidy.
    bridge_debt = _finite(net_debt) or 0.0
    weight_debt = max(0.0, bridge_debt)

    total_capital = equity_value + weight_debt
    raw_debt_weight = weight_debt / total_capital if total_capital > 0 else 0.0
    # Market-value weights make the discount rate a function of the very price
    # being valued: as equity falls its weight falls, the cheap after-tax debt
    # weight rises, WACC drops, and the model calls the falling equity MORE
    # valuable. Capping the debt weight bounds that loop.
    debt_weight = min(raw_debt_weight, MAX_DEBT_WEIGHT)

    wacc = (1 - debt_weight) * cost_of_equity + debt_weight * cost_of_debt * (
        1 - tax_rate
    )
    wacc = max(MIN_WACC, min(MAX_WACC, wacc))

    return {
        "wacc": wacc,
        "cost_of_debt": cost_of_debt,
        "imputed_debt_cost": imputed_debt_cost,
        "tax_rate": tax_rate,
        "equity_value": equity_value,
        "net_debt": bridge_debt,
        "debt_weight": debt_weight,
        "equity_weight": 1 - debt_weight,
        "debt_weight_capped": raw_debt_weight > MAX_DEBT_WEIGHT,
    }


def fcff_verdict(
    price: float,
    ttm_ebit: float | None,
    ttm_depreciation: float | None,
    ttm_capex: float | None,
    ttm_working_capital: float | None,
    tax_rate: float | None,
    total_debt: float | None,
    net_debt: float | None,
    ttm_interest: float | None,
    shares: float | None,
    risk_free: float,
    cost_of_equity: float,
    growth: float,
    quarters_used: int,
    sector: str | None,
) -> dict | None:
    """Free cash flow to the firm, discounted at WACC, bridged to equity."""
    if sector in NO_CASHFLOW_MODEL_SECTORS:
        return None
    if quarters_used < 4:
        return None

    ebit = _finite(ttm_ebit)
    capex = _finite(ttm_capex)
    share_count = _finite(shares)
    if ebit is None or capex is None or share_count is None or share_count <= 0:
        return None

    # Measured from the same price the margin of safety uses, times the same
    # share count the fair value is divided by. `company_profile.market_cap` is
    # a yfinance snapshot from a different backfill and disagreed by 13% on
    # CHTR; one number for the weights and another for the division cannot both
    # be right.
    equity_mv = price * share_count
    if equity_mv <= 0:
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

    components = wacc_components(
        equity_mv, rate, total_debt, net_debt, ttm_interest, risk_free,
        cost_of_equity,
    )
    wacc = components["wacc"]
    bridge_debt = components["net_debt"]

    # As in FCFE: validate the spread against the requested growth first.
    if wacc - max(0.0, growth) < MIN_DISCOUNT_SPREAD:
        return None

    enterprise_value = _two_stage_pv(
        fcff, min(growth, MAX_GROWTH), wacc, TERMINAL_GROWTH
    )
    if enterprise_value is None:
        return None

    equity_value = enterprise_value - bridge_debt
    if equity_value <= 0:
        return None

    confidence = WEIGHT_FCFF
    if imputed_tax:
        confidence *= 0.8

    return _verdict("fcff", equity_value / share_count, price, confidence)


def comps_verdict(
    price: float,
    ttm_ebitda: float | None,
    ttm_eps: float | None,
    net_debt: float | None,
    shares: float | None,
    sector_multiples: dict[str, float] | None,
    quarters_used: int,
) -> dict | None:
    """Relative valuation against the median multiples of the company's sector.

    Answers "what would this be worth priced like its peers", a different
    question from the cash-flow models and the reason it sits beside them. It
    inherits whatever the sector is doing: if every peer is expensive, comps
    calls an expensive company fair.

    Averages the values implied by EV/EBITDA and P/E rather than preferring
    one. They fail in different places, so the average is steadier than either.
    """
    if quarters_used < 4 or not sector_multiples:
        return None

    share_count = _finite(shares)
    if share_count is None or share_count <= 0:
        return None

    implied: list[float] = []

    # EV/EBITDA -> enterprise value -> equity, by netting debt back out.
    ev_multiple = sector_multiples.get("ev_ebitda")
    ebitda = _finite(ttm_ebitda)
    if ev_multiple is not None and ebitda is not None and ebitda > 0:
        equity_value = ev_multiple * ebitda - (_finite(net_debt) or 0.0)
        if equity_value > 0:
            implied.append(equity_value / share_count)

    # P/E lands directly on a per-share value.
    pe_multiple = sector_multiples.get("pe")
    eps = _finite(ttm_eps)
    if pe_multiple is not None and eps is not None and eps > 0:
        implied.append(pe_multiple * eps)

    if not implied:
        return None

    return _verdict("comps", sum(implied) / len(implied), price, WEIGHT_COMPS)


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
    return _verdict(
        "rim", value, price, WEIGHT_RIM * min(1.0, quarters_used / 4)
    )


def damp_cashflow_confidence(verdicts: list[dict]) -> list[dict]:
    """Scale down confidence when both cash-flow models agree.

    FCFE and FCFF discount the same underlying cash generation by two different
    routes. Left alone they would give one methodology two votes in a
    weighted consensus, so each is scaled by 1/sqrt(n) when both fire.
    """
    cashflow_methods = {"fcfe", "fcff"}
    firing = [v for v in verdicts if v["method"] in cashflow_methods]
    if len(firing) <= 1:
        return verdicts

    scale = 1.0 / math.sqrt(len(firing))
    for verdict in firing:
        verdict["confidence"] = round(verdict["confidence"] * scale, 4)
    return verdicts
