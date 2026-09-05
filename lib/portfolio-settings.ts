/**
 * The optimiser's exposed controls, and the rules for turning what someone
 * typed into a request the solver can meet.
 *
 * Every field is a string, not a number: a controlled numeric input has to be
 * able to hold "", "-" and "0." mid-typing. Parsing happens once, here.
 */

export const MIN_PORTFOLIOS = 2
// Each point is a real solve, so the ceiling tracks solver cost. Must stay in
// step with MAX_ENVELOPE_POINTS in api/frontier.py.
//
// The ceiling is not always reachable: the service budgets points x assets and
// answers with the resolution it could afford, which the response reports. Over
// a screened set of a few dozen names the full 200 are solved; over the whole
// index the budget allows about 24.
export const MAX_PORTFOLIOS = 200
// Must equal ENVELOPE_POINTS in api/frontier.py. The cache key is built from
// the resolved point count, so a default here that differs from the one the
// nightly precompute stored means every default visit misses the snapshot and
// pays a real solve. Measured on Cloud Run before this was aligned: 64.7s for
// a live 8-point solve, against a snapshot read for the same curve.
//
// Four is the floor, because a request for N returns N-1 points over the full
// index: the maximum-return target is infeasible under the weight cap. At 3
// the envelope is two points, a straight chord rather than a curve, and the
// tangency comes back at Sharpe 2.8014 against 2.9478 from 4 upwards. See the
// measured table beside ENVELOPE_POINTS in api/frontier.py.
export const DEFAULT_PORTFOLIOS = 4
export const MAX_GAMMA = 5

export type PortfolioSettings = {
  /** Points solved along the frontier. */
  portfolios: string
  /** Shorthand for a symmetric negative floor; an explicit minWeight wins. */
  shortAllowed: boolean
  /** Percent. Blank defers to the backend; negative permits shorting. */
  minWeight: string
  /** Percent. Blank defers to the backend's universe-scaled cap. */
  maxWeight: string
  /** L2 penalty. 0 leaves the solve unregularised. */
  gamma: string
}

export const DEFAULT_SETTINGS: PortfolioSettings = {
  portfolios: String(DEFAULT_PORTFOLIOS),
  shortAllowed: false,
  minWeight: "",
  maxWeight: "",
  gamma: "0",
}

export type SettingsErrors = Partial<Record<keyof PortfolioSettings, string>>

function parseOptionalPercent(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed / 100 : undefined
}

/**
 * Field-level problems, empty when the settings are sendable.
 *
 * Only what can be judged without knowing the universe size. Whether a 2% cap
 * can fill a portfolio depends on how many stocks survived the history filter,
 * which the browser does not know; the backend answers that one.
 */
export function validateSettings(settings: PortfolioSettings): SettingsErrors {
  const errors: SettingsErrors = {}

  const portfolios = Number(settings.portfolios)
  if (
    !Number.isInteger(portfolios) ||
    portfolios < MIN_PORTFOLIOS ||
    portfolios > MAX_PORTFOLIOS
  ) {
    errors.portfolios = `Whole number, ${MIN_PORTFOLIOS}–${MAX_PORTFOLIOS}.`
  }

  const gamma = Number(settings.gamma.trim() === "" ? "0" : settings.gamma)
  if (!Number.isFinite(gamma) || gamma < 0 || gamma > MAX_GAMMA) {
    errors.gamma = `Between 0 and ${MAX_GAMMA}.`
  }

  const min = parseOptionalPercent(settings.minWeight)
  const max = parseOptionalPercent(settings.maxWeight)

  if (min === undefined) errors.minWeight = "Not a number."
  else if (min !== null && (min < -1 || min > 1)) {
    errors.minWeight = "Between -100% and 100%."
  }

  if (max === undefined) errors.maxWeight = "Not a number."
  else if (max !== null && (max < -1 || max > 1)) {
    errors.maxWeight = "Between -100% and 100%."
  }

  if (
    typeof min === "number" &&
    min !== null &&
    typeof max === "number" &&
    max !== null &&
    min > max
  ) {
    errors.minWeight = "Above the maximum."
  }

  return errors
}

/**
 * The request for `POST /api/efficient-frontier`.
 *
 * Settings go in the query string; the **ticker list goes in the body**, which
 * is why this returns a request rather than a query. A URL is a header: it
 * counts against Node's 16KB budget alongside the reader's cookies, and
 * spelling out the index inline made it ~3KB, so the page 431'd for anyone
 * carrying 13KB of cookies.
 *
 * Blank bounds are omitted rather than sent as zero, which is what keeps
 * "auto" distinguishable from "no short side" on the wire.
 */
export function buildFrontierRequest(
  settings: PortfolioSettings,
  tickers: readonly string[]
): { query: URLSearchParams; init: RequestInit } {
  const query = new URLSearchParams({
    short_allowed: String(settings.shortAllowed),
    n_portfolios: String(Number(settings.portfolios)),
  })

  const gamma = Number(settings.gamma.trim() === "" ? "0" : settings.gamma)
  if (gamma > 0) query.set("gamma", String(gamma))

  const min = parseOptionalPercent(settings.minWeight)
  if (typeof min === "number" && min !== null) {
    query.set("min_weight", String(min))
  }
  const max = parseOptionalPercent(settings.maxWeight)
  if (typeof max === "number" && max !== null) {
    query.set("max_weight", String(max))
  }

  return {
    query,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tickers }),
    },
  }
}

/**
 * Effective number of holdings: the reciprocal Herfindahl index, `1 / Σw²`.
 *
 * The honest answer to "how diversified is this?": a sixty-name portfolio
 * with fifty-five at a rounding error is not a sixty-name portfolio.
 */
export function effectiveHoldings(weights: Record<string, number>): number {
  const herfindahl = Object.values(weights).reduce(
    (total, weight) => total + weight * weight,
    0
  )
  return herfindahl > 0 ? 1 / herfindahl : 0
}
