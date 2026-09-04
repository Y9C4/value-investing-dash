"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiInformationLine,
} from "@remixicon/react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { MarginBar, formatSignedPercent } from "@/components/valuation-scale"
import { formatMarketCap } from "@/lib/format"
import { useScrollPane } from "@/lib/use-scroll-pane"
import {
  BAND_LABELS,
  activeVerdicts,
  consensusMarginOfSafety,
  isRated,
  selectedModelCount,
  valuationBand,
  type Stock,
  type MethodId,
} from "@/lib/valuation"
import { cn } from "@/lib/utils"

export type SortKey =
  | "margin"
  | "ticker"
  | "marketCap"
  | "beta"
  | "peRatio"
  | "realisedReturn"
  | "volatility"

const COLUMNS: {
  key: SortKey
  label: string
  align: "left" | "right"
  numeric: boolean
  /** Shown behind an info trigger in the header for non-obvious columns. */
  help?: { title: string; body: string; points?: string[] }
}[] = [
  { key: "ticker", label: "Stock", align: "left", numeric: false },
  {
    key: "margin",
    label: "Margin of safety",
    align: "left",
    numeric: false,
    help: {
      title: "Margin of safety",
      body: "Benjamin Graham's term, and the central idea of value investing: the discount between what a company is worth and what it currently costs. Here it is (fair value − price) ÷ price, where fair value is the weighted consensus of the models switched on in the filter rail.",
      points: [
        "+20% means the models put the company's worth a fifth above its price — you are paying 80 cents for a dollar of value.",
        "−20% means the price sits a fifth above what the models can justify.",
        "The cushion is the point: buy far enough below fair value and the estimate can be wrong without losing money.",
      ],
    },
  },
  { key: "marketCap", label: "Mkt cap", align: "right", numeric: true },
  {
    key: "realisedReturn",
    // Shortened from "Return (ann.)": the window is stated in the popover
    // beside it, and four numeric headings at full length were most of what
    // pushed the last columns off a laptop screen.
    label: "Return 1Y",
    align: "right",
    numeric: true,
    help: {
      title: "Annualised log return",
      body: "The mean daily log return over the trailing 252 trading days, scaled by 252. Log returns are used because they add across time, which is what makes that scaling valid — simple returns do not.",
      points: [
        "Realised, not forecast: this is what the stock actually did.",
        "A mean-variance optimiser treats a number like this as an expected return, which is exactly why a stock that has already run up looks attractive to it.",
      ],
    },
  },
  {
    key: "volatility",
    label: "Vol 1Y",
    align: "right",
    numeric: true,
    help: {
      title: "Annualised volatility",
      body: "Standard deviation of the same daily log return series, scaled by √252. It is the risk term the optimiser trades off against return when building the frontier.",
      points: [
        "Measured over the same 252-day window as the return beside it, so the pair describes one period.",
      ],
    },
  },
  {
    key: "beta",
    label: "Beta",
    align: "right",
    numeric: true,
    help: {
      title: "Beta vs the S&P 500",
      body: "Covariance with the index divided by the index's variance, over the same trailing 252 trading days. It measures how much of a stock's movement is the market moving rather than the company.",
      points: [
        "Computed here rather than taken from the data provider, whose figure uses a five-year monthly window and would not match the models beside it.",
        "Negative values are real over this window: several defensive names moved inversely to an index driven by a handful of mega-caps.",
      ],
    },
  },
  { key: "peRatio", label: "P/E", align: "right", numeric: true },
]

