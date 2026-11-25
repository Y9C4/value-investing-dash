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

import { quintile } from "@/lib/rank"

export type MethodId = "fcff" | "rim" | "revenue" | "shareholderYield"

export type ValuationMethod = {
  id: MethodId
  label: string
  /** Expanded name, shown once in the methodology panel. */
  full: string
  /** One line the user can act on — what the method rewards. */
  blurb: string
  /** The core expression the implied return solves, in LaTeX. */
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
    formula: "\\text{EV} = \\sum_{t=1}^{5} \\frac{\\text{FCFF}_t}{(1+r)^t} + \\text{terminal}",
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
    formula: "E = B_0 + \\sum_{t} \\frac{(\\text{ROE}_t - r)\\,B_{t-1}}{(1+r)^t}",
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
      "Grows revenue and fades the cash margin toward the sector median, then solves for the return that justifies the enterprise value. Works for companies whose cash flow is temporarily negative. Measured against WACC.",
    formula: "\\text{EV} = \\sum_{t=1}^{5} \\frac{\\text{Rev}_t \\cdot \\text{margin}_t}{(1+r)^t} + \\text{terminal}",
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
    formula: "E = \\sum_{t=1}^{5} \\frac{(\\text{divs} + \\text{buybacks})_t}{(1+r)^t} + \\text{terminal}",
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
  /** The OLS beta before Levi-Welch shrinkage. Absent on the sample. */
  betaRaw?: number | null
  /** EBIT / interest expense, the input to the synthetic rating. */
  interestCoverage?: number | null
  /** Damodaran synthetic rating the cost of debt is priced off. */
  syntheticRating?: string | null
}

/**
 * Classic ratios, shown beside the signal as context (not part of it). Each is
 * null where its denominator makes it meaningless. Absent on the sample, which
 * predates them; `loadUniverse` fills those with nulls.
 */
export type StockRatios = {
  /** FCFF / enterprise value. */
  fcfYield: number | null
  /** Enterprise value / EBITDA, positive EBITDA only. */
  evEbitda: number | null
  /** Market cap / book equity, positive book only. */
  pbRatio: number | null
  /** (Dividends + net buybacks) / market cap. */
  shareholderYield: number | null
  /** Net income / book equity. */
  roe: number | null
  /** Trailing revenue CAGR (2-year, else 1-year), as reported. */
  revenueGrowth: number | null
  /** Annual revenue, US$ billions. */
  revenueBn: number | null
}

export type Stock = {
  ticker: string
  name: string
  sector: string
  price: number
  /** US$ billions. Null fields below were not measured: never read them as 0. */
  marketCap: number | null
  beta: number | null
  peRatio: number | null
  dividendYield: number | null
  /** Annualised expected return actually realised over the window. */
  realisedReturn: number | null
  /** Annualised volatility over the same window. */
  volatility: number | null
  /** Absent on the offline sample, which has no rates to report. */
  discountRates?: DiscountRates
  /** The tested signal (lib/signals.ts). Absent on a stock with no data. */
  signals?: StockSignals
} & StockRatios

/**
 * The signal's components for one stock, from `warehouse.signals`. Each rank is
 * a percentile (0-1] within today's universe; null where the component could
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
  /**
   * The starting FCFF growth (fading to long-run growth over five years) at
   * which the enterprise value is worth exactly today's price at the WACC.
   * Display only. Absent on the sample.
   */
  impliedGrowth?: number | null
  /** True when the price needs more growth than the solver's 100%/yr ceiling. */
  impliedGrowthAboveMax?: boolean | null
}

/** Every modelled method, for the "all of them" reading of an empty selection. */
const METHOD_IDS: MethodId[] = VALUATION_METHODS.map((method) => method.id)

const AGAINST: Record<MethodId, ValuationMethod["against"]> = Object.fromEntries(
  VALUATION_METHODS.map((method) => [method.id, method.against])
) as Record<MethodId, ValuationMethod["against"]>

