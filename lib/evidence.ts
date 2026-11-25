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
  /** Development only: each reverse-DCF model against a plain ratio on the same stocks. */
  modelVsRatio: {
    model: string
    ratio: string
    modelIc: number
    ratioIc: number
    /** t-stat of the monthly IC difference; null for the composite row. */
    t: number | null
    /** Share of months the model's IC beat the ratio's; null for the composite row. */
    wins: number | null
  }[]
  /** Development only: the value signal's top-minus-bottom quintile on raw returns, and its Fama–French alpha. */
  valueAttribution: { longShort: number; alpha: number; alphaT: number; months: number }
}

/** The site's names for the notebook's signal ids, in plainer words than the export's. */
const SIGNAL_NAMES: Record<string, string> = {
  "composite:momentum+value": "Value + momentum",
  "composite:momentum+surprise": "Momentum + earnings surprise",
  value: "Value",
  momentum: "Momentum",
  surprise: "Earnings surprise",
}

const raw = evidence as unknown as Evidence

export const EVIDENCE: Evidence = {
  ...raw,
  signals: raw.signals.map((s) => ({ ...s, label: SIGNAL_NAMES[s.id] ?? s.label })),
}

/** Evidence for a factor or composite, by sorted component ids; null if untested. */
export function evidenceFor(ids: string[]): SignalEvidence | null {
  const key = ids.length === 1 ? ids[0] : `composite:${[...ids].sort().join("+")}`
  return EVIDENCE.signals.find((s) => s.id === key) ?? null
}

/** Whether a signal's development and holdout t-stats clear the conventional t = 2 bar, in words. */
export function significanceNote(e: SignalEvidence): string {
  const dev = e.development.t >= 2
  const hold = e.holdout.t >= 2
  if (!dev && !hold) return "Neither result is strong enough to rule out luck."
  if (dev && hold) return "Both results clear the usual bar for ruling out luck (t of 2)."
  return hold ? "Only the unseen test clears the usual bar for ruling out luck (t of 2)." : "Only the design-period result clears the usual bar for ruling out luck (t of 2)."
}

/** The default strategy's holdout in one clause, for "...because it did best in the design period, <clause>". */
export function holdoutClause(e: SignalEvidence): string {
  if (e.holdout.t >= 2) return "and it held up on unseen data"
  return `though on unseen data it was ${e.holdout.ic < e.development.ic ? "weaker and " : ""}too weak to rule out luck`
}

/** A slope or t-stat to two decimals, with a true minus. */
export const formatStat = (x: number) => x.toFixed(2).replace("-", "\u2212")

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
  vm: { id: "composite:momentum+value", label: "Value + momentum", color: "var(--cat-1)" },
  ms: { id: "composite:momentum+surprise", label: "Momentum + earnings surprise", color: "var(--cat-2)" },
  value: { id: "value", label: "Value", color: "var(--cat-3)" },
} as const

export type StrategyKey = keyof typeof STRATEGIES

/**
 * Figure 1's data: each strategy's monthly IC as a running sum, plus the
 * holdout's first and last month for the shading. The embargo months carry no
 * outcome and are absent.
 */
export function cumulativeIc() {
  const keys = Object.keys(STRATEGIES) as StrategyKey[]
  const totals: Record<StrategyKey, number> = { vm: 0, ms: 0, value: 0 }
  const rows = EVIDENCE.monthly.map((row) => {
    const point = { date: row.date } as { date: string } & Record<StrategyKey, number>
    for (const key of keys) {
      const cell = row[STRATEGIES[key].id]
      if (typeof cell === "object") totals[key] += cell.ic
      point[key] = Math.round(totals[key] * 1000) / 1000
    }
    return point
  })
  const holdout = EVIDENCE.monthly.filter((m) => m.sample === "Holdout").map((m) => m.date)
  return { rows, holdoutStart: holdout[0], holdoutEnd: holdout[holdout.length - 1] }
}
