import { histogram } from "@/lib/rank"

const pp = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)}`

/**
 * How the index's implied excess returns are distributed: one bar per bin,
 * rust below zero (the price implies less than the risk requires), teal above.
 * Zero and the median are marked, so the headline median sits on its
 * distribution rather than standing alone.
 */
export function ExcessReturnHistogram({
  values,
  median,
}: {
  values: number[]
  median: number
}) {
  const bins = histogram(values)
  if (bins.length === 0) return null
  const peak = Math.max(...bins.map((b) => b.count))
  const lo = bins[0].lo
  const hi = bins[bins.length - 1].hi
  const at = (x: number) => `${(((Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)) * 100).toFixed(2)}%`
  const below = values.filter((v) => v < 0).length

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs text-muted-foreground">
        Implied excess return, pp a year, across {values.length} valued stocks. Each bar is a
        bin of {((bins[0].hi - bins[0].lo) * 100).toFixed(1)} pp (Freedman–Diaconis); the
        outer bars include the tails.
      </figcaption>

      <div
        role="img"
        aria-label={`${below} of ${values.length} stocks have an implied return below their required return; the median implied excess return is ${pp(median)} percentage points.`}
        className="relative mt-6 h-36"
      >
        <div className="absolute inset-0 flex items-end gap-0.5">
          {bins.map((bin) => (
            <div
              key={bin.lo}
              title={`${pp(bin.lo)} to ${pp(bin.hi)} pp: ${bin.count} stocks`}
              className="h-full flex-1 transition-opacity hover:opacity-70"
            >
              <div className="flex h-full flex-col justify-end">
                <div
                  style={{
                    height: `${(bin.count / peak) * 100}%`,
                    background:
                      bin.hi <= 0 ? "var(--color-overvalued)" : "var(--color-undervalued)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Zero: implied equals required. */}
        <span className="absolute inset-y-0 w-px bg-foreground" style={{ left: at(0) }} aria-hidden="true" />
        {/* The median, dashed, labelled at the top. */}
        <span
          className="absolute inset-y-0 border-l border-dashed border-foreground/70"
          style={{ left: at(median) }}
          aria-hidden="true"
        />
        <span
          className="absolute -top-5 -translate-x-1/2 font-mono text-xs whitespace-nowrap"
          style={{ left: at(median) }}
          aria-hidden="true"
        >
          median {pp(median)}
        </span>
      </div>

      <div className="relative h-4 font-mono text-xs text-muted-foreground" aria-hidden="true">
        <span className="absolute left-0">{pp(lo)}</span>
        <span className="absolute -translate-x-1/2" style={{ left: at(0) }}>0</span>
        <span className="absolute right-0">{pp(hi)}</span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>implied &lt; required: priced dear</span>
        <span>implied &gt; required: priced cheap</span>
      </div>
    </figure>
  )
}
