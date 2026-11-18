"""Regression tree: predict realised alpha (next-month factor-adjusted return) from the notebook's signals.

Run from python-api/:   .venv/Scripts/python -m backtest.ml.tree

Test data comes from a date-block bootstrap. Each round draws the development rebalance
dates with replacement, fits on the drawn dates and scores on the dates never drawn
(out-of-bag, about 37% of them). Whole dates are resampled, not rows, because stocks on the
same date share that month's return shock: row-level OOB would score on months the tree
has already seen. Every depth is scored on the same draws, so the depths compare like for like.

Caveat: the bootstrap ignores time order, so a tree can learn from 2024 and be scored on 2023.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeRegressor, export_text

from backtest.ml.data import FEATURES, TARGET, load, rank_by_date, winsorize_by_date

DEPTHS = [1, 2, 3, 4, 6]
MIN_LEAF = 200  # smallest leaf, in stock-months. Small leaves fit noise in returns
N_BOOT = 200
SEED = 0
RANK_FEATURES = True  # percentile-rank each predictor within its date (see data.rank_by_date)
BASELINES = {"Combined alpha": "alpha_combined", "Value + momentum": "value_momentum",
             "Momentum + surprise": "momentum_surprise"}  # the tested blends a fitted model has to beat


def score(dates: np.ndarray, y: np.ndarray, p: np.ndarray) -> dict:
    """Out-of-sample R^2 against a zero forecast, mean per-date rank IC, and mean per-date
    top-minus-bottom quintile spread of the target."""
    ok = ~np.isnan(p)
    frame = pd.DataFrame({"date": dates[ok], "y": y[ok], "p": p[ok]})
    ics, spreads = [], []
    for _, g in frame.groupby("date"):
        if g["p"].nunique() > 1:
            ics.append(g["p"].corr(g["y"], method="spearman"))
            q = pd.qcut(g["p"].rank(method="first"), 5, labels=False)
            spreads.append(g.loc[q == 4, "y"].mean() - g.loc[q == 0, "y"].mean())
    return {"r2": 1 - ((frame["y"] - frame["p"]) ** 2).sum() / (frame["y"] ** 2).sum(),
            "ic": np.mean(ics) if ics else np.nan,
            "spread": np.mean(spreads) if spreads else np.nan}


def bootstrap(d: pd.DataFrame, X: np.ndarray, y: np.ndarray) -> pd.DataFrame:
    """One row per (round, model): OOB scores for each tree depth and each baseline signal."""
    rng = np.random.default_rng(SEED)
    dates = d["rebalance_date"].to_numpy()
    unique = np.unique(dates)
    rows = []
    for b in range(N_BOOT):
        drawn, counts = np.unique(rng.choice(unique, len(unique), replace=True), return_counts=True)
        weight = pd.Series(counts, index=drawn).reindex(dates, fill_value=0).to_numpy()  # a date drawn twice counts twice
        train, oob = weight > 0, weight == 0
        for depth in DEPTHS:
            tree = DecisionTreeRegressor(max_depth=depth, min_samples_leaf=MIN_LEAF, random_state=SEED)
            tree.fit(X[train], y[train], sample_weight=weight[train])
            rows.append({"round": b, "model": f"tree, depth {depth}", **score(dates[oob], y[oob], tree.predict(X[oob]))})
        for name, col in BASELINES.items():
            s = score(dates[oob], y[oob], d.loc[oob, col].to_numpy())
            rows.append({"round": b, "model": name, "ic": s["ic"], "spread": s["spread"]})  # a signal's R^2 has no meaning
    return pd.DataFrame(rows)


def summarise(rounds: pd.DataFrame) -> pd.DataFrame:
    """Mean and 90% bootstrap interval of each score, and how often each model beats the first baseline."""
    g = rounds.groupby("model", sort=False)
    lo, hi = g.quantile(0.05), g.quantile(0.95)
    ic = rounds.pivot(index="round", columns="model", values="ic")
    first = next(iter(BASELINES))
    return pd.DataFrame({
        "OOB R^2": g["r2"].mean(),
        "R^2 5%": lo["r2"], "R^2 95%": hi["r2"],
        "mean IC": g["ic"].mean(),
        "IC 5%": lo["ic"], "IC 95%": hi["ic"],
        "Q5-Q1 / month": g["spread"].mean(),
        f"beats {first} (share of rounds)": ic.gt(ic[first], axis=0).mean(),
    })


def main() -> None:
    d = load()
    X_frame = rank_by_date(d, FEATURES) if RANK_FEATURES else d[FEATURES]
    X = X_frame.to_numpy(dtype=float)
    y = winsorize_by_date(d, TARGET).to_numpy()  # fat tails would otherwise pick the splits

    print(f"{len(d):,} stock-months, {d['rebalance_date'].nunique()} development dates "
          f"({d['rebalance_date'].min():%b %Y} - {d['rebalance_date'].max():%b %Y}), {len(FEATURES)} predictors")
    print(f"target {TARGET}, winsorized 1/99% by date; predictors {'ranked by date' if RANK_FEATURES else 'raw'}; "
          f"{N_BOOT} date-block bootstrap rounds\n")

    rounds = bootstrap(d, X, y)
    table = summarise(rounds)
    with pd.option_context("display.width", 200, "display.max_columns", 20):
        print(table.round(4).to_string(), "\n")

    trees = table.index[table.index.str.startswith("tree")]
    best = table.loc[trees, "mean IC"].idxmax()
    depth = int(best.rsplit(" ", 1)[1])
    final = DecisionTreeRegressor(max_depth=depth, min_samples_leaf=MIN_LEAF, random_state=SEED).fit(X, y)
    print(f"Best by mean OOB IC: {best}. Fitted on every development date:\n")
    print(export_text(final, feature_names=FEATURES, decimals=4))

    importance = pd.Series(final.feature_importances_, index=FEATURES)
    print("Feature importance (share of squared-error reduction):")
    print(importance[importance > 0].sort_values(ascending=False).round(3).to_string())


if __name__ == "__main__":
    main()
