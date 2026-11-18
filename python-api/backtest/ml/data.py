"""Shared data for the model scripts in backtest/ml.

They read the notebook's export (the last cell of notebooks/backtest.ipynb writes
it) rather than re-running the notebook: one row per (rebalance_date, ticker)
with every model output and signal the notebook builds.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

EXPORT = Path(__file__).resolve().parents[1] / "output" / "model_data.parquet"

TARGET = "fwd_adj_1m"  # realised alpha: next-month excess return minus what the FF5 betas predict
DEV_START = "2023-03-01"  # same development window as the notebook's tests

# Everything known at the rebalance date and comparable across firms (ratios, not dollar amounts).
# Composites built from these (alpha_combined, value_momentum, magic_formula, ...) are left out:
# a tree can combine the parts itself.
PREDICTORS = {
    "models": ["alpha_fcff", "alpha_rim", "alpha_rev", "alpha_shy", "comps_upside"],
    "plain ratios": ["fcf_yield", "book_to_price", "earnings_yield", "sales_to_ev", "shy_ratio",
                     "ev_ebitda_rel", "fwd_dcf_margin"],
    "other signals": ["momentum", "reversal", "low_vol", "roic", "ebit_ev", "surprise",
                      "gross_profitability", "low_accruals", "low_asset_growth"],
    "characteristics": ["g0", "roe", "margin", "payout", "debt_weight", "log_mcap", "staleness"],
    "betas": ["beta_capm", "beta_smb", "beta_hml", "beta_rmw", "beta_cma"],
}
FEATURES = [c for cols in PREDICTORS.values() for c in cols]


def load(split: str = "development") -> pd.DataFrame:
    """Rows of one split that have the target. The holdout is meant to be run once, after the spec is frozen."""
    if not EXPORT.exists():
        raise SystemExit(f"{EXPORT} not found: run the export cell at the end of notebooks/backtest.ipynb")
    d = pd.read_parquet(EXPORT)
    d["log_mcap"] = np.log(d["equity"].where(d["equity"] > 0))
    rows = (d["split"] == split) & d[TARGET].notna()
    if split == "development":
        rows &= d["rebalance_date"] >= DEV_START
    return d[rows].sort_values(["rebalance_date", "ticker"]).reset_index(drop=True)


def rank_by_date(d: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Percentile rank of each column within its rebalance date (NaN stays NaN).

    Removes drift in levels across dates (rates, market-wide valuations), so a split
    learned in 2023 means the same thing in 2024.
    """
    return d.groupby("rebalance_date")[cols].rank(pct=True)


def winsorize_by_date(d: pd.DataFrame, col: str, q: float = 0.01) -> pd.Series:
    """Clip a column to its [q, 1 - q] quantiles within each rebalance date."""
    by = d.groupby("rebalance_date")[col]
    return d[col].clip(by.transform("quantile", q), by.transform("quantile", 1 - q))
