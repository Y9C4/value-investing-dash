/**
 * The screen: presets, filters and the one ranking pass everything reads.
 *
 * Ranking is done here, over the whole universe, rather than read from the
 * warehouse, for one reason: value depends on which reverse-DCF models are
 * switched on, and a percentile precomputed over all four would ignore the
 * toggles. Momentum and surprise do not depend on any toggle and keep their
 * warehouse percentiles; both sides use the same `cume_dist` arithmetic.
 */

import { cumeDist } from "@/lib/rank"
import {
  DEFAULT_SIGNALS,
  signalBand,
  warehouseRank,
  type SignalBand,
  type SignalId,
} from "@/lib/signals"
import {
  impliedAlpha,
  valuationBand,
  type MethodId,
  type Stock,
  type ValuationBand,
} from "@/lib/valuation"

export type Ranking = {
  /** Value percentile (0, 1] under the selected models, by ticker. */
  value: Map<string, number>
  /**
   * The score: the mean of the selected component percentiles, re-ranked to a
   * percentile so its fifths hold equal numbers of stocks. Absent where any
   * selected component is missing: averaging over fewer would let one strong
   * component outrank a stock measured on both.
   */
  score: Map<string, number>
}

export function rankUniverse(
  stocks: Stock[],
  methods: MethodId[],
  selected: SignalId[]
): Ranking {
  const value = cumeDist(
    stocks.flatMap((stock): [string, number][] => {
      const alpha = impliedAlpha(stock, methods)
      return alpha === null ? [] : [[stock.ticker, alpha]]
    })
  )

  const composite = stocks.flatMap((stock): [string, number][] => {
    if (selected.length === 0) return []
    let total = 0
    for (const id of selected) {
      const rank =
        id === "value" ? (value.get(stock.ticker) ?? null) : warehouseRank(stock, id)
      if (rank === null) return []
      total += rank
    }
    return [[stock.ticker, total / selected.length]]
  })

  return { value, score: cumeDist(composite) }
}

/** One component's percentile for a stock, from the ranking or the warehouse. */
export function componentRank(
  stock: Stock,
  id: SignalId,
  ranking: Ranking
): number | null {
  return id === "value"
    ? (ranking.value.get(stock.ticker) ?? null)
    : warehouseRank(stock, id)
}

// ---------------------------------------------------------------------------
// Graham's defensive investor
// ---------------------------------------------------------------------------

/**
 * Graham's minimum size, $100 million of annual sales in 1971 dollars (The
 * Intelligent Investor, 4th ed., 1973, ch. 14), restated in 2024 dollars with
 * the BLS CPI-U annual averages: 1971 = 40.5, 2024 = 313.689.
 */
export const GRAHAM_MIN_SALES_BN = (0.1 * 313.689) / 40.5

/**
 * The parts of Graham's seven criteria this data can test. Fully: size, P/E
 * of at most 15, and P/E × P/B of at most 22.5 (his allowance for a P/B above
 * 1.5). Partly: a dividend now rather than 20 uninterrupted years, positive
 * trailing earnings rather than ten years without a deficit, and trailing
 * rather than three-year-average earnings in the P/E. Not at all: the 2:1
 * current ratio and a third of EPS growth over ten years, which need balance
 * sheet items and history yfinance does not provide.
 */
export const GRAHAM_NOTE =
  "Partial Graham screen. Tested: sales of at least $775M (his $100M of 1971, CPI-adjusted), P/E ≤ 15, and P/E × P/B ≤ 22.5. Approximated: pays a dividend now (he asked for 20 unbroken years) and positive trailing earnings (he asked for ten years without a loss). Not tested: a 2:1 current ratio and 33% EPS growth over ten years. A classic rule, not backtested."

export function passesGraham(stock: Stock): boolean {
  const { peRatio, pbRatio, dividendYield, revenueBn } = stock
  return (
    peRatio !== null &&
    peRatio > 0 &&
    peRatio <= 15 &&
    pbRatio !== null &&
    peRatio * pbRatio <= 22.5 &&
    dividendYield !== null &&
    dividendYield > 0 &&
    revenueBn !== null &&
    revenueBn >= GRAHAM_MIN_SALES_BN
  )
}

// ---------------------------------------------------------------------------
// Filters and presets
// ---------------------------------------------------------------------------

export type PresetId = "cheap-improving" | "deep-value" | "earnings-momentum" | "graham"

