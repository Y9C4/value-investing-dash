/** Shared number formatting for the portfolio surfaces. */

/** Two decimals — the resolution weights are rounded to on the wire. */
export function formatPercent(value: number) {
  return value.toLocaleString("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Axis ticks, where two decimals would collide long before they informed. */
export function formatAxisPercent(value: number) {
  return value.toLocaleString("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  })
}

/**
 * A percent tick formatter with enough decimals for the range being plotted.
 *
 * Whole percents are right for a 0–20% axis and wrong for an 11–15% one, where
 * they print "12%" twice in a row and the reader is left deciding which tick
 * lied.
 */
export function percentTickFormatter(span: number) {
  const digits = span < 0.05 ? 1 : 0
  return (value: number) =>
    value.toLocaleString("en-US", {
      style: "percent",
      maximumFractionDigits: digits,
    })
}

// Round steps a reader can do arithmetic on. Recharts' own tick placement is
// scaled to the data, which produces axes like 0 / 5 / 9 / 14 / 18%.
const NICE_STEPS = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5]

/**
 * Domain and ticks for a percent axis that starts at zero (or at a round
 * negative bound when some values are short positions).
 */
export function nicePercentAxis(
  values: number[],
  targetTicks = 5
): { domain: [number, number]; ticks: number[] } {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 0.01
  const step = NICE_STEPS.find((s) => s >= span / targetTicks) ?? 1

  const low = Math.floor(min / step) * step
  const high = Math.ceil(max / step) * step

  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) {
    // Accumulated float error would otherwise print 0.30000000000000004.
    ticks.push(Number(tick.toFixed(6)))
  }

  return { domain: [low, high], ticks }
}

/**
 * Keeps the sign visible on values that can go negative — a short position, or
 * a holding whose risk contribution is negative because it hedges the rest.
 * Without the explicit "+" a reader has to scan for minus signs to notice that
 * some rows are on the other side of zero.
 */
export function formatSignedPercent(value: number) {
  const formatted = formatPercent(Math.abs(value))
  return value < 0 ? `−${formatted}` : formatted
}

/**
 * Market capitalisation, given in billions, rendered the way it is spoken.
 *
 * `$4.52T` and `$743B`, never `4520.31` — a column of raw billions makes the
 * reader do the magnitude arithmetic that the unit exists to do for them.
 */
export function formatMarketCap(billions: number) {
  if (!billions || billions <= 0) return "—"
  if (billions >= 1000) return `$${(billions / 1000).toFixed(2)}T`
  if (billions >= 100) return `$${billions.toFixed(0)}B`
  if (billions >= 1) return `$${billions.toFixed(1)}B`
  return `$${(billions * 1000).toFixed(0)}M`
}

/**
 * The timezone every as-of stamp is rendered in.
 *
 * Fixed rather than the reader's own, for two reasons. The context strip is
 * rendered on the server inside a statically-rendered layout, so a local time
 * would either be the server's — meaningless — or force the whole strip into a
 * client component to be re-rendered after hydration. And an as-of stamp on
 * market data is more useful in market time than in the reader's: "06:42 EDT"
 * places the refresh before the open, which is the fact worth knowing.
 */
const DATA_TIMEZONE = "America/Toronto"

/**
 * A precise as-of stamp: `SEP 04, 2026 · 06:42 EDT`.
 *
 * To the minute, and named. A date alone cannot distinguish data pulled before
 * this morning's open from data pulled after yesterday's close, which is the
 * only distinction the stamp is there to make.
 */
export function formatDataTimestamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return "—"

  const date = at
    .toLocaleDateString("en-US", {
      timeZone: DATA_TIMEZONE,
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .toUpperCase()

  const time = at.toLocaleTimeString("en-US", {
    timeZone: DATA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  })

  return `${date} · ${time}`
}
