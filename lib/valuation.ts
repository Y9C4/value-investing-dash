/**
 * The valuation layer the screener is built on.
 *
 * Value is read as a return, not a price. Each of four reverse-DCF models
 * solves for the annual return today's price implies, and the reading is that
 * return minus the one the stock's risk requires (WACC for the firm-level
 * models, CAPM cost of equity for the equity-level ones). All four are solved
 * in SQL by `warehouse.signals` (supabase/migrations/20261117000001) and served
 * on `public.screener` inside each stock's `signals`.
 *
 * The five forward fair-value models (DDM, FCFE, FCFF, RIM, comps) were retired
 * in 20261117000003. A fair value is the price times a multiple levered by
 * 1/(k − g), so small input errors sent margins to +700%; an implied return is
 * a root of the same cash flows and stays in a range a reader can judge.
 *
 * A model that cannot solve for a company (no positive cash flow, no book
 * value) reports nothing rather than a zero, so coverage varies by model.
 */

import {
  DEFAULT_SIGNALS,
  signalBand,
  signalScore,
  type SignalBand,
  type SignalId,
} from "@/lib/signals"

export type MethodId = "fcff" | "rim" | "revenue" | "shareholderYield"

export type ValuationMethod = {
  id: MethodId
  label: string
  /** Expanded name, shown once in the methodology panel. */
  full: string
  /** One line the user can act on — what the method rewards. */
  blurb: string
  /** The core expression the implied return solves. */
  formula: string
  /** The required return the implied return is measured against. */
  against: "wacc" | "ke"
  /** When the model cannot solve, so an absent reading is explained. */
  refusesWhen: string[]
}

