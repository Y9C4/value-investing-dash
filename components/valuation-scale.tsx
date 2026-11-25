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
