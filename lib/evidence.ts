/**
 * Every backtest figure the site prints, read from one file:
 * `app/research/_data/evidence.json`, written by the last cell of
 * `python-api/notebooks/evidence.ipynb`. Re-running that notebook is the only
 * way an IC on the site changes, so the numbers cannot drift from the notebook.
 *
 * Two samples: development (Mar 2023 – Jan 2025), where every design choice
 * was made, and the holdout (May 2025 onward), untouched until the
 * specification was frozen and run once.
 */

import evidence from "@/app/research/_data/evidence.json"

export type SampleStats = {
  /** Mean monthly Spearman rank IC against next-month factor-adjusted returns. */
  ic: number
  /** Fama–MacBeth t-stat of the monthly IC series. */
  t: number
  /** Share of months with IC > 0. */
  hit: number
  /** Mean top-minus-bottom quintile return per month. */
  spread: number
  spreadT: number
  coverage: number
  months: number
  /** Mean next-month return of Q1…Q5. */
  quintiles: number[]
}

export type SignalEvidence = {
  /** `value`, `momentum`, `surprise`, or `composite:<sorted ids>`. */
  id: string
  label: string
  development: SampleStats
  holdout: SampleStats
}

export type Evidence = {
  generated: string
  target: string
  samples: Record<"Development" | "Holdout", { first: string; last: string }>
  signals: SignalEvidence[]
  monthly: ({ date: string; sample: "Development" | "Holdout" } & Record<
    string,
    { ic: number; spread: number } | string
  >)[]
  calibration: Record<
    "development" | "holdout",
    { slope: number; t: number; deciles: [number, number][] }
  >
}

export const EVIDENCE = evidence as unknown as Evidence

/** Evidence for a factor or composite, by sorted component ids; null if untested. */
export function evidenceFor(ids: string[]): SignalEvidence | null {
  const key = ids.length === 1 ? ids[0] : `composite:${[...ids].sort().join("+")}`
  return EVIDENCE.signals.find((s) => s.id === key) ?? null
}

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })

/** "2023-03" → "Mar 2023". */
export function formatMonth(month: string): string {
  return MONTH.format(new Date(`${month}-01T00:00:00Z`))
}

export const DEVELOPMENT_SPAN = `${formatMonth(EVIDENCE.samples.Development.first)} – ${formatMonth(EVIDENCE.samples.Development.last)}`
export const HOLDOUT_SPAN = `${formatMonth(EVIDENCE.samples.Holdout.first)} – ${formatMonth(EVIDENCE.samples.Holdout.last)}`

/**
 * The screener's three ranked strategies, as the research charts draw them.
 * Colour follows the strategy in every chart (`--cat-*`, validated in both themes).
 */
export const STRATEGIES = {
  vm: { id: "composite:momentum+value", label: "Value + momentum composite", color: "var(--cat-1)" },
  ms: { id: "composite:momentum+surprise", label: "Momentum + earnings surprise", color: "var(--cat-2)" },
  value: { id: "value", label: "Value (implied excess return)", color: "var(--cat-3)" },
} as const

export type StrategyKey = keyof typeof STRATEGIES
