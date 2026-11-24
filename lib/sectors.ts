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
  help: string
}

export const RATIO_FIELDS: RatioField[] = [
  { key: "peRatio", label: "P/E", unit: "multiple", help: "Market capitalisation over trailing-twelve-month net income (Damodaran). Shown only when all four quarters report and the total is positive." },
  { key: "pbRatio", label: "P/B", unit: "multiple", help: "Market cap over book equity. Positive book only." },
  { key: "evEbitda", label: "EV/EBITDA", unit: "multiple", help: "Enterprise value over EBITDA. Positive EBITDA only." },
  { key: "fcfYield", label: "FCF yield", unit: "percent", help: "Free cash flow to the firm over enterprise value." },
  { key: "dividendYield", label: "Dividend yield", unit: "percent", help: "Dividends paid over the last year, over price." },
  { key: "shareholderYield", label: "Shareholder yield", unit: "percent", help: "Dividends plus net buybacks, over market cap." },
  { key: "roe", label: "ROE", unit: "percent", help: "Net income over book equity." },
  { key: "revenueGrowth", label: "Revenue growth", unit: "percent", help: "Trailing revenue growth a year, as reported (two-year where available)." },
]

export function formatRatio(value: number | null, unit: RatioField["unit"]): string {
  if (value === null) return "—"
  // A true minus, as every other signed figure on the site.
  return (unit === "multiple" ? `${value.toFixed(1)}×` : `${(value * 100).toFixed(1)}%`).replace("-", "−")
}

export type SectorRow = {
  sector: string
  count: number
  /** Median value percentile (all four models), 0–1. */
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
