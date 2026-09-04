import {
  BAND_FILL,
  BAND_LABELS,
  valuationBand,
} from "@/lib/valuation"

/**
 * The bands are not centred on zero. Half the models credit no growth, so the
 * index-wide consensus sits well below it; the cut points track the observed
 * distribution instead. See `valuationBand` for the full reasoning.
 */

/**
 * A margin of safety, where the sign is the reading rather than an annotation
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

/**
 * The diverging bar every row of the screener carries: fair value is the centre
 * tick, and the mark grows left (expensive) or right (cheap) from it. The
 * numeric value sits beside it in text ink, so the reading never depends on
 * colour alone.
 */
export function MarginBar({
  margin,
  className,
}: {
  margin: number
  className?: string
}) {
  const band = valuationBand(margin)
  // Clamped to ±60%; past that the bar is pinned and the number carries the rest.
  const magnitude = Math.min(Math.abs(margin), 0.6) / 0.6
  const width = `${(magnitude * 50).toFixed(2)}%`
  const positive = margin > 0

  return (
    <div className={className}>
      <div className="relative h-5 w-full" aria-hidden="true">
        {/* Centre line = fair value. It has to stay visible even when no bar
            touches it, so it uses the axis token at full strength. */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground/40" />
        <span
          className="absolute inset-y-1"
          style={{
            background: BAND_FILL[band],
            width,
            ...(positive
              ? { left: "50%", marginLeft: "1px" }
              : { right: "50%", marginRight: "1px" }),
          }}
        />
      </div>
      <span className="sr-only">
        {BAND_LABELS[band]}, {formatSignedPercent(margin)} margin of safety
      </span>
    </div>
  )
}
