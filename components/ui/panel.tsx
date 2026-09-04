import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The chrome the screener settled on, extracted so the rest of the app can
 * wear it.
 *
 * `Card` is the other primitive here and it is a different argument: 32px of
 * padding, an 18px title, a shadow and a ring. That reads as a document — a
 * thing to be looked at one at a time — and it is why the analysis and
 * portfolio pages felt like a brochure while the screener felt like a
 * terminal. The difference is not decoration. On a page whose job is to put
 * many numbers in front of someone at once, padding is the thing standing
 * between them and the next number.
 *
 * So a panel is a hairline box with a two-line header strip and a dense body:
 * the same border, the same tracked uppercase label, the same mono figures as
 * every strip on the screener. Roughly 90px of vertical chrome per panel
 * becomes about 30px, and — more to the point — a page of panels reads as one
 * instrument rather than as a stack of separate cards.
 *
 * `Card` is deliberately left in place. It is right for the few surfaces that
 * really are documents: the intro dialog, the backfill cards on `/data`.
 */

function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn(
        "flex min-w-0 flex-col border border-border bg-card",
        className
      )}
      {...props}
    />
  )
}

/**
 * The header strip. Title on the left, and whatever one fact is worth stating
 * about the panel's contents on the right — a count, a unit, an as-of.
 */
function PanelHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2",
        className
      )}
      {...props}
    />
  )
}

/**
 * An `h2` rather than a styled div: with the page's only `h1` now in the
 * context strip, these are the document outline, and a screen reader moving by
 * heading is how a long page like `/portfolio` becomes navigable.
 */
function PanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="panel-title"
      className={cn(
        "flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase",
        className
      )}
      {...props}
    />
  )
}

/** The right-hand fact in a header strip. Mono, because it is always a figure. */
function PanelMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="panel-meta"
      className={cn(
        "font-mono text-xs text-muted-foreground tabular-figures",
        className
      )}
      {...props}
    />
  )
}

function PanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-body"
      className={cn("px-4 py-3", className)}
      {...props}
    />
  )
}

/**
 * Label over figure, the unit of every readout on this app's dense surfaces.
 *
 * `size="lead"` is for the one number a panel exists to report. Everything
 * else is `default` — a headline is only a headline while the things around it
 * are not, and six 24px tiles in a row is just a row.
 */
function Stat({
  label,
  value,
  hint,
  size = "default",
  className,
  children,
}: {
  label: React.ReactNode
  value?: React.ReactNode
  hint?: React.ReactNode
  size?: "default" | "lead"
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="flex items-center gap-1 text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      {value !== undefined && (
        <span
          className={cn(
            "font-mono tabular-figures",
            size === "lead" ? "text-xl font-semibold" : "text-sm"
          )}
        >
          {value}
        </span>
      )}
      {children}
      {hint && (
        <span className="text-[0.6875rem] leading-tight text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  )
}

/**
 * A row of `Stat`s divided by hairlines rather than boxed individually.
 *
 * Six bordered tiles is six borders saying nothing; one strip with rules
 * between the readings is how an instrument panel is laid out, and it costs a
 * third of the height.
 */
function StatStrip({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-strip"
      className={cn(
        "grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-card [&>*]:px-4 [&>*]:py-2.5",
        className
      )}
      {...props}
    />
  )
}

export { Panel, PanelHeader, PanelTitle, PanelMeta, PanelBody, Stat, StatStrip }
