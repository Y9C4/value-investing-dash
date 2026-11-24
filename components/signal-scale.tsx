import { cn } from "@/lib/utils"
import {
  SIGNAL_BAND_FILL,
  SIGNAL_BAND_LABELS,
  formatScore,
  signalBand,
} from "@/lib/signals"

/**
 * A percentile as a bar filling from the left, coloured by its fifth.
 *
 * One-sided rather than the margin bar's diverging shape: a rank runs from
 * worst to best with no fair-value centre to grow away from. The number sits
 * beside it in text ink wherever it is used, so the reading never depends on
 * colour alone.
 */
export function SignalBar({
  score,
  className,
}: {
  score: number | null
  className?: string
}) {
  const band = signalBand(score)

  return (
    // Relative, so the sr-only label (absolutely positioned) is contained here
    // rather than by some distant ancestor, where it made the page overscroll.
    <div className={cn("relative", className)}>
      <div className="relative h-5 w-full" aria-hidden="true">
        {/* The track, so an empty or low bar still shows the scale it is on. */}
        <span className="absolute inset-x-0 inset-y-1 bg-muted" />
        {score !== null && (
          <span
            className="absolute inset-y-1 left-0"
            style={{
              width: `${(Math.max(0, Math.min(1, score)) * 100).toFixed(1)}%`,
              background: SIGNAL_BAND_FILL[band],
              // Q1 and Q2 indigo is under 3:1 against the track (Q1 2.0:1
              // dark, 1.7:1 light). An inset muted-foreground edge (≥4.7:1
              // against the track in both themes) keeps those bars' extent
              // visible without touching the palette; Q3–Q5 already clear 3:1.
              boxShadow:
                band === "q1" || band === "q2" ? "inset 0 0 0 1px var(--color-muted-foreground)" : undefined,
            }}
          />
        )}
      </div>
      <span className="sr-only">
        {SIGNAL_BAND_LABELS[band]}, percentile {formatScore(score)} of 100
      </span>
    </div>
  )
}