export const VALUATION_METHODS: ValuationMethod[] = [
  {
    id: "fcff",
    label: "FCFF",
    full: "Reverse free cash flow to firm",
    blurb:
      "The return that makes five years of growing free cash flow, then a perpetuity, worth today's enterprise value. Measured against WACC.",
    formula: "EV = Σ FCFFₜ / (1 + r)ᵗ + terminal, solved for r",
    against: "wacc",
    refusesWhen: [
      "Free cash flow to the firm is zero or negative",
      "No annual statement within the last 440 days",
    ],
  },
  {
    id: "rim",
    label: "RIM",
    full: "Reverse residual income",
    blurb:
      "The return that makes book value plus five years of earnings above it worth today's market cap, with ROE fading to its sector median. Works for banks. Measured against cost of equity.",
    formula: "E = B₀ + Σ (ROEₜ − r)·Bₜ₋₁ / (1 + r)ᵗ, solved for r",
    against: "ke",
    refusesWhen: [
      "Book value is zero or negative",
      "Return on equity unavailable, or fewer than 5 sector peers to fade toward",
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    full: "Reverse revenue DCF",
    blurb:
      "Grows revenue and fades the cash margin toward the sector median, then solves for the return that justifies the enterprise value. Speaks for companies whose cash flow is temporarily negative. Measured against WACC.",
    formula: "EV = Σ Revₜ · marginₜ / (1 + r)ᵗ + terminal, solved for r",
    against: "wacc",
    refusesWhen: [
      "Revenue is zero or missing",
      "The sector's median cash margin is not positive, or it has fewer than 5 peers",
    ],
  },
  {
    id: "shareholderYield",
    label: "Shareholder yield",
    full: "Reverse shareholder yield",
    blurb:
      "Treats dividends plus net buybacks as the cash a shareholder receives, and solves for the return that justifies the market cap. Measured against cost of equity.",
    formula: "E = Σ (divs + buybacks)ₜ / (1 + r)ᵗ + terminal, solved for r",
    against: "ke",
    refusesWhen: ["The company returned no net cash to shareholders"],
  },
]

/**
 * The rates the implied returns are measured against, from
 * `warehouse.discount_rates` — the same figures `warehouse.signals` uses.
 *
 * Every field is nullable — a missing WACC is not a WACC of zero.
 */
export type DiscountRates = {
  /** Spot 10-year Treasury yield (^TNX). */
  riskFree: number | null
  /** CAPM: rf + β × long-run market premium. RIM and shareholder yield. */
  costOfEquity: number | null
  /** FCFF and revenue. */
  wacc: number | null
  costOfDebt: number | null
  /** E / (E + debt ex leases). */
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
  /** Absent on the offline sample, which has no rates to report. */
  discountRates?: DiscountRates
  /** The tested signal (lib/signals.ts). Absent on a stock with no data. */
  signals?: StockSignals
}

/**
 * The signal's components for one stock, from `warehouse.signals`. Each rank is
 * a percentile (0–1] within today's universe; null where the component could
 * not be computed (no solvable reverse-DCF model, under a year of prices, no
 * earnings report in the last 100 days).
 */
export type StockSignals = {
  /** Mean implied excess return over the models that solved, per year. */
  value: number | null
  /** 12-1 month return. */
  momentum: number | null
  /** (Reported − estimated EPS) ÷ price, latest report within 100 days. */
  surprise: number | null
  surpriseDate: string | null
  valueRank: number | null
  momentumRank: number | null
  surpriseRank: number | null
  /** The four implied returns behind `value`, per year. */
  impliedReturns: Record<MethodId, number | null>
  /** CAPM cost of equity: what RIM and shareholder yield are measured against. */
  requiredReturnEquity: number | null
  /** WACC: what FCFF and revenue are measured against. */
  requiredReturnFirm: number | null
}

/** Every modelled method, for the "all of them" reading of an empty selection. */
const METHOD_IDS: MethodId[] = VALUATION_METHODS.map((method) => method.id)

const AGAINST: Record<MethodId, ValuationMethod["against"]> = Object.fromEntries(
  VALUATION_METHODS.map((method) => [method.id, method.against])
) as Record<MethodId, ValuationMethod["against"]>

/** The required return one model is measured against, or null. */
export function requiredReturn(stock: Stock, method: MethodId): number | null {
  const signals = stock.signals
  if (!signals) return null
  return AGAINST[method] === "wacc"
    ? signals.requiredReturnFirm
    : signals.requiredReturnEquity
}

/** One model's implied return minus its required return, per year, or null. */
export function methodAlpha(stock: Stock, method: MethodId): number | null {
  const implied = stock.signals?.impliedReturns[method] ?? null
  const required = requiredReturn(stock, method)
  return implied === null || required === null ? null : implied - required
}

/**
 * The implied excess return under the current model selection: the mean of
 * whichever selected models solved, null when none did. An empty selection is
 * every model, which is exactly `signals.value` — the backtested reading
 * (test 3 averages whichever models are available).
 */
export function impliedAlpha(
  stock: Stock,
  methods: MethodId[] = []
): number | null {
  const selected = methods.length === 0 ? METHOD_IDS : methods
  let total = 0
  let count = 0
  for (const method of selected) {
    const alpha = methodAlpha(stock, method)
    if (alpha === null) continue
    total += alpha
    count += 1
  }
  return count === 0 ? null : total / count
}

/** Whether any selected model could solve for this stock. */
export function isRated(stock: Stock, methods: MethodId[] = []): boolean {
  return impliedAlpha(stock, methods) !== null
}

export type ValuationBand =
  | "deep-value"
  | "undervalued"
  | "fair"
  | "overvalued"
  | "expensive"
  // No model could solve for this company. Distinct from "fair" on purpose: no
  // reading is not the same claim as a reading of zero.
  | "unrated"

/**
 * Buckets the implied excess return into the five bands the screener's
 * diverging scale paints.
 *
 * THESE BANDS ARE RELATIVE, NOT ABSOLUTE — quintiles of the S&P 500
 * distribution, so "deep value" means "cheapest fifth of the index". The
 * backtest found the rank of this number useful and its size not (calibration
 * slope 0.14), so a band says where a stock sits, not what it will earn.
 *
 * Quintiles of `warehouse.signals.value` on 2026-11-16 (median −1.2%: most
 * prices imply a little less than CAPM asks for). Recompute when the models
 * change.
 */
export function valuationBand(alpha: number | null): ValuationBand {
  if (alpha === null) return "unrated"
  if (alpha >= 0.022) return "deep-value"
  if (alpha >= 0.001) return "undervalued"
  if (alpha >= -0.029) return "fair"
  if (alpha >= -0.07) return "overvalued"
  return "expensive"
}

/**
 * Shown wherever bands are explained. Kept here beside the cut points so the
 * caveat cannot drift away from the thresholds it describes.
 */
export const BAND_BASIS =
  "Bands are quintiles of the S&P 500 by implied excess return, so they rank a company against the index. They are taken over the models selected."

/** Shown behind the info trigger on the implied-return column and tiles. */
export const IMPLIED_BASIS =
  "The annual return today's price implies, minus the return the stock's risk requires (WACC or CAPM cost of equity), averaged over the selected reverse-DCF models. +2% means the price implies 2 points a year more than the stock needs to earn. The backtest found its rank useful and its size not, so read it as a ranking, not a forecast."

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

/**
 * Text colour class for a band. Written out as literal Tailwind classes
 * (not `text-${band}` template strings) because Tailwind's scanner only
 * generates a utility for class names it can find as static text.
 */
export const BAND_TEXT_CLASS: Record<ValuationBand, string> = {
  "deep-value": "text-deep-value",
  undervalued: "text-undervalued",
  fair: "text-fair",
  overvalued: "text-overvalued",
  expensive: "text-expensive",
  unrated: "text-muted-foreground",
}

export type ScreenerFilters = {
  search: string
  /** Signal components the score averages (lib/signals.ts). Never empty. */
  signals: SignalId[]
  /** Keep only these fifths of the signal score. Empty keeps every stock. */
  signalBands: SignalBand[]
  sectors: string[]
  bands: ValuationBand[]
  /**
   * Restrict the implied excess return to these models. Empty means all four,
   * the backtested reading.
   */
  methods: MethodId[]
  maxBeta: number
}

/**
 * The screen the app opens on: ranked by the signal, restricted to the cheaper
 * three fifths of the index by implied excess return, beta at most 1.5.
 *
 * The value cut is expressed as bands because bands are the vocabulary the
 * distribution strip and every row's colour already use. 1.5 beta trims the
 * high-volatility tail without touching the market-tracking middle.
 *
 * Everything downstream reads the filtered set, so this is also what the
 * optimiser is handed on the screener's primary call to action.
 */
export const DEFAULT_FILTERS: ScreenerFilters = {
  search: "",
  signals: DEFAULT_SIGNALS,
  signalBands: [],
  sectors: [],
  bands: ["deep-value", "undervalued", "fair"],
  methods: [],
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

    if (
      filters.signalBands.length > 0 &&
      !filters.signalBands.includes(
        signalBand(signalScore(stock, filters.signals))
      )
    ) {
      return false
    }

    if (
      filters.bands.length > 0 &&
      !filters.bands.includes(valuationBand(impliedAlpha(stock, filters.methods)))
    ) {
      return false
    }

    return true
  })
}

