/**
 * The signal layer: what the backtest found ranks stocks, as shown on the
 * screener (python-api/notebooks/backtests.md §13, §16).
 *
 * Three components, each a percentile within today's universe. Momentum and
 * surprise are ranked in the warehouse (`warehouse.signals`); value is ranked
 * in the browser (`rankUniverse`, lib/screen.ts) so it follows the model
 * toggles. The score is the mean percentile of the components switched on,
 * the arithmetic the blends were tested with, re-ranked to a percentile.
 *
 * Percentiles rather than the raw numbers because test 4 found the size of
 * expected alpha meaningless (calibration slope 0.17). A rank is what the
 * evidence supports; a forecast return is not.
 */

import { quintile } from "@/lib/rank"
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
    full: "What the price implies, against what the risk requires",
    blurb:
      "The return the current price implies, minus the return the stock's risk requires: the average over reverse FCFF, residual income, revenue and shareholder-yield models. Solved from price, not discounted to a fair value.",
    formula: "α = r(implied) − WACC or kₑ, averaged over 4 models",
    ic: 0.032,
    icTStat: 1.18,
  },
  {
    id: "momentum",
    label: "Trend",
    full: "12-1 month price momentum",
    blurb:
      "The return from twelve months ago to one month ago (Jegadeesh & Titman 1993). Skipping the last month avoids its short-term reversal. Beside value it asks whether the market has started to agree.",
    formula: "P(t−21) ÷ P(t−252) − 1, on dividend-adjusted closes",
    ic: 0.029,
    icTStat: 1.18,
  },
  {
    id: "surprise",
    label: "Earnings",
    full: "Latest earnings surprise",
    blurb:
      "How far the latest quarter's EPS beat or missed the analyst consensus, scaled by price (Livnat & Mendenhall 2006). Only reports from the last 100 days count.",
    formula: "(reported EPS − estimated EPS) ÷ price",
    ic: 0.024,
    icTStat: 1.45,
  },
]

/** The tested blends, by their sorted component ids. Anything else is untested. */
const TESTED_BLENDS: Record<string, { label: string; ic: number; icTStat: number }> = {
  "momentum+value": { label: "Value + trend", ic: 0.054, icTStat: 1.92 },
  "momentum+surprise": { label: "Trend + earnings", ic: 0.035, icTStat: 1.47 },
}

/**
 * Value + trend: the best tested blend, equally weighted as in Asness,
 * Moskowitz & Pedersen (2013).
 */
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

/** A warehouse-computed component percentile; value is ranked in the browser. */
export function warehouseRank(
  stock: Stock,
  id: Exclude<SignalId, "value">
): number | null {
  const signals = stock.signals
  if (!signals) return null
  return (id === "momentum" ? signals.momentumRank : signals.surpriseRank) ?? null
}

export type SignalBand = "q5" | "q4" | "q3" | "q2" | "q1" | "unscored"

export const SIGNAL_BANDS: SignalBand[] = ["q5", "q4", "q3", "q2", "q1", "unscored"]

/**
 * Quintile of the score. The score is already re-ranked to a percentile, so
 * these are equal-count fifths of the scored universe.
 */
export function signalBand(score: number | null): SignalBand {
  if (score === null) return "unscored"
  return (`q${quintile(score)}` as SignalBand)
}

export const SIGNAL_BAND_LABELS: Record<SignalBand, string> = {
  q5: "Top fifth",
  q4: "Second fifth",
  q3: "Middle fifth",
  q2: "Fourth fifth",
  q1: "Bottom fifth",
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
