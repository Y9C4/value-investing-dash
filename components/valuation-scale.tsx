import {
  BAND_FILL,
  BAND_LABELS,
  valuationBand,
} from "@/lib/valuation"

/** A value percentile as a bar filling from the left, coloured by its fifth. */
export function ValueBar({
  percentile,
  className,
}: {
  percentile: number | null
  className?: string
}) {
  const band = valuationBand(percentile)
  return (
    <div className={className}>
      <div className="relative h-5 w-full" aria-hidden="true">
        <span className="absolute inset-x-0 inset-y-1 bg-muted" />
        {percentile !== null && (
          <span
            className="absolute inset-y-1 left-0"
            style={{
              width: `${(Math.max(0, Math.min(1, percentile)) * 100).toFixed(1)}%`,
              background: BAND_FILL[band],
            }}
          />
        )}
      </div>
      <span className="sr-only">
        {BAND_LABELS[band]}
        {percentile !== null && `, value ${Math.round(percentile * 100)} of 100`}
      </span>
    </div>
  )
}

/**
 * A signed percentage where the sign is the reading rather than an annotation
 * on it: an explicit `+` for cheap, `−` for expensive, one decimal.
 *
 * See the note on the same-named function in `lib/format.ts` — that one is for
 * returns and weights, and the two must not be swapped.
 */
export function formatSignedPercent(value: number) {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  if (value > 0.0005) return `+${formatted}`
  if (value < -0.0005) return `−${formatted}`
  return "0.0%"
}

/** Past this the bar is pinned and the number beside it carries the rest. */
const BAR_DOMAIN = 0.1

/**
 * A diverging bar for one implied excess return: zero (the price implies
 * exactly the required return) is the centre tick, and the mark grows right
 * (implies more) or left (implies less). Coloured by sign, the absolute
 * reading, never by band, which needs a cross-section. The number sits beside
 * it in text ink, so the reading never depends on colour alone.
 */
export function ImpliedReturnBar({
  alpha,
  className,
}: {
  alpha: number
  className?: string
}) {
  const magnitude = Math.min(Math.abs(alpha), BAR_DOMAIN) / BAR_DOMAIN
  const width = `${(magnitude * 50).toFixed(2)}%`
  const positive = alpha > 0

  return (
    <div className={className}>
      <div className="relative h-5 w-full" aria-hidden="true">
        {/* Centre line = required return. It has to stay visible even when no
            bar touches it, so it uses the axis token at full strength. */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/40" />
        <span
          className="absolute inset-y-1"
          style={{
            background: positive
              ? "var(--color-undervalued)"
              : "var(--color-overvalued)",
            width,
            ...(positive
              ? { left: "50%", marginLeft: "1px" }
              : { right: "50%", marginRight: "1px" }),
          }}
        />
      </div>
      <span className="sr-only">
        Price implies {formatSignedPercent(alpha)} a year against the required
        return
      </span>
    </div>
  )
}