/** What the models say about a whole portfolio, weighted by position size. */
export type PortfolioConsensus = {
  /**
   * `Σ(weight × implied excess return)` over every holding. A weighted sum
   * rather than an average, because portfolio weights already sum to one.
   */
  impliedAlpha: number
  /**
   * The share of portfolio weight at least one model could solve for. An
   * unrated holding enters the sum at zero, and this says how much of the
   * portfolio is resting on that default.
   */
  coverage: number
  ratedHoldings: number
  totalHoldings: number
}

/**
 * The implied excess return of a portfolio, weighted by position size. Short
 * positions enter with their sign.
 */
export function portfolioConsensus(
  weights: Record<string, number>,
  stocksByTicker: Map<string, Stock>,
  methods: MethodId[] = []
): PortfolioConsensus {
  const entries = Object.entries(weights)
  let alpha = 0
  let totalWeight = 0
  let coveredWeight = 0
  let rated = 0

  for (const [ticker, weight] of entries) {
    totalWeight += Math.abs(weight)
    const stock = stocksByTicker.get(ticker)
    const reading = stock ? impliedAlpha(stock, methods) : null
    if (reading === null) continue
    rated += 1
    coveredWeight += Math.abs(weight)
    alpha += weight * reading
  }

  return {
    impliedAlpha: alpha,
    coverage: totalWeight > 0 ? coveredWeight / totalWeight : 0,
    ratedHoldings: rated,
    totalHoldings: entries.length,
  }
}
