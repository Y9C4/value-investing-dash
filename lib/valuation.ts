/**
 * The valuation layer the screener is built on.
 *
 * Every method here is wired to real math in `api/valuation.py` and scored
 * across the S&P 500 by `POST /backfill/valuations`. Each reports the same
 * contract — a fair value and a confidence — so the UI never needs to know
 * which model produced a number.
 *
 * A model that cannot speak to a company emits NO verdict rather than a zero:
 * a bank has no meaningful free cash flow, a non-payer has no dividend stream,
 * a loss-maker has no Graham number. Absence in the breakdown means "does not
 * apply here", which is why `verdicts` is ragged and coverage is worth
 * filtering on.
 */

export type MethodId =
  | "capm"
  | "ff3"
  | "ff5"
  | "ddm"
  | "fcfe"
  | "fcff"
  | "graham"
  | "epv"
  | "rim"

export type MethodStatus = "live" | "planned"

export type ValuationMethod = {
  id: MethodId
  label: string
  /** Expanded name, shown once in the methodology panel. */
  full: string
  status: MethodStatus
  /** One line the user can act on — what the method rewards. */
  blurb: string
  /** The core expression, in the notation used in the Python implementation. */
  formula: string
  /**
   * The conditions under which this model declines to produce a verdict.
   * Mirrors the guards in `api/valuation.py`; kept here so the UI can explain
   * an absent row rather than leaving it looking like missing data.
   */
  refusesWhen: string[]
}

