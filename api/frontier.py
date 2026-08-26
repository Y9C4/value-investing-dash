"""Mean-variance optimisation: trace the efficient frontier, find the tangency
portfolio on it, and decompose the risk of the result.

The frontier is traced as N separately solved minimum-variance portfolios
rather than a blend of two anchors, and the max-Sharpe portfolio is *found*
among them rather than solved for directly. `trace_frontier` explains why that
ordering matters.
"""

from __future__ import annotations

import time
from threading import Lock
from typing import NamedTuple

import numpy as np
import pandas as pd
from fastapi import HTTPException
from pypfopt import EfficientFrontier, expected_returns, objective_functions, risk_models

import config
import db
import market

# Per-stock cap for a full-index solve. It cannot be applied blindly to a
# screened subset: `sum(w) == 1` with `w <= cap` is infeasible unless
# `cap * n >= 1`, so 3% silently demands 34 names and the screener hands over
# as few as 5. `weight_cap` scales it instead.
MAX_STOCK_WEIGHT = 0.03
# Require at most n/1.5 holdings, so the cap never binds every weight at once.
# A cap of exactly 1/n is feasible but degenerate: every name is pinned to it
# and the "optimisation" can only return the equal-weight portfolio.
CAP_SLACK = 1.5
# Historical mean returns are clipped before use; an extreme estimate would
# otherwise dominate the whole allocation.
MU_CLIP = 0.50

ENVELOPE_POINTS = 100
MIN_ENVELOPE_POINTS = 2
# Every point is a real solve (~0.3s over the full index), so this reflects
# solver cost. Must stay in step with MAX_PORTFOLIOS in lib/portfolio-settings.ts.
MAX_ENVELOPE_POINTS = 200
# Below this the covariance matrix is too small to say anything about
# diversification.
MIN_FRONTIER_TICKERS = 5
# Share of the window a ticker needs to be optimised over. CovarianceShrinkage
# zero-fills missing returns, so a recent listing arrives wearing a fraction of
# its true volatility and gets loaded up on. Dropping it is more honest.
MIN_HISTORY_COVERAGE = 0.9
# Return span below which the frontier collapses to a single point.
RETURN_SPAN_EPSILON = 1e-6

# L2 regularisation, added as `gamma * ||w||^2`.
#
# A box-constrained mean-variance solve puts its optimum on a vertex of the
# feasible set: most weights come back at exactly zero, the survivors at
# exactly the cap, and nudging one input reshuffles which names those are. The
# L2 term is strictly convex, so it pulls the solution off that vertex.
DEFAULT_L2_GAMMA = 0.0
MAX_L2_GAMMA = 5.0

# Ternary-search passes refining the tangency off the grid. Each costs two
# solves; eight shrink the bracket to ~4% of a grid step. The point is not
# precision for its own sake — it guarantees the tangency is at least as good
# as every plotted point, so the capital market line cannot cut through the
# curve it is supposed to touch.
TANGENCY_REFINEMENT_STEPS = 8
# How far past the frontier the capital market line runs (levered portfolios).
CML_LEVERAGE_EXTENSION = 1.4

SECTOR_CACHE_TTL_SECONDS = 900
_sector_cache: dict[str, str] | None = None
_sector_stamp: float = 0.0
_sector_lock = Lock()


def weight_cap(n_assets: int) -> float:
    """The per-stock cap actually enforceable over `n_assets` names.

    Widening to `CAP_SLACK / n` for small universes keeps the intent (no name
    dominates) while guaranteeing the feasible set is non-empty.
    """
    return max(MAX_STOCK_WEIGHT, CAP_SLACK / n_assets)


class Constraints(NamedTuple):
    """What the solver was actually told, after defaults and feasibility.

    Kept as one value so every solve in a trace provably shares the same rules.
    The anchors, the sweep and the tangency refinement each build their own
    `EfficientFrontier`, and points solved under different constraints are not
    a frontier.
    """

    lower: float
    upper: float
    gamma: float


