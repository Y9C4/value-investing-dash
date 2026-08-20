/**
 * The case for screening before optimising, stated once at the top of the
 * workflow. Without it the screener reads as a table of numbers; the point is
 * that the filter upstream is what makes the optimiser downstream trustworthy.
 */
export function ScreenerRationale() {
  return (
    <section className="grid gap-px border-b border-border bg-border md:grid-cols-3">
      <div className="flex flex-col gap-2 bg-card px-6 py-6 lg:px-10">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          The problem
        </span>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Mean-variance optimisation estimates expected return from past return.
          A stock that has already multiplied therefore enters the solver
          looking like an exceptional opportunity — at exactly the moment its
          price embeds the most optimism. SanDisk&rsquo;s roughly 36x run over
          the past year is the shape of the problem: momentum that an optimiser
          reads as a forecast.
        </p>
      </div>

      <div className="flex flex-col gap-2 bg-card px-6 py-6 lg:px-10">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          The filter
        </span>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Nine valuation models price each company off its own fundamentals —
          dividends, free cash flow, book value, earnings power — and never off
          its price history. A stock whose price has outrun what those models
          can justify shows a deeply negative margin of safety and is filtered
          out before the optimiser is ever asked about it.
        </p>
      </div>

      <div className="flex flex-col gap-2 bg-card px-6 py-6 lg:px-10">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          The result
        </span>
        <p className="text-sm leading-relaxed text-muted-foreground">
          What survives is a wider, cheaper set of companies. The efficient
          frontier and capital market line are then drawn over that set alone,
          so the portfolio is diversified across names with defensible
          valuations rather than concentrated in whatever ran hardest last year.
        </p>
      </div>
    </section>
  )
}
