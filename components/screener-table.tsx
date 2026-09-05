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
import { Checkbox } from "@/components/ui/checkbox"
import { MarginBar, formatSignedPercent } from "@/components/valuation-scale"
import { formatMarketCap, formatSharePrice } from "@/lib/format"
import { useScrollPane } from "@/lib/use-scroll-pane"
import {
  BAND_LABELS,
  BAND_TEXT_CLASS,
  consensusMarginOfSafety,
  isRated,
  valuationBand,
  BAND_FILL,
  type Stock,
  type MethodId,
} from "@/lib/valuation"
import { cn } from "@/lib/utils"

export type SortKey =
  | "margin"
  | "ticker"
  | "price"
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
      label: "Consensus Margin",
      align: "right",
      numeric: false,
      help: {
        title: "Consensus Margin",
        body: "The discount between what a company is worth and what it currently costs. (fair value - price) ÷ price, where fair value is the weighted consensus of the toggled valuation models.",
        points: [
          "+20% means the models put the company's fair value 20% more than its current market value.",
          "-20% means the models put the company's fair value 20% more than its current market value.",
        ],
      },
    },
    // Between the margin and the market cap on purpose: the margin is a
    // percentage off this number, so the two read together, and market cap is
    // the same quantity multiplied by a share count.
    { key: "price", label: "Price", align: "right", numeric: true },
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
        body: "The mean daily log return over the last 252 trading days * 252.",
        points: [
          "Realised returns aren't a reliable forecast of future returns, but for the mean varience optimiser, they're used as expected returns",
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
        body: "Standard deviation of daily log returns * √252.",
        points: [
          "Past Volatility isn't a reliable forecast of future volatility, but for the mean varience optimiser, they're used as expected volatility",
        ],
      },
    },
    {
      key: "beta",
      label: "Beta",
      align: "right",
      numeric: true,
      help: {
        title: "Beta vs Market Index",
        body: "Cov(Rp, Rm) / Var(Rm). Measures the stock's sensitivity to movements in the market index (S&P 500: ^GSPC).",
        points: [
          "Under the CAPM, beta measures an asset's systematic risk relative to the market.",
          "A beta above 1 indicates greater sensitivity to market movements, while a beta below 1 indicates lower sensitivity."
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
                <span aria-hidden="true">-</span>
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
          no results
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          None of the stocks in the universe pass the filters. Loosen the filters to see more results.
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
              <Checkbox
                checked={allSelected}
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
                  <Checkbox
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
                  <div className="flex items-center gap-3 text">

                    {/* An unrated row has no consensus to draw. Blank beats a
                        bar sitting at zero, which reads as "fairly priced". */}
                    {rated ? (
                      <MarginBar margin={margin} className="w-32 shrink-0" />
                    ) : (
                      <span className="w-32 shrink-0" />
                    )}

                    <span
                      className={`w-16 shrink-0 text-right font-mono text-sm ${BAND_TEXT_CLASS[valuationBand(margin)]}`}
                    >
                      {rated ? formatSignedPercent(margin) : "-"}
                    </span>

                    <span
                      className={`hidden text-xs whitespace-nowrap 2xl:inline ${BAND_TEXT_CLASS[valuationBand(margin)]}`}
                    >
                      {BAND_LABELS[band]}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="text-right font-mono">
                  {formatSharePrice(stock.price)}
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
