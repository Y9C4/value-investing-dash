"""Mean-variance optimisation: trace the efficient frontier, find the tangency
portfolio on it, and decompose the risk of the result.

The frontier is traced as N separately solved minimum-variance portfolios
rather than a blend of two anchors, and the max-Sharpe portfolio is *found*
among them rather than solved for directly. `trace_frontier` explains why that
ordering matters.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
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

# The default resolution, and the one the nightly precompute stores.
#
# These have to be the same number, and were not. The cache key is built from
# the *resolved* point count, so a page asking for 8 points over the full index
# resolved to 8 and looked up a key the precompute (which resolved 100 down to
# the budget cap of 22) had never written. The default visit therefore missed
# the snapshot it exists for and paid a full solve: 64.7s measured on Cloud
# Run, against 0.3s for the same curve served from the snapshot.
#
# So this is now the single definition of "default resolution", shared by the
# service default, the precompute, and DEFAULT_PORTFOLIOS in
# lib/portfolio-settings.ts. Changing it in one place without the other
# silently reintroduces the miss.
#
# A request for N returns N-1 points over the full index: the maximum-return
# target is infeasible under the universe-scaled weight cap, so the trace
# drops it. Measured on Cloud Run against the whole index:
#
#   requested  points  tangency Sharpe
#           3       2           2.8014
#           4       3           2.9478
#           6       5           2.9478
#          22      21           2.9478
#
# The *tangency* converges by three or four points, and at two the envelope is
# a chord between the minimum-volatility anchor and the far end — precisely
# the construction the README's own write-up explains is wrong, costing 470bp
# of Sharpe on the figure this page leads with. But the shipped default is
# read as a curve, not just a correct tangency, and every solved point now
# carries its own marker on the chart: three or four of them reads as a
# handful of straight segments. Ten is the smallest count that looks like a
# frontier while staying far under the point budget for any screened set.
ENVELOPE_POINTS = 10
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

# Points x assets a single request may spend.
#
# Cost grows with the number of points and superlinearly with the number of
# assets, so neither dimension can be capped on its own: 200 points over 20
# names is a quarter of a second, and 200 points over the full index is 37
# seconds of two-vCPU time. Budgeting the product leaves the interesting case —
# a screened set of a few dozen names — at full resolution, while the full
# index cannot cost more than a few seconds however the request is written.
#
# 12,000 gives 24 points over 493 names (~5s), 120 over 100, and the full 200
# under 60. Deliberately not a rate limit: it is a statement about what a
# frontier costs, applied identically to every caller.
POINT_BUDGET = 12_000

# Rolling window and ceiling for the service's total solve time.
#
# The scarce resource on a scale-to-zero host is vCPU-seconds, so the global
# limit is denominated in them rather than in a request count, which would
# price a 20-name solve the same as a full-index one. 600s an hour is roughly
# four times a plausible busy hour and about 5% of a day's free-tier
# allowance, so it only ever fires on abuse.
SOLVE_BUDGET_SECONDS = 600.0
SOLVE_BUDGET_WINDOW_SECONDS = 3600.0
_solve_log: deque[tuple[float, float]] = deque()
_solve_budget_lock = Lock()

# Solves are pure functions of the stored prices and the constraints, and the
# prices change once a day. Small because each entry is a full envelope.
SOLVE_CACHE_TTL_SECONDS = 900
SOLVE_CACHE_MAX_ENTRIES = 8
_solve_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_solve_cache_lock = Lock()


def resolve_point_count(requested: int, n_assets: int) -> tuple[int, bool]:
    """The number of envelope points actually affordable, and whether it was cut.

    Measured against the requested universe rather than the post-history-filter
    one so the answer is known before the expensive price read, which is what
    lets it key the cache too. The difference is a handful of names.
    """
    allowed = max(
        MIN_ENVELOPE_POINTS,
        min(MAX_ENVELOPE_POINTS, POINT_BUDGET // max(n_assets, 1)),
    )
    return min(requested, allowed), requested > allowed


def _spend_solve_budget(seconds: float) -> None:
    """Record the cost of a completed solve against the rolling window."""
    now = time.monotonic()
    with _solve_budget_lock:
        _solve_log.append((now, seconds))


def check_solve_budget() -> None:
    """Refuse a solve once the service has spent its hour, and say for how long.

    Charged after the fact, so the request that crosses the line is served and
    the next one is refused. A pre-emptive estimate would have to be
    conservative and would start refusing legitimate traffic early.
    """
    now = time.monotonic()
    with _solve_budget_lock:
        while _solve_log and now - _solve_log[0][0] > SOLVE_BUDGET_WINDOW_SECONDS:
            _solve_log.popleft()
        spent = sum(seconds for _, seconds in _solve_log)
        oldest = _solve_log[0][0] if _solve_log else now

    if spent < SOLVE_BUDGET_SECONDS:
        return

    retry_after = max(1, int(SOLVE_BUDGET_WINDOW_SECONDS - (now - oldest)))
    raise HTTPException(
        status_code=429,
        detail=(
            "The optimiser has used its hourly compute budget "
            f"({spent:.0f}s of {SOLVE_BUDGET_SECONDS:.0f}s). Cached and "
            "precomputed frontiers are still being served. Try again in "
            f"{retry_after // 60 + 1} minutes."
        ),
        headers={"Retry-After": str(retry_after)},
    )


def cache_key(
    universe: list[str],
    short_allowed: bool,
    min_weight: float | None,
    max_weight: float | None,
    gamma: float,
    n_points: int,
) -> str:
    """A stable fingerprint of everything a solve depends on.

    Built from the request rather than the resolved constraints because those
    are only known after the price read, and the whole value of the key is
    being able to skip that read.
    """
    payload = json.dumps(
        {
            "tickers": sorted(t.upper() for t in universe),
            "short": short_allowed,
            "min": min_weight,
            "max": max_weight,
            "gamma": round(float(gamma), 6),
            "points": n_points,
        },
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


# The default frontier is also stored under this fixed key, so a caller that is
# not this process can find it. The hash above is fine for Python, which owns
# the function that builds it; asking the dashboard to reproduce the same
# canonical JSON and digest in TypeScript would be a contract in two languages
# that fails silently the first time either side reorders a field.
DEFAULT_SNAPSHOT_KEY = "default"


def clear_solve_cache() -> None:
    """Called after a price backfill: yesterday's frontier is not today's."""
    with _solve_cache_lock:
        _solve_cache.clear()


def _cached_solve(key: str) -> dict | None:
    """An in-process hit, or a stored snapshot promoted into the process.

    Two tiers because they answer different questions. The in-process entry
    covers a reader clicking the same button twice; `frontier_snapshot` covers
    the first visitor after a cold start, which on a scale-to-zero host is most
    of them. The snapshot read is a primary-key lookup and its failure is
    ignored — a missing cache is a slow answer, not a wrong one.
    """
    now = time.monotonic()
    with _solve_cache_lock:
        entry = _solve_cache.get(key)
        if entry is not None:
            stamp, payload = entry
            if now - stamp <= SOLVE_CACHE_TTL_SECONDS:
                _solve_cache.move_to_end(key)
                return payload
            del _solve_cache[key]

    try:
        # One attempt, deliberately not `db.read`. That wrapper retries a
        # dropped connection over ~1.75s of backoff, which is the right trade
        # for a read the answer depends on and the wrong one for a cache probe:
        # a slow miss here would be added to the solve it was meant to avoid.
        rows = (
            db.client()
            .table("frontier_snapshot")
            .select("payload")
            .eq("cache_key", key)
            .limit(1)
            .execute()
            .data
        )
    except Exception:  # noqa: BLE001 - an absent cache is not a failure
        return None

    if not rows:
        return None

    payload = rows[0]["payload"]
    _store_solve(key, payload)
    return payload


def _store_solve(key: str, payload: dict) -> None:
    with _solve_cache_lock:
        _solve_cache[key] = (time.monotonic(), payload)
        _solve_cache.move_to_end(key)
        while len(_solve_cache) > SOLVE_CACHE_MAX_ENTRIES:
            _solve_cache.popitem(last=False)


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


def _market_reference(
    prices: pd.DataFrame, risk_free_rate: float
) -> dict | None:
    """The S&P 500 itself, scored the same way a portfolio is.

    The point of optimising is to beat the index on a risk-adjusted basis, so
    the index has to be measured on the same terms as the thing being compared
    to it: same date range, same estimators. `prices` is expected to be a
    single-column frame for `config.SP500_INDEX_TICKER`, already aligned to
    the exact dates the portfolio's own `mu`/`S` were computed from — pulling
    it from a different window or a different formula (there is an existing
    `market.expected_market_return()`, on a one-year log-return basis, used
    elsewhere for CAPM) would flatter or punish the comparison by construction
    rather than by anything true about either side.

    None when the index has no usable price history for the window, which is
    a data gap rather than something to fail the whole solve over: the
    portfolio is still real without a benchmark to draw beside it.
    """
    prices = prices.dropna()
    if len(prices) < 2:
        return None

    try:
        mu = expected_returns.mean_historical_return(prices).iloc[0]
        S = risk_models.CovarianceShrinkage(prices).ledoit_wolf()
    except ValueError:
        # A too-short or degenerate window is a data gap, not a reason to
        # 500 a request that would otherwise have solved fine.
        return None

    volatility = float(np.sqrt(S.iloc[0, 0]))
    sharpe = (mu - risk_free_rate) / volatility if volatility else 0.0
    return {"return": float(mu), "volatility": volatility, "sharpe": float(sharpe)}


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


def _with_risk(summary: dict, weights: np.ndarray, S: pd.DataFrame) -> dict:
    """Attach the variance decomposition to an already-summarised point.

    Keyed to the summary's own surviving holdings rather than the whole
    universe, so it lines up with the weights beside it and carries no rows
    for names the point does not hold.
    """
    contributions = risk_contributions(weights, S)
    summary["risk_contributions"] = {
        ticker: round(contributions[ticker], 4)
        for ticker in summary["weights"]
        if ticker in contributions
    }
    return summary


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
    scheduled: bool = False,
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

    `scheduled` marks a solve started by a backfill rather than a visitor: it
    must not read the cache, since replacing that cache is the whole point of
    running it, and it must not be refused by a budget meant to bound what
    visitors can spend.
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
    n_points, capped = resolve_point_count(n_portfolios, len(universe))

    key = cache_key(universe, short_allowed, min_weight, max_weight, gamma, n_points)

    # What was asked for is a property of the request, not of the solve, so it
    # is layered on at the end rather than stored. Two callers asking for 40 and
    # for 200 over the whole index are answered by the same 23-point curve, and
    # each has to be told the number they themselves typed.
    def answered(payload: dict, from_cache: bool) -> dict:
        return {
            **payload,
            "n_portfolios_requested": n_portfolios,
            "resolution_capped": capped,
            "cached": from_cache,
        }

    cached = None if scheduled else _cached_solve(key)
    if cached is not None:
        # Served before the budget check on purpose: a cache hit costs no CPU,
        # so refusing it would rate-limit the one path that is free. It is also
        # the path behind the screener's headline call to action.
        return answered(cached, True)

    if not scheduled:
        check_solve_budget()
    started = time.monotonic()

    # The index rides along in the same fetch — one more column, the same
    # parallel/cached read — rather than a separate round trip. Split off
    # before `_drop_short_history`, which reports on the *requested* universe
    # and would misreport "5 of 5 requested tickers" as "5 of 6".
    raw = market.prices_df([*universe, config.SP500_INDEX_TICKER])
    index_prices = raw[[config.SP500_INDEX_TICKER]]
    prices, excluded = _drop_short_history(raw[universe], universe)

    mu = expected_returns.mean_historical_return(prices).clip(
        lower=-MU_CLIP, upper=MU_CLIP
    )
    S = risk_models.CovarianceShrinkage(prices).ledoit_wolf()
    risk_free_rate = market.average_risk_free_rate()
    # Realigned to `prices.index` rather than used as fetched: the shared
    # frame's date range is the union across every ticker in the request, and
    # the portfolio's own window is `prices.index` post-history-filter. Scoring
    # the index over dates the portfolio was not evaluated on would be a
    # second, silent way for the two figures to disagree.
    market_reference = _market_reference(
        index_prices.reindex(prices.index), risk_free_rate
    )
    constraints = resolve_constraints(
        int(prices.shape[1]), short_allowed, min_weight, max_weight, gamma
    )

    points = trace_frontier(mu, S, risk_free_rate, constraints, n_points)
    tangency = refine_tangency(points, mu, S, risk_free_rate, constraints)

    max_sharpe = _with_risk(_summarise(tangency, mu.index), tangency["weights"], S)

    # Hoisted rather than inlined into the `sectors` comprehension below, where
    # it would be rebuilt once per candidate ticker: ~500 rebuilds of a
    # 499-element set, measured at 18.6ms against 0.1ms for this.
    solved_universe = set(mu.index)

    # Every solved point, summarised exactly the way the anchors are.
    #
    # The envelope used to carry four floats per point and drop the weights the
    # solve had just produced, which made the two anchors the only portfolios on
    # the curve the page could actually describe. The page now lets a reader
    # select any point on the frontier, and a point without weights is one that
    # cannot be selected. Nothing here is newly computed: `trace_frontier`
    # already solved each point's weights, and the variance decomposition is a
    # matrix-vector product against a covariance matrix that is already in
    # memory — next to the QP behind every point, it is free.
    summaries = [
        _with_risk(_summarise(point, mu.index), point["weights"], S)
        for point in points
    ]

    envelope = [
        {
            # Position along the frontier, not a blend weight — it was one when
            # two anchors were interpolated, and the chart still orders by it.
            "t": float(index / (len(points) - 1)) if len(points) > 1 else 0.0,
            **summary,
        }
        for index, summary in enumerate(summaries)
    ]

    payload = {
        "short_allowed": short_allowed,
        "n_portfolios": len(points),
        # The budget that decided the resolution. Reported rather than silently
        # applied: a capped curve is a stated engineering constraint, and the
        # page says so next to the chart.
        "point_budget": POINT_BUDGET,
        "n_assets": int(prices.shape[1]),
        "risk_free_rate": risk_free_rate,
        # Reported because they are not always what was asked for: over a small
        # screened set the cap has to widen for the problem to have a solution,
        # and the reader is owed the constraints that were actually used.
        "max_stock_weight": constraints.upper,
        "min_stock_weight": constraints.lower,
        "l2_gamma": constraints.gamma,
        "excluded_short_history": excluded,
        # The benchmark every portfolio on this curve is implicitly competing
        # with. None when the index had no usable price data for the window —
        # a gap the frontend already knows how to read as "not drawn" rather
        # than as a zero.
        "market": market_reference,
        # Keyed to the solved universe, not to the tangency's holdings. Any
        # point on the curve can now be the one on screen, and a point holding
        # a name the tangency happens not to hold would otherwise have had its
        # sector silently missing from the breakdown.
        "sectors": {
            ticker: sector
            for ticker, sector in sector_map().items()
            if ticker in solved_universe
        },
        "tangency_beats_risk_free": max_sharpe["sharpe"] > 0,
        "max_sharpe": max_sharpe,
        # The trace runs upward from the minimum-variance portfolio, so its
        # first point is that anchor by construction — the same object as
        # `envelope[0]`, which is why selecting either must highlight one mark
        # rather than two.
        "min_volatility": summaries[0],
        "capital_market_line": _capital_market_line(
            max_sharpe, envelope, risk_free_rate
        ),
        "envelope": envelope,
    }

    if not scheduled:
        _spend_solve_budget(time.monotonic() - started)
    _store_solve(key, payload)
    return answered(payload, False)


def precompute_default() -> dict:
    """Solve and store the frontier the screener's primary button asks for.

    Run at the end of a valuations backfill, when the prices it depends on
    have just changed. The full-index default is both the most expensive solve
    the service offers and the one most likely to be the first thing a visitor
    clicks, so it is the one worth paying for on a schedule instead of on a
    page load.

    Reports rather than raises: this is an optimisation attached to the end of
    an ingest job, and a failure here must not mark the ingest failed.
    """
    started = time.monotonic()

    n_points, _ = resolve_point_count(ENVELOPE_POINTS, len(config.SP500_TICKERS))
    key = cache_key(config.SP500_TICKERS, False, None, None, DEFAULT_L2_GAMMA, n_points)

    try:
        payload = build(False, ENVELOPE_POINTS, scheduled=True)
        stamp = datetime.now(timezone.utc).isoformat()
        # Two rows, one payload. The hashed key is what this service's own
        # cache probe looks up; the stable key is what the dashboard reads
        # straight from Postgres when the solver is asleep.
        db.client().table("frontier_snapshot").upsert(
            [
                {"cache_key": key, "payload": payload, "computed_at": stamp},
                {
                    "cache_key": DEFAULT_SNAPSHOT_KEY,
                    "payload": payload,
                    "computed_at": stamp,
                },
            ],
            on_conflict="cache_key",
            ignore_duplicates=False,
        ).execute()
    except Exception as exc:  # noqa: BLE001 - see docstring
        return {"failed": True, "detail": f"{type(exc).__name__}: {exc}"}

    return {
        "cache_key": key,
        "n_portfolios": payload["n_portfolios"],
        "n_assets": payload["n_assets"],
        "duration_seconds": round(time.monotonic() - started, 1),
    }
