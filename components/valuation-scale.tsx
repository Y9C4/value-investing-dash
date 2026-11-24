import { formatPp } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  BAND_FILL,
  BAND_LABELS,
  valuationBand,
} from "@/lib/valuation"

const BAND_EDGE: Partial<Record<ReturnType<typeof valuationBand>, string>> = {
  undervalued: "var(--color-undervalued)",
  overvalued: "var(--color-overvalued)",
}

/** A value percentile as a bar filling from the left, coloured by its fifth. */
export function ValueBar({
  percentile,
  className,
}: {
  percentile: number | null
  className?: string
}) {
  const band = valuationBand(percentile)
  // Relative so the sr-only label is positioned here, not against the document.
  return (
    <div className={cn("relative", className)}>
      <div className="relative h-5 w-full" aria-hidden="true">
        <span className="absolute inset-x-0 inset-y-1 bg-muted" />
        {percentile !== null && (
          <span
            className="absolute inset-y-1 left-0"
            style={{
              width: `${(Math.max(0, Math.min(1, percentile)) * 100).toFixed(1)}%`,
              background: BAND_FILL[band],
              // The lighter Q4/Q2 fills fall below 3:1 on the track; a full-hue
              // edge keeps the bar's extent visible (WCAG non-text contrast).
              boxShadow: BAND_EDGE[band] ? `inset 0 0 0 1px ${BAND_EDGE[band]}` : undefined,
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

/** Past this the bar is pinned and the number beside it carries the rest. */
const BAR_DOMAIN = 0.1

/**
 * A diverging bar for one implied excess return: zero (the price implies
 * exactly the required return) is the centre tick, and the mark grows right
 * (implies more) or left (implies less). Coloured by sign, the absolute
 * reading, never by band, which needs a cross-section. The number sits beside
 * it in text ink, so the reading never depends on colour alone. The scale is
 * labelled under the bar; a reading past ±10 pp is pinned and its end says so.
 */
export function ImpliedReturnBar({
  alpha,
  className,
}: {
  alpha: number
  className?: string
}) {
  const pinned = Math.abs(alpha) > BAR_DOMAIN
  const magnitude = Math.min(Math.abs(alpha), BAR_DOMAIN) / BAR_DOMAIN
  const width = `${(magnitude * 50).toFixed(2)}%`
  const positive = alpha > 0
  // The pinned end reads "> +10 pp", so a clipped bar never passes for exactly 10.
  const end = (side: -1 | 1) =>
    `${pinned && (side > 0) === positive ? (side > 0 ? "> " : "< ") : ""}${formatPp(side * BAR_DOMAIN, 0)}`

  return (
    <div className={cn("relative", className)}>
      <div className="relative h-5 w-full" aria-hidden="true">
        {/* The ±10 pp track, ticked at both ends, so the bar reads as a scale. */}
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <span className="absolute inset-y-1.5 left-0 w-px bg-border" />
        <span className="absolute inset-y-1.5 right-0 w-px bg-border" />
        {/* Centre line = required return. It has to stay visible even when no
            bar touches it, so it uses the axis token at full strength. */}
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted-foreground" />
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
      <div
        className="relative mt-0.5 h-4 font-figure text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span className={cn("absolute left-0", pinned && !positive && "text-foreground")}>
          {end(-1)}
        </span>
        <span className="absolute left-1/2 -translate-x-1/2">0</span>
        <span className={cn("absolute right-0", pinned && positive && "text-foreground")}>
          {end(1)}
        </span>
      </div>
      <span className="sr-only">
        Price implies {formatPp(alpha)} a year against the required
        return
      </span>
    </div>
  )
}
