/**
 * The screen: presets, filters and the one ranking pass everything reads.
 *
 * Ranking is done here, over the whole universe, rather than read from the
 * warehouse, for one reason: value depends on which reverse-DCF models are
 * switched on, and a percentile precomputed over all four would ignore the
 * toggles. Momentum and surprise do not depend on any toggle and keep their
 * warehouse percentiles; both sides use the same `cume_dist` arithmetic.
 */

import { evidenceFor } from "@/lib/evidence"
import { cumeDist } from "@/lib/rank"
import {
  DEFAULT_SIGNALS,
  describeEvidence,
  formatIc,
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
  "This is a partial Graham screen. It tests sales of at least $775M (his $100M of 1971, adjusted for CPI), P/E of 15 or less, and P/E × P/B of 22.5 or less. It approximates two of his tests by asking whether the company pays a dividend now (he asked for 20 unbroken years) and whether trailing earnings are positive (he asked for ten years without a loss). It does not test the 2:1 current ratio or the 33% EPS growth over ten years. It is a classic rule, and it has not been backtested."

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

const VM = evidenceFor(["value", "momentum"])!
const MS = evidenceFor(["momentum", "surprise"])!
const VALUE = evidenceFor(["value"])!

export type PresetId = "value-momentum" | "value-q5" | "momentum-surprise" | "graham"

export type ScreenerFilters = {
  preset: PresetId | null
  search: string
  /** Signal components the score averages. Never empty. */
  signals: SignalId[]
  /** Keep only these quintiles of the composite. Empty keeps every stock. */
  signalBands: SignalBand[]
  sectors: string[]
  /** Keep only these value quintiles. Empty keeps every stock. */
  bands: ValuationBand[]
  /** Restrict value to these models. Empty means all four, as backtested. */
  methods: MethodId[]
  /** Null is no cap. A cap excludes stocks whose beta is unmeasured. */
  maxBeta: number | null
  graham: boolean
}

/** Everything ranked on value + momentum, nothing cut. */
export const DEFAULT_FILTERS: ScreenerFilters = {
  preset: "value-momentum",
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
  /** One short line for the rail; the blurb and basis sit behind its info popover. */
  short: string
  apply: Pick<ScreenerFilters, "signals" | "signalBands" | "bands" | "graham">
}

export const PRESETS: Preset[] = [
  {
    id: "value-momentum",
    label: "Value + momentum",
    blurb: "Every stock, ranked on the average of its value and momentum percentiles (Asness, Moskowitz & Pedersen 2013).",
    basis: `The default: it did best in the design period (rank IC ${formatIc(VM.development)}) and was chosen before the unseen test (rank IC ${formatIc(VM.holdout)}).`,
    short: `Default · test rank IC ${VM.holdout.ic.toFixed(3)}`,
    apply: { signals: ["value", "momentum"], signalBands: [], bands: [], graham: false },
  },
  {
    id: "value-q5",
    label: "Cheapest fifth on value",
    blurb: "Only the cheapest 20% of the index by return gap, ranked by value percentile.",
    basis: `The top group in the backtest's five-way split. Value on its own: ${describeEvidence(VALUE)}`,
    short: `Value only · test rank IC ${VALUE.holdout.ic.toFixed(3)}`,
    apply: { signals: ["value"], signalBands: [], bands: ["deep-value"], graham: false },
  },
  {
    id: "momentum-surprise",
    label: "Momentum + earnings surprise",
    blurb: "Every stock, ranked on the average of its momentum and earnings surprise percentiles. Valuation plays no part.",
    basis: describeEvidence(MS),
    short: `No valuation input · test rank IC ${MS.holdout.ic.toFixed(3)}`,
    apply: { signals: ["momentum", "surprise"], signalBands: [], bands: [], graham: false },
  },
  {
    id: "graham",
    label: "Graham defensive (partial)",
    blurb: "Stocks passing the parts of Benjamin Graham's defensive-investor rules (1973) that this data can test, ranked by value percentile.",
    basis: "Of Graham's 7 rules, 3 are tested, 2 are approximated and 2 cannot be tested with this data. Not backtested.",
    short: "3 of 7 rules tested · not backtested",
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
  // A strategy other than the default counts once; "Custom" counts its parts below.
  if (filters.preset !== null && filters.preset !== DEFAULT_FILTERS.preset) count += 1
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