def resolve_constraints(
    n_assets: int,
    short_allowed: bool,
    min_weight: float | None,
    max_weight: float | None,
    gamma: float,
) -> Constraints:
    """Turn the request's position-size controls into bounds a solve can meet.

    An upper bound below `1/n` cannot sum to a whole portfolio and a lower
    bound above `1/n` cannot either. Both are infeasible rather than merely
    strict, and CVXPY reports infeasibility as an opaque solver failure, so
    they are caught here where the message can name the number to change.

    Omitting a bound reproduces the behaviour from before the controls existed:
    the cap scales to the universe, and the floor is zero or, with shorting on,
    the mirror of the cap.
    """
    if not 0.0 <= gamma <= MAX_L2_GAMMA:
        raise HTTPException(
            status_code=422, detail=f"gamma must be between 0 and {MAX_L2_GAMMA}."
        )

    upper = weight_cap(n_assets) if max_weight is None else float(max_weight)
    if min_weight is None:
        lower = -upper if short_allowed else 0.0
    else:
        lower = float(min_weight)

    if not -1.0 <= lower <= 1.0 or not -1.0 <= upper <= 1.0:
        raise HTTPException(
            status_code=422, detail="Position sizes must be between -100% and 100%."
        )
    if lower > upper:
        raise HTTPException(
            status_code=422,
            detail=f"Minimum position ({lower:.2%}) is above the maximum ({upper:.2%}).",
        )

    # Report the threshold, not the violation, so there is something to type
    # into the box.
    if upper * n_assets < 1.0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"A {upper:.2%} maximum position cannot fill a portfolio of "
                f"{n_assets} stocks — the weights would sum to at most "
                f"{upper * n_assets:.0%}. Raise it to at least "
                f"{1.0 / n_assets:.2%}, or screen for fewer stocks."
            ),
        )
    if lower * n_assets > 1.0:
        raise HTTPException(
            status_code=422,
            detail=(
                f"A {lower:.2%} minimum position across {n_assets} stocks "
                f"already commits {lower * n_assets:.0%} of the portfolio. "
                f"Lower it to at most {1.0 / n_assets:.2%}."
            ),
        )

    return Constraints(lower=lower, upper=upper, gamma=float(gamma))


def _make_frontier(
    mu: pd.Series, S: pd.DataFrame, constraints: Constraints
) -> EfficientFrontier:
    """Build an EfficientFrontier under one shared set of constraints.

    The bounds go in as PyPortfolioOpt's own `weight_bounds` rather than as an
    added constraint, so an asymmetric range (a -1% floor against a 5% cap)
    means what it says. Bounding shorts symmetrically via `|w| <= cap` quietly
    made the floor unreachable from the API.
    """
    ef = EfficientFrontier(
        mu, S, weight_bounds=(constraints.lower, constraints.upper), solver="CLARABEL"
    )
    if constraints.gamma > 0:
        ef.add_objective(objective_functions.L2_reg, gamma=constraints.gamma)
    return ef


def _stats(
    weights: np.ndarray, mu: pd.Series, S: pd.DataFrame, risk_free_rate: float
) -> tuple[float, float, float]:
    """Return, volatility and Sharpe for any weight vector, evaluated against
    mu/S directly rather than via a solve."""
    annual_return = float(weights @ mu.values)
    volatility = float(np.sqrt(weights @ S.values @ weights))
    sharpe = (annual_return - risk_free_rate) / volatility if volatility else 0.0
    return annual_return, volatility, sharpe


def _solve_at_return(
    ef: EfficientFrontier, target: float, mu: pd.Series
) -> np.ndarray | None:
    """Minimum-variance weights subject to a return floor, or None if the
    target is out of reach.

    Called repeatedly on one `EfficientFrontier`: the first call builds the
    CVXPY problem and later ones only rebind the target, which is what makes
    sweeping the whole frontier affordable.
    """
    try:
        ef.efficient_return(target_return=float(target))
    except Exception:  # noqa: BLE001 - an unreachable target is not an error
        return None
    return pd.Series(ef.clean_weights()).reindex(mu.index).fillna(0.0).values