/** The definition behind a column heading that is not self-explanatory. */
function ColumnHelp({
  help,
  align,
}: {
  help: NonNullable<(typeof COLUMNS)[number]["help"]>
  align: "left" | "right"
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        aria-label={`What ${help.title} means`}
        className="ml-1.5 size-4 align-middle"
      >
        <RiInformationLine className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align={align === "right" ? "end" : "start"}
        className="max-w-sm gap-2 normal-case"
      >
        <PopoverTitle>{help.title}</PopoverTitle>
        <p className="text-xs leading-relaxed font-normal tracking-normal text-muted-foreground">
          {help.body}
        </p>
        {help.points && (
          <ul className="flex flex-col gap-1">
            {help.points.map((point) => (
              <li
                key={point}
                className="flex gap-2 text-xs leading-relaxed font-normal tracking-normal text-muted-foreground"
              >
                <span aria-hidden="true">—</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}


export function ScreenerTable({
  stocks,
  methods = [],
  sort,
  direction,
  onSort,
  selected,
  onToggleSelected,
  onToggleAll,
}: {
  stocks: Stock[]
  /** The models currently switched on; empty means all of them. */
  methods?: MethodId[]
  sort: SortKey
  direction: "asc" | "desc"
  onSort: (key: SortKey) => void
  selected: string[]
  onToggleSelected: (ticker: string) => void
  /** Ticks or clears every row currently on screen. */
  onToggleAll: () => void
}) {
  const router = useRouter()
  const { ref: scrollRef, clipped, maxHeight } = useScrollPane<HTMLDivElement>()

  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 border border-border bg-card px-6 py-16 text-center">
        <p className="font-heading text-sm font-semibold tracking-wider uppercase">
          Nothing survives these filters
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Loosen the margin of safety or widen the sectors — a value screen that
          returns nothing is usually a screen set too tight.
        </p>
      </div>
    )
  }

  const allSelected = stocks.every((stock) => selected.includes(stock.ticker))
  const someSelected = !allSelected && stocks.some((s) => selected.includes(s.ticker))

  return (
    <div className="relative border border-border bg-card">
      <Table
        // The scroll port is this container rather than the page; see
        // `useScrollPane`. The class is the pre-measurement fallback, close
        // enough that the first paint does not visibly jump.
        containerClassName="overflow-auto lg:max-h-[calc(100vh-22rem)]"
        containerStyle={maxHeight ? { maxHeight } : undefined}
        containerRef={scrollRef}
      >
        <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
          {/* An inset shadow rather than a border: a sticky row's own border
              is painted with the cell and scrolls out from under it. */}
          <TableRow className="shadow-[inset_0_-1px_0_0_var(--color-border)] hover:bg-card">
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allSelected}
                // A partly-ticked column is neither on nor off, and only the
                // DOM property can say so.
                ref={(el) => {
                  if (el) el.indeterminate = someSelected
                }}
                onChange={onToggleAll}
                aria-label={
                  allSelected
                    ? `Clear all ${stocks.length} rows`
                    : `Select all ${stocks.length} rows`
                }
              />
            </TableHead>
            {COLUMNS.map((column) => {
              const active = sort === column.key

              return (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.key === "margin" && "w-[19rem]"
                  )}
                  aria-sort={
                    active
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 tracking-wide uppercase transition-colors hover:text-foreground",
                      column.align === "right" && "flex-row-reverse",
                      active && "text-foreground"
                    )}
                  >
                    {column.label}
                    {active &&
                      (direction === "asc" ? (
                        <RiArrowUpLine className="size-3" />
                      ) : (
                        <RiArrowDownLine className="size-3" />
                      ))}
                  </button>

                  {/* Sibling of the sort button, never nested inside it: the
                      header has two independent actions. */}
                  {column.help && (
                    <ColumnHelp align={column.align} help={column.help} />
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((stock) => {
            const rated = isRated(stock, methods)
            const margin = consensusMarginOfSafety(stock, methods)
            const band = rated ? valuationBand(margin) : "unrated"
            const isSelected = selected.includes(stock.ticker)

            return (
              <TableRow
                key={stock.ticker}
                // The whole row is the target, which is how a table of
                // stocks is expected to behave — only the ticker cell used
                // to be clickable, which is a hit area of about 40 pixels in a
                // row 48 tall and 1,000 wide. The anchor inside that cell
                // stays, so middle-click and "open in new tab" still work.
                className="group cursor-pointer"
                onClick={() => router.push(`/stocks/${stock.ticker}`)}
              >
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={isSelected}
                    onChange={() => onToggleSelected(stock.ticker)}
                    aria-label={`Include ${stock.ticker} in the portfolio`}
                  />
                </TableCell>

                <TableCell>
                  {/* Ticker and name on one line, not stacked. A two-line
                      identity cell sets the height of every row in the table,
                      and the table's height is fixed at the window: it cost
                      about six visible rows on a laptop to gain a line break
                      the truncation was already handling. */}
                  <Link
                    href={`/stocks/${stock.ticker}`}
                    className="flex items-baseline gap-2 group-hover:underline"
                  >
                    <span className="font-medium">{stock.ticker}</span>
                    <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
                      {stock.name}
                    </span>
                  </Link>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-3">
                    {/* An unrated row has no consensus to draw. Blank beats a
                        bar sitting at zero, which reads as "fairly priced". */}
                    {rated ? (
                      <MarginBar margin={margin} className="w-32 shrink-0" />
                    ) : (
                      <span className="w-32 shrink-0" />
                    )}
                    {/* Value in text ink, never the series colour. */}
                    <span className="w-16 shrink-0 text-right font-mono text-sm">
                      {rated ? formatSignedPercent(margin) : "—"}
                    </span>
                    <span className="hidden text-xs whitespace-nowrap text-muted-foreground 2xl:inline">
                      {BAND_LABELS[band]}
                      {" · "}
                      <span className="font-mono">
                        {activeVerdicts(stock, methods).length}/
                        {selectedModelCount(methods)}
                      </span>
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono">
                  {formatMarketCap(stock.marketCap)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatSignedPercent(stock.realisedReturn)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {(stock.volatility * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {stock.beta.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {stock.peRatio > 0 ? stock.peRatio.toFixed(1) : "—"}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {/* The affordance for whatever is past the right edge. Pointer events
          off, so it never eats a click on the cell underneath. */}
      {clipped && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent"
        />
      )}
    </div>
  )
}
