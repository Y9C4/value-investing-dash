/**
 * The optimiser's exposed controls, and the rules for turning what someone
 * typed into a request the solver can actually meet.
 *
 * Every field is kept as a string rather than a number. A controlled numeric
 * input has to be able to hold "", "-" and "0." mid-typing, and coercing those
 * to a number on every keystroke either snaps the caret around or silently
 * substitutes a value nobody asked for. Parsing happens once, here, at the
 * boundary.
 *
 * Empty means *auto* for the two position bounds, and auto is not the same as
 * zero: the backend scales the cap to the size of the universe, because a 3%
 * cap cannot add up to a whole portfolio across fewer than 34 names. Leaving
 * the field blank defers to that; typing a number overrides it.
 */

export const MIN_PORTFOLIOS = 2
// Every frontier point is a solved portfolio rather than a step along a line
// between two anchors, so the ceiling tracks real solver cost. Must stay in
// step with MAX_ENVELOPE_POINTS in the market-data service.
export const MAX_PORTFOLIOS = 200
export const DEFAULT_PORTFOLIOS = 100
export const MAX_GAMMA = 5

export type PortfolioSettings = {
  /** Points solved along the frontier. */
  portfolios: string
  /** Shorthand for a symmetric negative floor; an explicit minWeight wins. */
  shortAllowed: boolean
  /** Percent. Blank defers to the backend, negative permits shorting. */
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
 * Only what can be judged without knowing the universe size is checked here.
 * Whether a 2% cap can fill a portfolio depends on how many stocks survived
 * the history filter, which the browser does not know — the backend answers
 * that one, and names the threshold in its message.
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
 * The settings go in the query string and the **ticker list goes in the body**,
 * which is the whole reason this returns a request rather than a query.
 * Spelling out the index inline made the URL ~3KB, and a URL is a header: it
 * sits in the request line and counts against Node's 16KB header budget
 * alongside every cookie the reader happens to be carrying. At 13KB of cookies
 * the dev server answered `431 Request Header Fields Too Large` and the page
 * reported an optimiser failure for a request the optimiser never saw.
 *
 * Moving it to the body takes the request line from ~3KB to under 100 bytes.
 * Only the unbounded field moves: the scalars stay in the query so the call is
 * still legible in a network panel, and they cannot grow.
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
 * Sum of squared weights — the Herfindahl index. Its reciprocal is the
 * effective number of holdings, which is the honest answer to "how diversified
 * is this?": a sixty-name portfolio with fifty-five of them at a rounding
 * error is not a sixty-name portfolio. It is also the number that visibly
 * moves when the bounds tighten, which is what makes those controls legible
 * rather than mystery dials.
 */
export function effectiveHoldings(weights: Record<string, number>): number {
  const herfindahl = Object.values(weights).reduce(
    (total, weight) => total + weight * weight,
    0
  )
  return herfindahl > 0 ? 1 / herfindahl : 0
}