def trace_frontier(
    mu: pd.Series,
    S: pd.DataFrame,
    risk_free_rate: float,
    constraints: Constraints,
    n_points: int,
) -> list[dict]:
    """`n_points` genuinely solved portfolios, minimum volatility to maximum return.

    Not `max_sharpe`, and not a blend of two anchors. Both were tried.

    `EfficientFrontier.max_sharpe` re-parameterises the problem so that
    `(mu - rf) @ w == 1`, which has no solution when the constraints admit no
    portfolio out-earning the risk-free rate. A value screen selects names on
    weak trailing returns and the per-stock cap forces enough of them in, so
    that happened routinely and took the whole response down with it.

    Minimising variance at a target return is instead feasible for any target
    inside the attainable range, and the tangency is found among the results
    rather than solved for. When nothing beats the risk-free rate the best
    Sharpe is simply negative, which is a true statement about the screened set.

    A blend of two anchors was never the frontier either: it is a chord across a
    convex set, 25-50bp inside the real curve, and it stopped at the tangency so
    the high-return arm was never drawn.
    """
    ef = _make_frontier(mu, S, constraints)
    ef.min_volatility()
    floor_weights = pd.Series(ef.clean_weights()).reindex(mu.index).fillna(0.0).values
    return_floor = float(floor_weights @ mu.values)

    # `_max_return` mutates the instance it runs on, so it gets a throwaway.
    return_ceiling = float(_make_frontier(mu, S, constraints)._max_return())

    def described(weights: np.ndarray) -> dict:
        annual_return, volatility, sharpe = _stats(weights, mu, S, risk_free_rate)
        return {
            "return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "weights": weights,
        }

    if return_ceiling - return_floor <= RETURN_SPAN_EPSILON:
        return [described(floor_weights)]

    sweep = _make_frontier(mu, S, constraints)
    points = [described(floor_weights)]

    # The ceiling came from a different instance, so the last target is pulled
    # a hair inside it rather than risking rejection on a rounding difference.
    span = return_ceiling - return_floor
    targets = np.linspace(return_floor, return_ceiling - span * 1e-9, n_points)
    for target in targets[1:]:
        weights = _solve_at_return(sweep, target, mu)
        if weights is not None:
            points.append(described(weights))

    return points


def refine_tangency(
    points: list[dict],
    mu: pd.Series,
    S: pd.DataFrame,
    risk_free_rate: float,
    constraints: Constraints,
) -> dict:
    """The maximum-Sharpe portfolio, found on the frontier and then sharpened.

    Sharpe is unimodal along the frontier, so a ternary search over the
    bracketing interval closes the last grid step for a dozen extra solves.
    Worth it because the capital market line is drawn through this point, and a
    visibly non-tangent CML is the one thing the chart must not show.
    """
    best_index = max(range(len(points)), key=lambda i: points[i]["sharpe"])
    best = points[best_index]

    if len(points) < 3:
        return best

    low = points[max(best_index - 1, 0)]["return"]
    high = points[min(best_index + 1, len(points) - 1)]["return"]
    if high - low <= RETURN_SPAN_EPSILON:
        return best

    sweep = _make_frontier(mu, S, constraints)

    def sharpe_at(target: float) -> dict | None:
        weights = _solve_at_return(sweep, target, mu)
        if weights is None:
            return None
        annual_return, volatility, sharpe = _stats(weights, mu, S, risk_free_rate)
        return {
            "return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "weights": weights,
        }

    for _ in range(TANGENCY_REFINEMENT_STEPS):
        if high - low <= RETURN_SPAN_EPSILON:
            break
        left_target = low + (high - low) / 3.0
        right_target = high - (high - low) / 3.0
        left, right = sharpe_at(left_target), sharpe_at(right_target)
        if left is None or right is None:
            break
        for candidate in (left, right):
            if candidate["sharpe"] > best["sharpe"]:
                best = candidate
        if left["sharpe"] < right["sharpe"]:
            low = left_target
        else:
            high = right_target

    return best


