/**
 * The valuation layer the screener is built on.
 *
 * Only CAPM is wired to real math today (see `api/main.py`); the remaining
 * methods are declared here so the screener, the filter rail, and the stock
 * detail view can be built against their final shape. Each method reports the
 * same contract — a fair value and a confidence — so adding one is a matter of
 * filling in `status: "live"` and a real number, not reworking the UI.
 */

export type MethodId = "capm" | "dcf" | "ddm" | "graham" | "epv" | "rim"

export type MethodStatus = "live" | "planned"

export type ValuationMethod = {
  id: MethodId
  label: string
  /** Expanded name, shown once in the methodology panel. */
  full: string
  status: MethodStatus
  /** One line the user can act on — what the method rewards. */
  blurb: string
}

export const VALUATION_METHODS: ValuationMethod[] = [
  {
    id: "capm",
    label: "CAPM",
    full: "Capital Asset Pricing Model",
    status: "live",
    blurb:
      "Prices systematic risk only. Compares the return the market demands for a stock's beta against the return it actually delivered.",
  },
  {
    id: "dcf",
    label: "DCF",
    full: "Discounted Cash Flow",
    status: "planned",
    blurb:
      "Present value of projected free cash flow. The most sensitive to assumptions, and the closest to a true intrinsic value.",
  },
  {
    id: "ddm",
    label: "DDM",
    full: "Dividend Discount Model",
    status: "planned",
    blurb:
      "Values the dividend stream directly. Meaningful for mature payers, useless for non-payers.",
  },
  {
    id: "graham",
    label: "Graham",
    full: "Graham Number",
    status: "planned",
    blurb:
      "Defensive ceiling from earnings and book value. A blunt screen for the price you should refuse to exceed.",
  },
  {
    id: "epv",
    label: "EPV",
    full: "Earnings Power Value",
    status: "planned",
    blurb:
      "Capitalises sustainable earnings with no growth assumption. Greenwald's answer to DCF's optimism.",
  },
  {
    id: "rim",
    label: "RIM",
    full: "Residual Income Model",
    status: "planned",
    blurb:
      "Book value plus earnings above the cost of equity. Robust where cash flows are lumpy.",
  },
]

/** A single method's verdict on one stock. */
export type MethodVerdict = {
  method: MethodId
  /** Per-share fair value in USD. */
  fairValue: number
  /** Signed fraction: (fairValue - price) / price. Positive = undervalued. */
  marginOfSafety: number
  /** 0–1. How much the inputs support the number. */
  confidence: number
}

export type Stock = {
  ticker: string
  name: string
  sector: string
  price: number
  marketCap: number
  beta: number
  peRatio: number
  dividendYield: number
  /** Annualised expected return actually realised over the window. */
  realisedReturn: number
  /** Annualised volatility over the same window. */
  volatility: number
  verdicts: MethodVerdict[]
}

/**
 * Consensus margin of safety across the methods that produced a verdict,
 * weighted by each method's confidence. This is the number the screener sorts
 * on and the diverging scale encodes.
 */
export function consensusMarginOfSafety(stock: Stock): number {
  if (stock.verdicts.length === 0) return 0

  const weight = stock.verdicts.reduce((sum, v) => sum + v.confidence, 0)
  if (weight === 0) return 0

  return (
    stock.verdicts.reduce((sum, v) => sum + v.marginOfSafety * v.confidence, 0) /
    weight
  )
}

export type ValuationBand =
  | "deep-value"
  | "undervalued"
  | "fair"
  | "overvalued"
  | "expensive"

/**
 * Buckets the consensus into the five bands the screener's diverging scale
 * paints. Thresholds are symmetric around fair value so the midpoint reads as
 * "no opinion" rather than as a sixth category.
 */
export function valuationBand(marginOfSafety: number): ValuationBand {
  if (marginOfSafety >= 0.25) return "deep-value"
  if (marginOfSafety >= 0.08) return "undervalued"
  if (marginOfSafety > -0.08) return "fair"
  if (marginOfSafety > -0.25) return "overvalued"
  return "expensive"
}

export const BAND_LABELS: Record<ValuationBand, string> = {
  "deep-value": "Deep value",
  undervalued: "Undervalued",
  fair: "Fair value",
  overvalued: "Overvalued",
  expensive: "Expensive",
}

/**
 * Fill colour for a band. Both poles come from the diverging pair in
 * `globals.css`; the midpoint is the neutral gray, never a third hue.
 */
export const BAND_FILL: Record<ValuationBand, string> = {
  "deep-value": "var(--color-undervalued)",
  undervalued: "color-mix(in oklch, var(--color-undervalued), transparent 45%)",
  fair: "var(--color-valuation-neutral)",
  overvalued: "color-mix(in oklch, var(--color-overvalued), transparent 45%)",
  expensive: "var(--color-overvalued)",
}

export type ScreenerFilters = {
  search: string
  sectors: string[]
  bands: ValuationBand[]
  /** Inclusive [min, max] on the consensus margin of safety. */
  marginRange: [number, number]
  maxBeta: number
  /** Only stocks scored by at least this many methods. */
  minMethods: number
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  search: "",
  sectors: [],
  bands: [],
  marginRange: [-1, 1],
  maxBeta: 3,
  minMethods: 1,
}

export function applyFilters(
  stocks: Stock[],
  filters: ScreenerFilters
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

    if (stock.beta > filters.maxBeta) return false
    if (stock.verdicts.length < filters.minMethods) return false

    const margin = consensusMarginOfSafety(stock)
    if (margin < filters.marginRange[0] || margin > filters.marginRange[1]) {
      return false
    }

    if (
      filters.bands.length > 0 &&
      !filters.bands.includes(valuationBand(margin))
    ) {
      return false
    }

    return true
  })
}
