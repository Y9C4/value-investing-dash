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
 * Percentiles rather than the raw numbers because the size of expected alpha
 * is not a forecast (calibration slope 0.17 in development, negative in the
 * holdout: python-api/notebooks/evidence.ipynb, figure 4). A rank is what the
 * evidence supports; a forecast return is not.
 */

import {
  DEVELOPMENT_SPAN,
  EVIDENCE,
  HOLDOUT_SPAN,
  type SignalEvidence,
} from "@/lib/evidence"
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
}

/** Stated wherever an IC is shown. */
export const SIGNAL_EVIDENCE = `Rank ICs are Spearman correlations with next-month factor-adjusted returns. Development: ${DEVELOPMENT_SPAN} (${EVIDENCE.signals[0].development.months} months), where every design choice was made. Holdout: ${HOLDOUT_SPAN} (${EVIDENCE.signals[0].holdout.months} months), untouched until the specification was frozen, then run once. A t-stat of about 2 is the usual bar for significance.`

/** "0.054 (t = 1.92)". */
export function formatIc(stats: { ic: number; t: number }): string {
  return `${stats.ic.toFixed(3)} (t = ${stats.t.toFixed(2)})`
}

/** One sentence for a popover: both samples, development first. */
export function describeEvidence(evidence: SignalEvidence): string {
  return `Rank IC ${formatIc(evidence.development)} in development; ${formatIc(evidence.holdout)} in the holdout.`
}

export const SIGNAL_COMPONENTS: SignalComponent[] = [
  {
    id: "value",
    label: "Value",
    full: "Implied excess return, reverse DCF",
    blurb:
      "The return the current price implies, minus the return the stock's risk requires: the average over reverse FCFF, residual income, revenue and shareholder-yield models. Solved from price, not discounted to a fair value.",
    formula: "α = r(implied) − WACC or kₑ, averaged over 4 models",
  },
  {
    id: "momentum",
    label: "Momentum",
    full: "12–1 month price momentum",
    blurb:
      "The return from twelve months ago to one month ago (Jegadeesh & Titman 1993). Skipping the last month avoids its short-term reversal. Beside value it asks whether the market has started to re-rate the stock.",
    formula: "P(t−21) ÷ P(t−252) − 1, on dividend-adjusted closes",
  },
  {
    id: "surprise",
    label: "Earnings surprise",
    full: "Price-scaled earnings surprise, latest quarter",
    blurb:
      "How far the latest quarter's EPS beat or missed the analyst consensus, scaled by price (Livnat & Mendenhall 2006). Only reports from the last 100 days count.",
    formula: "(reported EPS − estimated EPS) ÷ price",
  },
]

/**
 * Value + momentum: the best blend in development, equally weighted as in
 * Asness, Moskowitz & Pedersen (2013). Chosen before the holdout was run and
 * kept after it, whatever it showed: re-choosing on the holdout would leave no
 * out-of-sample test.
 */
export const DEFAULT_SIGNALS: SignalId[] = ["value", "momentum"]

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
  q5: "Q5 · highest",
  q4: "Q4",
  q3: "Q3",
  q2: "Q2",
  q1: "Q1 · lowest",
  unscored: "Not scored",
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

/**
 * The composite to one decimal, everywhere it is printed. It is the ranking
 * key and a cume_dist over ~500 stocks, so neighbours sit ~0.2 apart: whole
 * numbers put ~5 different ranks on each printed value (three stocks read
 * "100"), while one decimal leaves equal readings only for true ties.
 */
export function formatComposite(score: number | null): string {
  return score === null ? "—" : (score * 100).toFixed(1)
}

/** A single factor's percentile as a whole number out of 100. */
export function formatScore(score: number | null): string {
  return score === null ? "—" : Math.round(score * 100).toString()
}
