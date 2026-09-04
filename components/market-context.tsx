import { RiArrowDownSFill, RiArrowUpSFill } from "@remixicon/react"

import { PageLabel } from "@/components/page-label"
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
      <span className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-xs tabular-figures">{children}</span>
    </div>
  )
}

function Separator() {
  return (
    <span className="text-border select-none" aria-hidden="true">
      /
    </span>
  )
}

export function MarketContext({
  index,
  riskFreeRate,
  computedAt,
  gatheredAt,
  isStale,
  universeSize,
  isBaseline,
}: {
  index: IndexLevel | null
  riskFreeRate: number | null
  computedAt: string | null
  /** When data was last fetched; see `Universe.gatheredAt`. */
  gatheredAt: string | null
  /** Decided by `loadUniverse`; see the note on `Universe.isStale`. */
  isStale: boolean
  universeSize: number
  isBaseline: boolean
}) {
  // The stamp is when data was gathered, falling back to when it was computed
  // over. Those are separate claims and the label changes with them, because
  // "collected" over a recompute-only timestamp would be a false one.
  const collected = Boolean(gatheredAt)
  const stamp = gatheredAt ?? computedAt

  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-border bg-card px-6 py-2.5 lg:px-10">
      {/* First, and set apart from the fields: this names the page rather than
          reporting a number about the market, so it does not take the
          label-over-value form the rest of the strip uses. */}
      <PageLabel />

      <Separator />

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

      {index && riskFreeRate !== null && <Separator />}

      {riskFreeRate !== null && (
        <Field label="13W T-bill">{(riskFreeRate * 100).toFixed(2)}%</Field>
      )}

      {(index || riskFreeRate !== null) && <Separator />}

      <Field label="Universe">{universeSize} stocks</Field>

      <Separator />

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

      {/* Pushed to the far end: provenance is the one field a reader looks for
          deliberately rather than scans. */}
      <div className="ml-auto hidden items-baseline gap-2 xl:flex">
        <span className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Source
        </span>
        <span className="text-xs text-muted-foreground">yfinance</span>
      </div>
    </div>
  )
}