/** The fields the implied-return helpers read: all a valuation reading needs. */
export type Valued = {
  signals?: Pick<StockSignals, "impliedReturns" | "requiredReturnEquity" | "requiredReturnFirm">
}

/** The required return one model is measured against, or null. */
export function requiredReturn(stock: Valued, method: MethodId): number | null {
  const signals = stock.signals
  if (!signals) return null
  return AGAINST[method] === "wacc"
    ? signals.requiredReturnFirm
    : signals.requiredReturnEquity
}

/** One model's implied return minus its required return, per year, or null. */
export function methodAlpha(stock: Valued, method: MethodId): number | null {
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
  stock: Valued,
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

/**
 * The mean implied and mean required return over the models that solved, per
 * year. Their difference is `impliedAlpha(stock)`; shown apart because two
 * plain rates read more easily than their gap.
 */
export function impliedAndRequired(stock: Valued): { implied: number; required: number } | null {
  let implied = 0
  let required = 0
  let n = 0
  for (const id of METHOD_IDS) {
    const r = stock.signals?.impliedReturns[id] ?? null
    const k = requiredReturn(stock, id)
    if (r === null || k === null) continue
    implied += r
    required += k
    n += 1
  }
  return n === 0 ? null : { implied: implied / n, required: required / n }
}

export type ValuationBand =
  | "deep-value"
  | "undervalued"
  | "fair"
  | "overvalued"
  | "expensive"
  // No model could solve for this company. Distinct from the middle band on
  // purpose: no reading is not the same claim as an average one.
  | "unrated"

/**
 * The fifth of today's index a stock's value percentile falls in.
 *
 * RELATIVE, NOT ABSOLUTE. A cross-sectional quintile sort with breakpoints
 * recomputed from the live distribution (Fama & French), the same sort as the
 * backtest's Q5 − Q1 test, so "cheapest fifth" means exactly that and nothing
 * more. The percentile comes from `rankUniverse` in `lib/screen.ts`, over the
 * models selected. Whether a price implies more or less than the required
 * return is a separate, absolute fact: see `gapTextClass`.
 */
export function valuationBand(percentile: number | null): ValuationBand {
  if (percentile === null) return "unrated"
  return (
    {
      5: "deep-value",
      4: "undervalued",
      3: "fair",
      2: "overvalued",
      1: "expensive",
    } as const
  )[quintile(percentile)]
}

/**
 * Shown wherever bands are explained. Kept here beside the band rule so the
 * caveat cannot drift away from what it describes.
 */
export const BAND_BASIS =
  "Stocks are split into five equal groups by return gap, from Q5 (the cheapest 20% of the S&P 500) to Q1 (the most expensive 20%), redrawn at every data refresh (Fama & French 1992). This compares a stock with the rest of the index, so Q5 does not mean cheap in absolute terms."

/** Shown behind the info trigger on the value column and tiles. */
export const IMPLIED_BASIS =
  "The return gap is the yearly return today's price implies, minus the return the stock's risk requires (WACC for FCFF and revenue, cost of equity for residual income and shareholder yield), averaged over the selected reverse-DCF models. +2 pp means the price implies 2 percentage points a year more than required. In testing, the order of stocks by this gap was informative but its size was not, so we rank on it and do not treat it as a forecast."

export const BAND_LABELS: Record<ValuationBand, string> = {
  "deep-value": "Q5 · cheapest",
  undervalued: "Q4",
  fair: "Q3",
  overvalued: "Q2",
  expensive: "Q1 · most expensive",
  unrated: "Not valued",
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

/**
 * Colour for an implied excess return by its sign: the absolute reading
 * (price implies more, or less, than the risk requires), as opposed to the
 * relative band. Used where there is no cross-section to rank against: one
 * model's reading, or a portfolio's.
 */
export function gapTextClass(alpha: number | null): string {
  if (alpha === null || alpha === 0) return "text-muted-foreground"
  return alpha > 0 ? "text-undervalued" : "text-overvalued"
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
  stocksByTicker: Map<string, Valued>,
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