def risk_contributions(weights: np.ndarray, S: pd.DataFrame) -> dict[str, float]:
    """Each holding's share of portfolio variance, summing to 1.

    Weight is not risk: a 3% position in a volatile, everything-correlated name
    can carry several times the risk of a 3% position in a defensive one.

    The Euler decomposition `w_i * (Sw)_i / (w'Sw)`, exact rather than an
    approximation because variance is homogeneous of degree two. A negative
    contribution is a real result — a short or a hedge reducing total variance
    — and is reported rather than clipped.
    """
    variance = float(weights @ S.values @ weights)
    if variance <= 0:
        return {}
    marginal = S.values @ weights
    return {
        ticker: float(weights[index] * marginal[index] / variance)
        for index, ticker in enumerate(S.index)
    }


def sector_map() -> dict[str, str]:
    """Ticker -> sector, cached, and never allowed to fail a solve.

    Sector labels let the page show that a mathematically diversified portfolio
    is three-quarters one sector, which is what mean-variance optimisation is
    worst at advertising. They are decoration on the response, so a read
    failure yields an empty map and the page omits the breakdown.
    """
    global _sector_cache, _sector_stamp

    with _sector_lock:
        if (
            _sector_cache is not None
            and time.time() - _sector_stamp <= SECTOR_CACHE_TTL_SECONDS
        ):
            return _sector_cache

    try:
        rows = db.fetch_all_rows("company_profile", "ticker, sector")
    except Exception:  # noqa: BLE001 - decoration must not fail the solve
        return {}

    mapping = {
        row["ticker"]: row.get("sector") or "Unclassified"
        for row in rows
        if row.get("ticker")
    }
    with _sector_lock:
        _sector_cache = mapping
        _sector_stamp = time.time()
    return mapping


def _select_universe(tickers: list[str] | None) -> list[str]:
    """The tickers to optimise over, intersected with the known index.

    ^GSPC is deliberately absent: it is an index, not an investable holding.
    Too few known names is refused rather than silently falling back to the
    full index, which would misreport what was solved.
    """
    if not tickers:
        return config.SP500_TICKERS

    requested = {t.strip().upper() for t in tickers if t.strip()}
    universe = [t for t in config.SP500_TICKERS if t.upper() in requested]

    if len(universe) < MIN_FRONTIER_TICKERS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Need at least {MIN_FRONTIER_TICKERS} known tickers to build a "
                f"frontier; got {len(universe)}."
            ),
        )
    return universe


def _drop_short_history(
    prices: pd.DataFrame, universe: list[str]
) -> tuple[pd.DataFrame, list[str]]:
    """Drop tickers without enough of the window, and say which.

    A part-way listing reaches the covariance estimator with its missing
    returns zero-filled, which reads as unnaturally low risk and attracts
    weight the company never earned.
    """
    coverage = prices.notna().sum() / len(prices.index)
    excluded = sorted(coverage.index[coverage < MIN_HISTORY_COVERAGE])
    kept = prices[coverage.index[coverage >= MIN_HISTORY_COVERAGE]]

    if kept.shape[1] < MIN_FRONTIER_TICKERS:
        # Name the dropped tickers, or this reads as "your 5 stocks are somehow
        # only 4", which is not something a reader can act on.
        because = (
            f" {', '.join(excluded)} "
            f"{'was' if len(excluded) == 1 else 'were'} excluded for having "
            f"under {MIN_HISTORY_COVERAGE:.0%} of the price history the risk "
            f"model needs."
            if excluded
            else ""
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {kept.shape[1]} of the {len(universe)} requested tickers "
                f"can be optimised; need {MIN_FRONTIER_TICKERS}.{because}"
            ),
        )

    return kept, excluded


def _summarise(point: dict, index: pd.Index) -> dict:
    """One frontier point as JSON: stats plus its non-trivial weights."""
    weights = pd.Series(point["weights"], index=index)
    holdings = weights[weights.abs() > 1e-4].sort_values(ascending=False)
    return {
        "return": point["return"],
        "volatility": point["volatility"],
        "sharpe": point["sharpe"],
        "weights": {t: round(float(w), 4) for t, w in holdings.items()},
    }


