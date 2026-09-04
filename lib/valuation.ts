/**
 * The valuation layer the screener is built on.
 *
 * Every method is wired to real math in `api/valuation.py` and scored across
 * the index by `POST /backfill/valuations`. All report the same contract — a
 * fair value and a confidence — so the UI never needs to know which model
 * produced a number.
 *
 * A model that cannot speak to a company emits NO verdict rather than a zero,
 * which is why `verdicts` is ragged and coverage is worth filtering on.
 *
 * CAPM and Fama-French are deliberately absent: they produce an expected
 * return, not a value per share. They appear in the discount-rate panel.
 */

export type MethodId = "fcfe" | "fcff" | "comps" | "ddm" | "rim"

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
    id: "comps",
    label: "Comps",
    full: "Comparable Company Analysis",
    status: "live",
    blurb:
      "What the company would be worth priced like the median of its sector, on EV/EBITDA and P/E. The one model here that looks at other companies' prices — so it inherits whatever the sector is doing, and will call an expensive company fair if every peer is expensive too.",
    formula: "V₀ = ½·[(median EV/EBITDA × EBITDA − net debt) + median P/E × EPS] ÷ shares",
    refusesWhen: [
      "Negative or zero EBITDA and negative or zero earnings per share",
      "Fewer than 5 usable peers in the sector — a median of a handful is an anecdote",
      "Fewer than 4 quarters of statements on file",
      "Sector unknown, so there is no peer set to compare against",
    ],
  },
  {
    id: "ddm",
    label: "DDM",
    full: "Dividend Discount Model",
    status: "live",
    blurb:
      "Values the dividend stream directly: ten years of explicit dividend growth, then a perpetuity. Skipped below a 1.5% yield, where the dividend explains too little of the price to say anything about value.",
    formula:
      "V₀ = Σ D₀(1 + g)ᵗ / (1 + ke)ᵗ + D₁₀(1 + gₙ) / (ke − gₙ)(1 + ke)¹⁰",
    refusesWhen: [
      "The company pays no dividend",
      "Fewer than 8 dividend payments on record",
      "Yield below 1.5% — a token dividend does not explain the price",
      "Cost of equity within 2 points of the 3% terminal growth rate",
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

/**
 * The rates a company's valuations were discounted at.
 *
 * Not verdicts: a cost of equity is not a value per share, and listing CAPM
 * as a fair-value model left a permanently empty row on every stock page.
 *
 * Every field is nullable — a missing WACC is not a WACC of zero.
 */
export type DiscountRates = {
  /** 13-week T-bill (^IRX), averaged over the same 252-day window. */
  riskFree: number | null
  /** The rate FCFE, DDM and RIM discounted at. */
  costOfEquity: number | null
  /** Which model produced it — the three use incomparable risk premia. */
  costOfEquitySource: "ff5" | "ff3" | "capm" | null
  /** CAPM's own figure, shown beside the one that was used. */
  capmCostOfEquity: number | null
  /** The blended rate FCFF discounted at. */
  wacc: number | null
  costOfDebt: number | null
  /** E / (E + max(net debt, 0)), after the debt-weight cap. */
  equityWeight: number | null
  taxRate: number | null
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
  /**
   * The confidence-weighted consensus over every verdict above, computed by
   * the API so it arrives with the data rather than being re-derived for ~500
   * stocks on every render. See `consensusMarginOfSafety` for when it is used.
   *
   * Absent on the offline sample and on any snapshot written before the field
   * existed, so every reader must be able to compute it themselves.
   */
  consensus?: ModelConsensus
  /** Absent on the offline sample, which has no rates to report. */
  discountRates?: DiscountRates
}

/** The weighted average of every model's verdict on one stock. */
export type ModelConsensus = {
  /** Signed fraction, on the same scale as `MethodVerdict.marginOfSafety`. */
  marginOfSafety: number
  /** The per-share value that margin implies: price x (1 + margin). */
  fairValue: number
  /** How many verdicts it was taken over; see the note in `api/universe.py`. */
  models: number
}

/** Every modelled method, for the "all of them" reading of an empty selection. */
const METHOD_IDS: MethodId[] = VALUATION_METHODS.map((method) => method.id)

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
 * Consensus margin of safety, weighted by each method's declared weight (see
 * WEIGHT_* in `api/valuation.py`). The number the screener sorts on.
 *
 * `methods` narrows the consensus to those models only, which is the point of
 * the toggles: picking DDM and FCFE re-answers the whole screen — margins,
 * bands, distribution, ranking — from a cash-returns view alone.
 */
export function consensusMarginOfSafety(
  stock: Stock,
  methods: MethodId[] = []
): number {
  // The API ships this number already averaged, but only for the whole set of
  // verdicts. The guard is the point: `normalise` in `lib/universe.ts` drops
  // verdicts for methods this build no longer models, and a stored consensus
  // taken over a retired model would then disagree with the rows on screen —
  // the exact drift `isKnownMethod` exists to prevent. When the counts match,
  // nothing was dropped and the stored figure is the same arithmetic.
  if (
    methods.length === 0 &&
    stock.consensus &&
    stock.consensus.models === stock.verdicts.length
  ) {
    return stock.consensus.marginOfSafety
  }

  const verdicts = activeVerdicts(stock, methods)
  if (verdicts.length === 0) return 0

  const weight = verdicts.reduce((sum, v) => sum + v.confidence, 0)
  if (weight === 0) return 0

  return (
    verdicts.reduce((sum, v) => sum + v.marginOfSafety * v.confidence, 0) /
    weight
  )
}

/**
 * The consensus as a per-share value rather than a ratio.
 *
 * Prefers the stored figure for the same reason and under the same guard;
 * otherwise derived from the margin, which is exact — the API computes it that
 * way too.
 */
export function consensusFairValue(
  stock: Stock,
  methods: MethodId[] = []
): number {
  if (
    methods.length === 0 &&
    stock.consensus &&
    stock.consensus.models === stock.verdicts.length
  ) {
    return stock.consensus.fairValue
  }
  return stock.price * (1 + consensusMarginOfSafety(stock, methods))
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
 * Whether this stock is rated under the current model selection.
 *
 * ALWAYS "ALL OF THEM", INCLUDING THE DEFAULT. The models on screen are the
 * evidence a verdict is asked to rest on, so a stock one of them could not
 * value has not met the bar — and the rule saying so does not change shape
 * depending on whether the selection happens to be explicit. An empty
 * selection is every model, and every model must have spoken.
 *
 * The cost is stated rather than hidden: 90 of 495 stocks are valued by all
 * five, because DDM refuses non-payers and the cash-flow models refuse banks
 * and REITs by design. The other 405 are not discarded — they fall to
 * `unrated`, which has its own band chip, and the rail says so.
 */
export function isRated(stock: Stock, methods: MethodId[] = []): boolean {
  const required = methods.length === 0 ? METHOD_IDS : methods

  // Membership rather than a length comparison: a duplicated verdict for one
  // method would otherwise satisfy the count while a second model stayed
  // silent.
  const spoke = new Set(stock.verdicts.map((verdict) => verdict.method))
  return required.every((method) => spoke.has(method))
}

/** How many models the current selection asks for. Empty means all of them. */
export function selectedModelCount(methods: MethodId[] = []): number {
  return methods.length === 0 ? VALUATION_METHODS.length : methods.length
}

/**
 * Buckets the consensus into the five bands the screener's diverging scale
 * paints.
 *
 * THESE BANDS ARE RELATIVE, NOT ABSOLUTE — quintiles of the actual S&P 500
 * distribution, so "deep value" means "cheapest fifth of the index", not
 * "below intrinsic worth". The UI says so wherever a band is named.
 *
 * That is forced by the models, not chosen: the consensus median sits near
 * -34%, because the cash-flow models discount at ~12% while halving observed
 * growth against a 3% perpetuity. Centring on zero would file three fifths of
 * the index under "expensive" and fail to discriminate within it.
 *
 * If the discount-rate work moves that median, recompute these cut points from
 * the new distribution rather than leaving them frozen here.
 */
export function valuationBand(marginOfSafety: number): ValuationBand {
  if (marginOfSafety >= 0.03) return "deep-value"
  if (marginOfSafety >= -0.26) return "undervalued"
  if (marginOfSafety > -0.41) return "fair"
  if (marginOfSafety > -0.57) return "overvalued"
  return "expensive"
}

export function disagreementBand(marginOfSafety: number): ValuationBand {
  if (marginOfSafety >= 0.30) return "deep-value"
  if (marginOfSafety >= 0.10) return "undervalued"
  if (marginOfSafety >= -0.05) return "fair"
  if (marginOfSafety >= -0.30) return "overvalued"
  return "expensive"
}

/**
 * Shown wherever bands are explained. Kept here beside the cut points so the
 * caveat cannot drift away from the thresholds it describes.
 */
export const BAND_BASIS =
  "Bands are quintiles of the S&P 500 distribution, so they rank a company against the index rather than against its own intrinsic value. The bands are based upon the concensus value determined by the models selected."

/** Shown behind the info trigger on the margin-of-safety filter. */
export const MARGIN_BASIS =
  "The discount between what a company is worth and what it costs: (fair value - price) ÷ price, averaged over the selected models and weighted by each one's confidence. +20% means paying 80 cents for $1 of value."

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

/**
 * The screen the app opens on.
 *
 * It used to open on [-1, 1] and beta <= 3, which is not a default so much as
 * the absence of one: every rated stock passes, and the first thing on screen
 * is the whole index in an app whose argument is that you should not buy the
 * whole index. A screener's opening state is a worked example of the screen it
 * is for, so this one is a value screen.
 *
 * THE VALUE SCREEN IS EXPRESSED AS BANDS, NOT AS A MARGIN FLOOR, and that is a
 * correction rather than a preference. A -25% floor and a band selection are
 * two controls saying the same thing in different units, so they contradicted
 * each other: ticking "Expensive" under a -25% floor returned nothing, because
 * expensive means a consensus below -57%. An empty table under a filter the
 * user just switched on does not read as a filter, it reads as missing data.
 * Bands are also the vocabulary the distribution strip and every row's colour
 * already use, and the two ticked chips say what the screen is doing where a
 * slider position sitting at -25% did not — which matters most on a laptop,
 * where the rail is collapsed and the slider is not even on screen.
 *
 * The margin range therefore opens unbounded. It is a second, finer cut to
 * reach for after the bands, not the thing doing the work.
 *
 * The ceiling is Infinity rather than 1 for a reason worth stating: only the
 * floor has a control, so the ceiling is invisible, and a hard 1 quietly threw
 * away the nine stocks the models price at more than double — the cheapest
 * names in the index, dropped by the one screen most interested in them.
 * An invisible bound has to be one that cannot bite.
 *
 * 1.50 beta trims the high-volatility tail without touching the ordinary
 * market-tracking middle - the S&P's own beta is 1 by construction.
 *
 * Everything downstream reads the filtered set, so this is also what the
 * optimiser is handed on the screener's primary call to action.
 */
export const DEFAULT_FILTERS: ScreenerFilters = {
  search: "",
  sectors: [],
  bands: ["deep-value", "undervalued", "fair"],
  methods: ["fcfe", "fcff", "comps"],
  marginRange: [-0.5, Number.POSITIVE_INFINITY],
  maxBeta: 1.5,
}

/** Whether a facet still holds the value the screen opened on. */
export function isDefaultBandSelection(bands: ValuationBand[]): boolean {
  return (
    bands.length === DEFAULT_FILTERS.bands.length &&
    bands.every((band) => DEFAULT_FILTERS.bands.includes(band))
  )
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