export const VALUATION_METHODS: ValuationMethod[] = [
  {
    id: "capm",
    label: "CAPM",
    full: "Capital Asset Pricing Model",
    status: "live",
    blurb:
      "Prices systematic risk only. Compares the return the market demands for a stock's beta against the return it actually delivered; the gap is read as a one-year price correction.",
    formula: "E(r) = rf + β(E(rm) − rf)",
    refusesWhen: [
      "Fewer than 120 overlapping daily observations against the index",
    ],
  },
  {
    id: "ff3",
    label: "FF3",
    full: "Fama-French Three-Factor",
    status: "live",
    blurb:
      "Adds size and value to market risk. A risk model, not an intrinsic value — the unexplained return (alpha) is mapped to an implied price, so it is capped and weighted lightly.",
    formula: "R − rf = α + β₁(Mkt−rf) + β₂·SMB + β₃·HML",
    refusesWhen: [
      "Fewer than 120 overlapping observations",
      "Regression R² below 0.10 — the factors do not explain this stock",
    ],
  },
  {
    id: "ff5",
    label: "FF5",
    full: "Fama-French Five-Factor",
    status: "live",
    blurb:
      "Extends FF3 with profitability and investment. Also supplies the cost of equity every cash-flow model below discounts at, which is its more important job.",
    formula: "R − rf = α + β₁(Mkt−rf) + β₂·SMB + β₃·HML + β₄·RMW + β₅·CMA",
    refusesWhen: [
      "Fewer than 120 overlapping observations",
      "Regression R² below 0.10",
    ],
  },
  {
    id: "ddm",
    label: "DDM",
    full: "Dividend Discount Model",
    status: "live",
    blurb:
      "Values the dividend stream directly via Gordon growth. Skipped below a 1.5% yield, where the dividend explains too little of the price to say anything about value.",
    formula: "V₀ = D₁ / (ke − g),  D₁ = D₀(1 + g)",
    refusesWhen: [
      "The company pays no dividend",
      "Fewer than 8 dividend payments on record",
      "Yield below 1.5% — a token dividend does not explain the price",
      "Cost of equity within 2 points of the growth rate, where the formula explodes",
    ],
  },
  {
    id: "fcfe",
    label: "FCFE",
    full: "Free Cash Flow to Equity",
    status: "live",
    blurb:
      "Cash left for shareholders after capex and net borrowing, discounted at the cost of equity. Skipped for banks and REITs, where capex is not a meaningful concept.",
    formula: "FCFE = CFO + CapEx + net borrowing, discounted at ke",
    refusesWhen: [
      "Trailing free cash flow to equity is zero or negative",
      "Banks and REITs, where capital expenditure is not a meaningful concept",
      "Fewer than 4 quarters of statements on file",
      "Cost of equity within 2 points of terminal growth",
    ],
  },
  {
    id: "fcff",
    label: "FCFF",
    full: "Free Cash Flow to Firm",
    status: "live",
    blurb:
      "Cash available to all capital providers, discounted at WACC and bridged to equity by netting out debt. Less sensitive to leverage than FCFE.",
    formula: "FCFF = EBIT(1−t) + D&A + CapEx − ΔWC, discounted at WACC",
    refusesWhen: [
      "Trailing free cash flow to the firm is zero or negative",
      "Banks and REITs",
      "Equity value after netting debt is negative",
      "WACC within 2 points of terminal growth",
    ],
  },
  {
    id: "graham",
    label: "Graham",
    full: "Graham Number",
    status: "live",
    blurb:
      "Defensive ceiling from earnings and book value. Its constant encodes 15x earnings and 1.5x book — almost nothing clears it today, so it flags deep value rather than fair value.",
    formula: "V₀ = √(22.5 × EPS × book value per share)",
    refusesWhen: [
      "Negative or zero earnings per share — the square root would be imaginary",
      "Negative or zero book value per share",
    ],
  },
  {
    id: "epv",
    label: "EPV",
    full: "Earnings Power Value",
    status: "live",
    blurb:
      "Capitalises sustainable earnings with no growth assumption at all. A floor on value rather than an estimate of it, which is why it reads low for growing companies.",
    formula: "V₀ = EBIT(1 − t) / WACC, less net debt",
    refusesWhen: [
      "Negative or zero operating earnings",
      "Equity value after netting debt is negative",
    ],
  },
  {
    id: "rim",
    label: "RIM",
    full: "Residual Income Model",
    status: "live",
    blurb:
      "Book value plus earnings above the cost of equity. Robust where cash flows are lumpy, and the right model for banks — so it carries no sector exclusion.",
    formula: "V₀ = B₀ + Σ (ROE − ke)·B₍ₜ₋₁₎ / (1 + ke)ᵗ",
    refusesWhen: [
      "Negative or zero book value, which makes residual income meaningless",
      "Return on equity unavailable",
    ],
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
 * The verdicts that count under the current model selection. An empty
 * selection means every model counts, which is the default reading.
 */
export function activeVerdicts(
  stock: Stock,
  methods: MethodId[] = []
): MethodVerdict[] {
  if (methods.length === 0) return stock.verdicts
  return stock.verdicts.filter((v) => methods.includes(v.method))
}

/**
 * Consensus margin of safety across the methods that produced a verdict,
 * weighted by each method's confidence. This is the number the screener sorts
 * on and the diverging scale encodes.
 *
 * Passing `methods` narrows the consensus to those models only. That is the
 * point of the model toggles: restricting to DDM and FCFE asks "what does a
 * cash-returns view alone say about this company", and the whole screen —
 * margins, bands, distribution, ranking — answers that question instead.
 */
export function consensusMarginOfSafety(
  stock: Stock,
  methods: MethodId[] = []
): number {
  const verdicts = activeVerdicts(stock, methods)
  if (verdicts.length === 0) return 0

  const weight = verdicts.reduce((sum, v) => sum + v.confidence, 0)
  if (weight === 0) return 0

  return (
    verdicts.reduce((sum, v) => sum + v.marginOfSafety * v.confidence, 0) /
    weight
  )
}

export type ValuationBand =
  | "deep-value"
  | "undervalued"
  | "fair"
  | "overvalued"
  | "expensive"
  // No model could value this company. Distinct from "fair" on purpose: a
  // consensus of 0 because nothing applies is not the same claim as a
  // consensus of 0 because the models agree the price is right.
  | "unrated"

/**
 * Whether any of the selected models produced a verdict for this stock. Under
 * a narrowed selection a stock can be unrated here while still carrying
 * verdicts from models the user has switched off — which is the honest
 * reading: those models were asked not to speak.
 */
export function isRated(stock: Stock, methods: MethodId[] = []): boolean {
  return activeVerdicts(stock, methods).length > 0
}

/**
 * Buckets the consensus into the five bands the screener's diverging scale
 * paints.
 *
 * The thresholds are not symmetric around zero, and deliberately so. Half the
 * models here — EPV, RIM, Graham — credit no growth beyond retained earnings,
 * which caps a company at roughly 1/r times earnings (about 11x at a 9%
 * discount rate). Against a market trading well above that, they read bearish
 * by construction, and the consensus for the S&P 500 sits near -36% rather
 * than near zero. Centring the bands on zero would file three quarters of the
 * index under "expensive" and leave the screener unable to discriminate.
 *
 * These cut points track the observed distribution, so a band means "cheap
 * relative to the rest of the index" rather than "cheap in absolute terms".
 */
export function valuationBand(marginOfSafety: number): ValuationBand {
  if (marginOfSafety >= -0.05) return "deep-value"
  if (marginOfSafety >= -0.22) return "undervalued"
  if (marginOfSafety > -0.40) return "fair"
  if (marginOfSafety > -0.50) return "overvalued"
  return "expensive"
}

export const BAND_LABELS: Record<ValuationBand, string> = {
  "deep-value": "Deep value",
  undervalued: "Undervalued",
  fair: "Fair value",
  overvalued: "Overvalued",
  expensive: "Expensive",
  unrated: "Unrated",
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
  // Deliberately off the diverging scale entirely — "no reading" is not a
  // point on an axis running from cheap to expensive.
  unrated: "var(--color-muted)",
}

export type ScreenerFilters = {
  search: string
  sectors: string[]
  bands: ValuationBand[]
  /**
   * Restrict the consensus to these models. Empty means every model that
   * produced a verdict counts — the default reading.
   */
  methods: MethodId[]
  /** Inclusive [min, max] on the consensus margin of safety. */
  marginRange: [number, number]
  maxBeta: number
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  search: "",
  sectors: [],
  bands: [],
  methods: [],
  marginRange: [-1, 1],
  maxBeta: 3,
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

    // An unrated stock has no margin to compare, so the numeric filters below
    // would read its 0 as "fair" and let it through every range. It only
    // qualifies when the band filter asks for it explicitly.
    if (!isRated(stock, filters.methods)) {
      return filters.bands.includes("unrated")
    }

    const margin = consensusMarginOfSafety(stock, filters.methods)
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
