import type { FrontierResponse, Portfolio } from "@/lib/baseline-frontier"

/**
 * Which portfolio on the frontier the page is currently describing.
 *
 * A union rather than an index, because the two anchors are not simply two of
 * the solved points. `min_volatility` is `envelope[0]` — the trace starts at
 * the minimum-variance portfolio, so they are the same object by construction
 * — but `max_sharpe` is a separate refinement: `refine_tangency` ternary
 * searches *between* the solved targets and routinely returns a portfolio that
 * is on the curve without being on the grid. Storing "index 4" for it would be
 * storing the wrong portfolio.
 */
export type SelectedPortfolio =
  | { kind: "maxSharpe" }
  | { kind: "minVolatility" }
  | { kind: "envelope"; index: number }

export const MAX_SHARPE: SelectedPortfolio = { kind: "maxSharpe" }

/**
 * The two names that describe the same point, collapsed to one.
 *
 * Clicking the leftmost dot on the chart and clicking the "Min volatility" row
 * in the list are the same act, and both must light up the same mark. Rather
 * than force every call site to remember that, selections are compared through
 * here: index 0 and the min-volatility anchor answer as equal, and whichever
 * one the reader actually clicked is what gets stored.
 */
function canonical(selected: SelectedPortfolio): SelectedPortfolio {
  if (selected.kind === "envelope" && selected.index === 0) {
    return { kind: "minVolatility" }
  }
  return selected
}

export function isSameSelection(
  a: SelectedPortfolio,
  b: SelectedPortfolio
): boolean {
  const left = canonical(a)
  const right = canonical(b)
  if (left.kind !== right.kind) return false
  if (left.kind === "envelope" && right.kind === "envelope") {
    return left.index === right.index
  }
  return true
}

/**
 * Whether this point carries enough to be described.
 *
 * The baseline's illustrative points and any solve cached before the service
 * started sending per-point weights come back without them; both are ordinary
 * states rather than failures, and both mean the same thing to the UI.
 */
export function isSelectable(
  data: FrontierResponse,
  selected: SelectedPortfolio
): boolean {
  if (selected.kind !== "envelope") return true
  const point = data.envelope[selected.index]
  return Boolean(point?.weights)
}

/**
 * The portfolio a selection names, or the tangency when it names nothing.
 *
 * Falling back rather than throwing is deliberate: a restored selection can
 * outlive the solve it was made against — a cached index past the end of a
 * coarser curve, or a point whose weights this response does not carry — and
 * the honest answer in both cases is the portfolio the page defaults to
 * anyway, not a blank screen.
 */
export function resolvePortfolio(
  data: FrontierResponse,
  selected: SelectedPortfolio
): Portfolio {
  switch (selected.kind) {
    case "maxSharpe":
      return data.max_sharpe
    case "minVolatility":
      return data.min_volatility
    case "envelope": {
      const point = data.envelope[selected.index]
      if (!point?.weights) return data.max_sharpe
      return {
        return: point.return,
        volatility: point.volatility,
        sharpe: point.sharpe,
        weights: point.weights,
        risk_contributions: point.risk_contributions,
      }
    }
  }
}

/**
 * What to call the selected portfolio, on the header and on every panel that
 * describes it.
 *
 * The anchors keep their names. Everything else is numbered by its position
 * along the curve rather than labelled by its volatility: the figures on a
 * screened frontier can sit three decimal places apart, and "11.4%" repeated
 * down a list is not a label. One-indexed, because it is read by people.
 */
export function selectionLabel(
  data: FrontierResponse,
  selected: SelectedPortfolio
): string {
  const canonicalised = canonical(selected)
  switch (canonicalised.kind) {
    case "maxSharpe":
      return "Max Sharpe"
    case "minVolatility":
      return "Min volatility"
    case "envelope":
      return `Point ${canonicalised.index + 1} of ${data.envelope.length}`
  }
}