def _capital_market_line(
    tangency: dict, envelope: list[dict], risk_free_rate: float
) -> list[dict]:
    """Risk-free asset through the tangency portfolio, extended into leverage.

    Withheld when nothing out-earns the risk-free asset: the line would slope
    downwards and imply that taking risk pays negatively.
    """
    if tangency["sharpe"] <= 0 or not tangency["volatility"]:
        return []

    slope = (tangency["return"] - risk_free_rate) / tangency["volatility"]
    reach = max(point["volatility"] for point in envelope) * CML_LEVERAGE_EXTENSION
    return [
        {"volatility": volatility, "return": risk_free_rate + slope * volatility}
        for volatility in (0.0, reach)
    ]


def build(
    short_allowed: bool,
    n_portfolios: int = ENVELOPE_POINTS,
    tickers: list[str] | None = None,
    min_weight: float | None = None,
    max_weight: float | None = None,
    gamma: float = DEFAULT_L2_GAMMA,
) -> dict:
    """Solve the efficient frontier over a universe of stocks.

    `tickers` narrows the optimisation to a screened subset, which is the whole
    point of screening first: the optimiser can only allocate into companies
    that passed a value filter, so it cannot chase a stock that is merely
    rising fast. None optimises the full index.

    `min_weight`, `max_weight` and `gamma` shape the solve — the first two are
    the box the weights live in, the third is how hard the solution is pushed
    off its corners. All three apply identically to every solve in the trace,
    which is what makes the points a single frontier.
    """
    if not MIN_ENVELOPE_POINTS <= n_portfolios <= MAX_ENVELOPE_POINTS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"n_portfolios must be between {MIN_ENVELOPE_POINTS} and "
                f"{MAX_ENVELOPE_POINTS}"
            ),
        )

    universe = _select_universe(tickers)
    prices, excluded = _drop_short_history(market.prices_df(universe), universe)

    mu = expected_returns.mean_historical_return(prices).clip(
        lower=-MU_CLIP, upper=MU_CLIP
    )
    S = risk_models.CovarianceShrinkage(prices).ledoit_wolf()
    risk_free_rate = market.average_risk_free_rate()
    constraints = resolve_constraints(
        int(prices.shape[1]), short_allowed, min_weight, max_weight, gamma
    )

    points = trace_frontier(mu, S, risk_free_rate, constraints, n_portfolios)
    tangency = refine_tangency(points, mu, S, risk_free_rate, constraints)

    max_sharpe = _summarise(tangency, mu.index)
    # Only for the tangency: it is the one the page presents as "the" portfolio.
    contributions = risk_contributions(tangency["weights"], S)
    max_sharpe["risk_contributions"] = {
        ticker: round(contributions[ticker], 4)
        for ticker in max_sharpe["weights"]
        if ticker in contributions
    }

    envelope = [
        {
            # Position along the frontier, not a blend weight — it was one when
            # two anchors were interpolated, and the chart still orders by it.
            "t": float(index / (len(points) - 1)) if len(points) > 1 else 0.0,
            "return": point["return"],
            "volatility": point["volatility"],
            "sharpe": point["sharpe"],
        }
        for index, point in enumerate(points)
    ]

    return {
        "short_allowed": short_allowed,
        "n_portfolios": len(points),
        "n_assets": int(prices.shape[1]),
        "risk_free_rate": risk_free_rate,
        # Reported because they are not always what was asked for: over a small
        # screened set the cap has to widen for the problem to have a solution,
        # and the reader is owed the constraints that were actually used.
        "max_stock_weight": constraints.upper,
        "min_stock_weight": constraints.lower,
        "l2_gamma": constraints.gamma,
        "excluded_short_history": excluded,
        "sectors": {
            ticker: sector
            for ticker, sector in sector_map().items()
            if ticker in max_sharpe["weights"]
        },
        "tangency_beats_risk_free": max_sharpe["sharpe"] > 0,
        "max_sharpe": max_sharpe,
        # The trace runs upward from the minimum-variance portfolio, so its
        # first point is that anchor by construction.
        "min_volatility": _summarise(points[0], mu.index),
        "capital_market_line": _capital_market_line(
            max_sharpe, envelope, risk_free_rate
        ),
        "envelope": envelope,
    }
