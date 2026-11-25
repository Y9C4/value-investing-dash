/**
 * Sector context: medians for the Overview table and, for one stock, where
 * each classic ratio sits among its sector peers. Context only — none of this
 * feeds the signal. Unmeasured ratios are left out of medians and ranks rather
 * than counted as zero.
 */

import { cumeDist, median } from "@/lib/rank"
import type { Ranking } from "@/lib/screen"
import type { Stock } from "@/lib/valuation"

export type RatioKey =
  | "peRatio"
  | "pbRatio"
  | "evEbitda"
  | "fcfYield"
  | "dividendYield"
  | "shareholderYield"
  | "roe"
  | "revenueGrowth"

export type RatioField = {
  key: RatioKey
  label: string
  /** Multiples print as 12.3×, everything else as a percent. */
  unit: "multiple" | "percent"
  /** The ratio itself, in LaTeX. */
  tex: string
  /** What the formula alone does not say. */
  help: string
}

export const RATIO_FIELDS: RatioField[] = [
  { key: "peRatio", label: "P/E", unit: "multiple", tex: "\\frac{\\text{market cap}}{\\text{TTM net income}}", help: "Only when all four quarters report and the total is positive." },
  { key: "pbRatio", label: "P/B", unit: "multiple", tex: "\\frac{\\text{market cap}}{\\text{book equity}}", help: "Positive book equity only." },
  { key: "evEbitda", label: "EV/EBITDA", unit: "multiple", tex: "\\frac{\\text{market cap} + \\text{net debt}}{\\text{annual EBITDA}}", help: "Net debt excludes leases. Both sides positive." },
  { key: "fcfYield", label: "FCF yield", unit: "percent", tex: "\\frac{\\text{FCFF}}{\\text{EV}}", help: "" },
  { key: "dividendYield", label: "Dividend yield", unit: "percent", tex: "\\frac{\\text{TTM dividends per share}}{\\text{price}}", help: "" },
  { key: "shareholderYield", label: "Shareholder yield", unit: "percent", tex: "\\frac{\\text{dividends} + \\text{net buybacks}}{\\text{market cap}}", help: "" },
  { key: "roe", label: "ROE", unit: "percent", tex: "\\frac{\\text{net income}}{\\text{book equity}}", help: "Heavy buybacks shrink the denominator, so read it with P/B." },
  { key: "revenueGrowth", label: "Revenue growth", unit: "percent", tex: "\\left(\\frac{\\text{Rev}_t}{\\text{Rev}_{t-2}}\\right)^{1/2} - 1", help: "The one-year rate when only that is available." },
]

export function formatRatio(value: number | null, unit: RatioField["unit"]): string {
  if (value === null) return "—"
  // A true minus, as every other signed figure on the site.
  return (unit === "multiple" ? `${value.toFixed(1)}×` : `${(value * 100).toFixed(1)}%`).replace("-", "−")
}

export type SectorRow = {
  sector: string
  count: number
  /** Median value percentile (all four models), 0-1. */
  value: number | null
  peRatio: number | null
  evEbitda: number | null
  fcfYield: number | null
}

/** One row per sector, cheapest median value percentile first. */
export function sectorRows(stocks: Stock[], ranking: Ranking): SectorRow[] {
  const bySector = new Map<string, Stock[]>()
  for (const stock of stocks) {
    bySector.set(stock.sector, [...(bySector.get(stock.sector) ?? []), stock])
  }
  return [...bySector.entries()]
    .map(([sector, members]) => ({
      sector,
      count: members.length,
      value: median(members.map((s) => ranking.value.get(s.ticker) ?? null)),
      peRatio: median(members.map((s) => s.peRatio)),
      evEbitda: median(members.map((s) => s.evEbitda)),
      fcfYield: median(members.map((s) => s.fcfYield)),
    }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
}

export type RatioContext = {
  key: RatioKey
  value: number | null
  sectorMedian: number | null
  /** Percentile among sector peers with a reading, low to high. */
  sectorPercentile: number | null
  /** Peers (including this stock) with a reading. */
  peers: number
}

export function ratioContext(stocks: Stock[], stock: Stock): RatioContext[] {
  const peers = stocks.filter((s) => s.sector === stock.sector)
  return RATIO_FIELDS.map(({ key }) => {
    const measured = peers.flatMap((s): [string, number][] =>
      s[key] === null ? [] : [[s.ticker, s[key] as number]]
    )
    return {
      key,
      value: stock[key],
      sectorMedian: median(measured.map(([, v]) => v)),
      sectorPercentile: cumeDist(measured).get(stock.ticker) ?? null,
      peers: measured.length,
    }
  })
}
