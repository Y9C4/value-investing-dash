import { RiArrowDownSFill, RiArrowUpSFill, RiTimeLine } from "@remixicon/react"

import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatDataTimestamp } from "@/lib/format"
import { DATA_SOURCES, type IndexLevel, type JobRun } from "@/lib/universe"
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

const STATUS_STYLE: Record<JobRun["status"], string> = {
  succeeded: "text-status-good",
  // Not an error. The backfills are partial-tolerant by design — a handful of
  // tickers lost out of 493 still refreshes the table — but it is worth being
  // able to see that it is happening every night.
  partial: "text-status-warning",
  failed: "text-status-critical",
}

/**
 * Per-stage collection times, behind the stamp they summarise.
 *
 * The strip can only carry one timestamp. This is where the rest lives: which
 * tables were filled when, and whether the run lost anything on the way. A
 * stage that has never run since `job_runs` existed says so rather than being
 * hidden, because "not recorded" and "collected this morning" are very
 * different claims about the numbers below.
 */
function FreshnessDetail({ freshness }: { freshness: Record<string, JobRun> }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        aria-label="When each source was last collected"
        className="ml-1 size-4 align-middle text-muted-foreground"
      >
        <RiTimeLine className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="max-w-md gap-3">
        <PopoverTitle>Data collection</PopoverTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each stage of the scheduled ingest, and when it last finished. Times
          are Eastern, which is the market&rsquo;s.
        </p>

        <dl className="flex flex-col gap-1.5">
          {DATA_SOURCES.map(({ job, label }) => {
            const run = freshness[job]

            return (
              <div
                key={job}
                className="flex items-baseline justify-between gap-4 border-b border-border pb-1.5 last:border-b-0"
              >
                <dt className="text-xs whitespace-nowrap">{label}</dt>
                <dd className="flex items-baseline gap-2 text-right">
                  {run ? (
                    <>
                      <span className="font-mono text-xs tabular-figures">
                        {formatDataTimestamp(run.finishedAt)}
                      </span>
                      <span
                        className={cn(
                          "text-[0.6875rem] tracking-wider uppercase",
                          STATUS_STYLE[run.status]
                        )}
                      >
                        {run.status}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      not yet recorded
                    </span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </PopoverContent>
    </Popover>
  )
}

export function MarketContext({
  index,
  riskFreeRate,
  computedAt,
  gatheredAt,
  freshness,
  isStale,
  universeSize,
  isBaseline,
}: {
  index: IndexLevel | null
  riskFreeRate: number | null
  computedAt: string | null
  /** When data was last fetched; see `Universe.gatheredAt`. */
  gatheredAt: string | null
  freshness: Record<string, JobRun>
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
          <span className="inline-flex items-baseline">
            <span className={cn(isStale && "text-status-warning")}>
              {formatDataTimestamp(stamp)}
            </span>
            <FreshnessDetail freshness={freshness} />
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
