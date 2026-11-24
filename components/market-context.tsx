import { RiArrowDownSFill, RiArrowUpSFill } from "@remixicon/react"

import { PageLabel } from "@/components/page-label"
import { StockSearch } from "@/components/stock-search"
import { formatDataTimestamp } from "@/lib/format"
import { type IndexLevel } from "@/lib/universe"
import { cn } from "@/lib/utils"

/**
 * The as-of strip that runs above every page.
 *
 * A dashboard that does not say when its numbers were taken is a screenshot.
 * Everything here is already in the universe payload, so the bar costs no
 * request of its own — it just stops the state of the data from being
 * something the reader has to infer from a caption halfway down the page.
 *
 * Each field is independently optional. The sample universe has no index and
 * no rate, and the strip degrades to whatever it can actually assert rather
 * than rendering a row of em dashes.
 *
 * It also carries the page's name, which is where the per-page header block
 * went: the strip is on every route already, and a name in a strip that is
 * always there beats a name in a header that costs an eighth of the window.
 *
 * There was a per-stage breakdown behind the timestamp — when prices,
 * statements, profiles and factors each last landed. It answered a question
 * only the person running the ingest has, and this strip is read by someone
 * deciding whether to trust the table below it. One timestamp answers that.
 * The stages are still recorded in `job_runs`; nothing was lost but the popover.
 */

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-xs">{children}</span>
    </div>
  )
}

export function MarketContext({
  index,
  riskFreeRate,
  computedAt,
  gatheredAt,
  isStale,
  stocks,
  isBaseline,
}: {
  /** For the search box. */
  stocks: { ticker: string; name: string }[]
  index: IndexLevel | null
  riskFreeRate: number | null
  computedAt: string | null
  /** When data was last fetched; see `Universe.gatheredAt`. */
  gatheredAt: string | null
  /** Decided by `loadUniverse`; see the note on `Universe.isStale`. */
  isStale: boolean
  isBaseline: boolean
}) {
  // The stamp is when data was gathered, falling back to when it was computed
  // over. Those are separate claims and the label changes with them, because
  // "collected" over a recompute-only timestamp would be a false one.
  const collected = Boolean(gatheredAt)
  const stamp = gatheredAt ?? computedAt

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b lg:flex-nowrap border-border bg-card px-6 py-2.5 lg:px-10">
      {/* First, and set apart from the fields: this names the page rather than
          reporting a number about the market, so it does not take the
          label-over-value form the rest of the strip uses. */}
      <PageLabel />


      {index && (
        <Field label="S&P 500">
          {index.close.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          {index.change !== null && (
            <span
              className={cn(
                "ml-2 inline-flex items-baseline",
                index.change >= 0 ? "text-undervalued" : "text-overvalued"
              )}
            >
              {/* Direction is carried by the arrow as well as the hue, so the
                  strip still reads without colour vision. */}
              {index.change >= 0 ? (
                <RiArrowUpSFill className="size-3 self-center" aria-hidden="true" />
              ) : (
                <RiArrowDownSFill className="size-3 self-center" aria-hidden="true" />
              )}
              {Math.abs(index.change * 100).toFixed(2)}%
            </span>
          )}
        </Field>
      )}


      {riskFreeRate !== null && (
        <Field label="T-bill (3M)">{(riskFreeRate * 100).toFixed(2)}%</Field>
      )}




      <Field
        label={isBaseline ? "Sample" : collected ? "Collected" : "Computed"}
      >
        {isBaseline ? (
          <span className="text-status-warning">
            illustrative — service unreachable
          </span>
        ) : stamp ? (
          <span className={cn(isStale && "text-status-warning")}>
            {formatDataTimestamp(stamp)}
          </span>
        ) : (
          "live"
        )}
      </Field>

      <div className="ml-auto">
        <StockSearch stocks={stocks} />
      </div>
    </div>
  )
}