export type ScreenerFilters = {
  preset: PresetId | null
  search: string
  /** Signal components the score averages. Never empty. */
  signals: SignalId[]
  /** Keep only these fifths of the score. Empty keeps every stock. */
  signalBands: SignalBand[]
  sectors: string[]
  /** Keep only these fifths of value. Empty keeps every stock. */
  bands: ValuationBand[]
  /** Restrict value to these models. Empty means all four, as backtested. */
  methods: MethodId[]
  /** Null is no cap. A cap excludes stocks whose beta is unmeasured. */
  maxBeta: number | null
  graham: boolean
}

/** Everything ranked on value + trend, nothing cut. */
export const DEFAULT_FILTERS: ScreenerFilters = {
  preset: "cheap-improving",
  search: "",
  signals: DEFAULT_SIGNALS,
  signalBands: [],
  sectors: [],
  bands: [],
  methods: [],
  maxBeta: null,
  graham: false,
}

export type Preset = {
  id: PresetId
  label: string
  /** What it finds, in one line. */
  blurb: string
  /** Where its rule comes from. */
  basis: string
  apply: Pick<ScreenerFilters, "signals" | "signalBands" | "bands" | "graham">
}

export const PRESETS: Preset[] = [
  {
    id: "cheap-improving",
    label: "Cheap and improving",
    blurb: "Every stock, ranked on value and trend together.",
    basis: "The best blend in the backtest (development IC 0.054, t 1.92).",
    apply: { signals: ["value", "momentum"], signalBands: [], bands: [], graham: false },
  },
  {
    id: "deep-value",
    label: "Deep value",
    blurb: "The cheapest fifth of the index on value alone.",
    basis: "The top quintile of the backtest's value sort (IC 0.032).",
    apply: { signals: ["value"], signalBands: [], bands: ["deep-value"], graham: false },
  },
  {
    id: "earnings-momentum",
    label: "Earnings momentum",
    blurb: "Ranked on trend and the latest earnings surprise.",
    basis: "The second-best blend tested (IC 0.035, t 1.47).",
    apply: { signals: ["momentum", "surprise"], signalBands: [], bands: [], graham: false },
  },
  {
    id: "graham",
    label: "Graham defensive",
    blurb: "Benjamin Graham's defensive-investor rules, ranked on value.",
    basis: "A classic rule, partly testable here. Not backtested.",
    apply: { signals: ["value"], signalBands: [], bands: [], graham: true },
  },
]

export function applyPreset(filters: ScreenerFilters, id: PresetId): ScreenerFilters {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) return filters
  // Search and sector are orthogonal to a strategy, so they survive the switch.
  return { ...DEFAULT_FILTERS, search: filters.search, sectors: filters.sectors, ...preset.apply, preset: id }
}

export function applyFilters(
  stocks: Stock[],
  filters: ScreenerFilters,
  ranking: Ranking
): Stock[] {
  const query = filters.search.trim().toUpperCase()

  return stocks.filter((stock) => {
    if (
      query &&
      !stock.ticker.includes(query) &&
      !stock.name.toUpperCase().includes(query)
    ) {
      return false
    }
    if (filters.sectors.length > 0 && !filters.sectors.includes(stock.sector)) {
      return false
    }
    // An unmeasured beta cannot be shown to be under the cap, so it fails it.
    if (
      filters.maxBeta !== null &&
      (stock.beta === null || stock.beta > filters.maxBeta)
    ) {
      return false
    }
    if (filters.graham && !passesGraham(stock)) return false
    if (
      filters.signalBands.length > 0 &&
      !filters.signalBands.includes(signalBand(ranking.score.get(stock.ticker) ?? null))
    ) {
      return false
    }
    if (
      filters.bands.length > 0 &&
      !filters.bands.includes(valuationBand(ranking.value.get(stock.ticker) ?? null))
    ) {
      return false
    }
    return true
  })
}

/** How many controls differ from the opening screen, for the toolbar badge. */
export function activeFilterCount(filters: ScreenerFilters): number {
  const same = <T,>(a: T[], b: T[]) =>
    a.length === b.length && a.every((x) => b.includes(x))
  let count = 0
  if (filters.preset !== DEFAULT_FILTERS.preset) count += 1
  if (filters.search.trim()) count += 1
  count += filters.sectors.length
  if (filters.preset === null) {
    if (!same(filters.signals, DEFAULT_FILTERS.signals)) count += 1
    if (filters.bands.length > 0) count += 1
    if (filters.signalBands.length > 0) count += 1
  }
  if (filters.methods.length > 0) count += 1
  if (filters.maxBeta !== null) count += 1
  return count
}
