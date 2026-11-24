/**
 * Labels and "why is this missing" reasons shared by the stock page's panels,
 * so the verdict, the model table and the implied-growth tile say the same
 * thing about the same gap. Each reason is read off the inputs the warehouse
 * solves from (supabase/migrations/20261123000001_principled_spec.sql).
 */

import { SIGNAL_BAND_LABELS, type SignalBand } from "@/lib/signals"
import {
  BAND_LABELS,
  requiredReturn,
  type MethodId,
  type Stock,
  type ValuationBand,
  type ValuationMethod,
} from "@/lib/valuation"

/** "Value quintile 5 · cheapest": the prefixed form, for pages that also show composite quintiles. */
export const valueQuintileLabel = (band: ValuationBand) =>
  band === "unrated" ? BAND_LABELS.unrated : `Value ${BAND_LABELS[band].replace("Q", "quintile ")}`

/** "Composite quintile 5 · highest". */
export const compositeQuintileLabel = (band: SignalBand) =>
  band === "unscored"
    ? SIGNAL_BAND_LABELS.unscored
    : `Composite ${SIGNAL_BAND_LABELS[band].replace("Q", "quintile ")}`

const FINANCIAL = "Financial Services"
const NO_KE = "No cost of equity: no beta measured (needs 120 of the last 252 sessions)"

/** Why the stock has no WACC, in the order the warehouse rules it out; null when it has one. */
export function noWaccReason(stock: Stock): string | null {
  if (stock.signals?.requiredReturnFirm != null) return null
  if (stock.sector === FINANCIAL) return "No WACC: not computed for financial firms, whose debt is operating capital"
  if (stock.signals?.requiredReturnEquity == null) return "No WACC: no cost of equity, because no beta was measured"
  if (stock.marketCap === null) return "No WACC: no market capitalisation to weight equity by"
  if (stock.discountRates?.costOfDebt == null) return "No WACC: cost of debt unmeasured (no interest expense reported)"
  return "No WACC: a capital-structure input is missing"
}

// The solver brackets the rate between long-run growth and 100% a year and
// reports nothing outside it, so "above 100%" and "below growth" look alike.
const UNBRACKETED = "Did not solve: no rate between long-run growth and 100% a year fits the price, or an input is missing"

/** Why one model has no implied return, as far as the stored ratios can tell. */
function unsolvedReason(stock: Stock, id: MethodId): string {
  // Without a market cap there is no price for any model to solve against.
  if (stock.marketCap === null) return "Did not solve: no market capitalisation (share count missing)"
  if (id === "fcff" || id === "revenue") {
    if (stock.fcfYield === null) return "Did not solve: no free cash flow figure"
    if (id === "fcff" && stock.fcfYield <= 0) return "Did not solve: free cash flow is not positive"
  }
  if (id === "rim" && stock.pbRatio === null) return "Did not solve: book equity not positive or not reported"
  if (id === "shareholderYield" && (stock.shareholderYield ?? 0) <= 0) {
    return "Did not solve: no net cash returned to shareholders"
  }
  return UNBRACKETED
}

/** Why one model's row has no implied − required reading; null when it has one. */
export function missingReason(stock: Stock, method: ValuationMethod): string | null {
  const noRequired =
    requiredReturn(stock, method.id) === null
      ? method.against === "wacc"
        ? noWaccReason(stock)
        : NO_KE
      : null
  // A firm-level model on a financial firm is out by design, solved or not.
  if (noRequired && stock.sector === FINANCIAL) return noRequired
  if (stock.signals?.impliedReturns[method.id] == null) return unsolvedReason(stock, method.id)
  return noRequired
}

/** Why the implied FCFF growth did not solve (warehouse.implied_growth_cashflow). */
export function noGrowthReason(stock: Stock): string {
  const wacc = noWaccReason(stock)
  if (wacc) return `${wacc}, so there is no rate to solve the growth at.`
  if (stock.fcfYield === null) return "No free cash flow figure to grow."
  if (stock.fcfYield <= 0) return "Free cash flow is not positive, so no growth rate reaches the price."
  const firm = stock.signals?.requiredReturnFirm ?? 0
  if (firm <= 0.025) return "WACC is not above long-run growth (2.5%), so the terminal value has no finite price."
  return "No growth rate between −99% and 100% a year fits the price at this WACC."
}
