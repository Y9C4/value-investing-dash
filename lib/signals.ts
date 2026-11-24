/**
 * The signal layer: what the backtest found ranks stocks, as shown on the
 * screener (python-api/notebooks/backtests.md §13, §16).
 *
 * Three components, each a percentile within today's universe, computed in the
 * warehouse (`warehouse.signals`). The screener's score is the mean percentile
 * of the components switched on — the same arithmetic the blends were tested
 * with — so value + momentum here is the value + momentum of the backtest.
 *
 * Percentiles rather than the raw numbers because test 4 found the size of
 * expected alpha meaningless (calibration slope 0.17). A rank is what the
 * evidence supports; a forecast return is not.
 */

import type { Stock } from "@/lib/valuation"

export type SignalId = "value" | "momentum" | "surprise"

export type SignalComponent = {
  id: SignalId
  label: string
  full: string
  /** One line on what it measures, for the methodology popover. */
  blurb: string
  formula: string
  /** Development-period rank IC against the 1-month factor-adjusted return. */
  ic: number
  icTStat: number
}

/** Development dates: Mar 2023 – Jan 2025. Stated wherever an IC is shown. */
export const SIGNAL_EVIDENCE =
  "Rank ICs are from 23 development months (Mar 2023 – Jan 2025) against next-month factor-adjusted returns, from the backtest run of 23 Nov 2026. None is statistically significant yet, and the locked holdout has not been run."

export const SIGNAL_COMPONENTS: SignalComponent[] = [
  {
    id: "value",
    label: "Value",
    full: "Reverse-DCF expected alpha",
    blurb:
      "The return the current price implies, minus the return the stock's risk requires: the average over reverse FCFF, residual income, revenue and shareholder-yield models. Solved from price, not discounted to a fair value.",
    formula: "α = r(implied) − WACC or kₑ, averaged over 4 models",
    ic: 0.032,
    icTStat: 1.18,
  },
  {
    id: "momentum",
    label: "Momentum",
    full: "12-1 month momentum",
    blurb:
      "The return from twelve months ago to one month ago. Skipping the last month avoids its short-term reversal.",
    formula: "P(t−21) ÷ P(t−252) − 1, on dividend-adjusted closes",
    ic: 0.029,
    icTStat: 1.18,
  },
  {
    id: "surprise",
    label: "Surprise",
    full: "Earnings surprise",
    blurb:
      "How far the latest quarter's EPS beat or missed the analyst consensus, scaled by price. Only reports from the last 100 days count.",
    formula: "(reported EPS − estimated EPS) ÷ price",
    ic: 0.024,
    icTStat: 1.45,
  },
]

/** The tested blends, by their sorted component ids. Anything else is untested. */
const TESTED_BLENDS: Record<string, { label: string; ic: number; icTStat: number }> = {
  "momentum+value": { label: "Value + momentum", ic: 0.054, icTStat: 1.92 },
  "momentum+surprise": { label: "Momentum + surprise", ic: 0.035, icTStat: 1.47 },
}

/** Value + momentum: the best tested blend. */
export const DEFAULT_SIGNALS: SignalId[] = ["value", "momentum"]

/** The evidence behind a component selection, or null if it was never tested. */
export function blendEvidence(
  selected: SignalId[]
): { label: string; ic: number; icTStat: number } | null {
  if (selected.length === 1) {
    const one = SIGNAL_COMPONENTS.find((c) => c.id === selected[0])
    return one ? { label: one.label, ic: one.ic, icTStat: one.icTStat } : null
  }
  return TESTED_BLENDS[[...selected].sort().join("+")] ?? null
}

function rankOf(stock: Stock, id: SignalId): number | null {
  const signals = stock.signals
  if (!signals) return null
  const rank =
    id === "value"
      ? signals.valueRank
      : id === "momentum"
        ? signals.momentumRank
        : signals.surpriseRank
  return rank ?? null
}

/**
 * The mean percentile (0–1) of the selected components, or null when any of
 * them is missing — averaging over fewer would let a stock with one strong
 * component outrank one measured on both.
 */
export function signalScore(stock: Stock, selected: SignalId[]): number | null {
  if (selected.length === 0) return null
  let total = 0
  for (const id of selected) {
    const rank = rankOf(stock, id)
    if (rank === null) return null
    total += rank
  }
  return total / selected.length
}

export function componentRank(stock: Stock, id: SignalId): number | null {
  return rankOf(stock, id)
}

export type SignalBand = "q5" | "q4" | "q3" | "q2" | "q1" | "unscored"

export const SIGNAL_BANDS: SignalBand[] = ["q5", "q4", "q3", "q2", "q1", "unscored"]

/**
 * Fifths of the score. A score is a mean of percentiles, so it bunches toward
 * the middle and these are not equal-count fifths of the universe. They read as
 * "where on the scale", which is the claim a rank can carry.
 */
export function signalBand(score: number | null): SignalBand {
  if (score === null) return "unscored"
  if (score >= 0.8) return "q5"
  if (score >= 0.6) return "q4"
  if (score >= 0.4) return "q3"
  if (score >= 0.2) return "q2"
  return "q1"
}

export const SIGNAL_BAND_LABELS: Record<SignalBand, string> = {
  q5: "Strongest",
  q4: "Strong",
  q3: "Middle",
  q2: "Weak",
  q1: "Weakest",
  unscored: "Unscored",
}

/**
 * Fill for a signal band: the `--signal-q*` tokens in `globals.css`, which
 * alias the sequential (magnitude) palette with emphasis rising with the score
 * in either theme. Deliberately not the valuation bands' diverging pair — a
 * percentile has no fair-value midpoint to diverge from.
 */
export const SIGNAL_BAND_FILL: Record<SignalBand, string> = {
  q5: "var(--color-signal-q5)",
  q4: "var(--color-signal-q4)",
  q3: "var(--color-signal-q3)",
  q2: "var(--color-signal-q2)",
  q1: "var(--color-signal-q1)",
  unscored: "var(--color-muted)",
}

/** Percentile as a whole number out of 100, the way the score is printed. */
export function formatScore(score: number | null): string {
  return score === null ? "-" : Math.round(score * 100).toString()
}
