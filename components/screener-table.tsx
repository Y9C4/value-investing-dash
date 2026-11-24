"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { startTransition, useEffect, useState } from "react"
import {
  RiArrowDownLine,
  RiArrowUpLine,
  RiInformationLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
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
import { ValueBar } from "@/components/valuation-scale"
import { SignalBar } from "@/components/signal-scale"
import { DASH, formatMarketCap, formatPct, formatPp, formatSharePrice, formatSignedPct } from "@/lib/format"
import { useScrollPane } from "@/lib/use-scroll-pane"
import {
  BAND_BASIS,
  BAND_LABELS,
  BAND_TEXT_CLASS,
  IMPLIED_BASIS,
  gapTextClass,
  impliedAlpha,
  valuationBand,
  type MethodId,
  type Stock,
} from "@/lib/valuation"
import { SIGNAL_BAND_LABELS, describeEvidence, formatComposite, signalBand, warehouseRank } from "@/lib/signals"
import type { Ranking } from "@/lib/screen"
import { evidenceFor } from "@/lib/evidence"
import { cn } from "@/lib/utils"

export type SortKey =
  | "ticker"
  | "score"
  | "value"
  | "price"
  | "marketCap"
  | "peRatio"
  | "pbRatio"
  | "evEbitda"
  | "fcfYield"
  | "shareholderYield"
  | "roe"
  | "revenueGrowth"
  | "momentum"
  | "surprise"
  | "realisedReturn"
  | "volatility"
  | "beta"

export type ColumnGroup = "ratios" | "trend" | "risk"

export const COLUMN_GROUPS: { id: ColumnGroup; label: string; columns: string }[] = [
  { id: "ratios", label: "Fundamentals", columns: "P/B, EV/EBITDA, FCF yield, shareholder yield, ROE, revenue growth" },
  { id: "trend", label: "Earnings surprise", columns: "Earnings surprise, as a raw figure" },
  { id: "risk", label: "Risk & return", columns: "Trailing 1-year return, volatility and beta" },
]

type Help = { title: string; body: string; points?: string[] }

type Column = {
  key: SortKey
  label: string
  align: "left" | "right"
  /** Absent: always shown. */
  group?: ColumnGroup
  help?: Help
  cell: (stock: Stock, ctx: { ranking: Ranking; methods: MethodId[] }) => React.ReactNode
}

/** Rows in the server-rendered HTML: more than any viewport shows. */
const INITIAL_ROWS = 60
const multiple = (value: number | null) => (value === null ? DASH : `${value.toFixed(1)}×`)
/** A 0–1 percentile as a whole number out of 100. */
const percentile = (rank: number | null) => (rank === null ? DASH : Math.round(rank * 100).toString())

const COLUMNS: Column[] = [
  {
    key: "ticker",
    label: "Stock",
    align: "left",
    cell: (stock) => (
      // Ticker and name on one line from `sm`: the table's height is fixed at
      // the window, so every line break costs visible rows. Stacked on a phone,
      // where the width is scarcer than the height.
      <Link
        href={`/stocks/${stock.ticker}`}
        className="flex flex-col group-hover:underline sm:flex-row sm:items-baseline sm:gap-2"
      >
        <span className="font-mono font-medium">{stock.ticker}</span>
        <span className="max-w-[6.5rem] truncate text-xs text-muted-foreground sm:max-w-[8rem] 2xl:max-w-[10rem]">{stock.name}</span>
      </Link>
    ),
  },
  {
    key: "score",
    label: "Composite",
    align: "left",
    help: {
      title: "Composite percentile",
      body: "The equal-weight average of the selected factor percentiles (value + momentum by default), re-ranked 0–100 across the index. A rank, not a forecast return.",
      points: [
        "Shown to one decimal: about 500 stocks put neighbouring ranks 0.2 apart, so whole numbers would print several different ranks as the same figure.",
        "Blank means a selected factor could not be measured for this stock.",
        `Value + momentum: ${describeEvidence(evidenceFor(["value", "momentum"])!)} Neither is statistically significant.`,
      ],
    },
    cell: (stock, { ranking }) => {
      const score = ranking.score.get(stock.ticker) ?? null
      return (
        <div className="flex items-center gap-2 sm:gap-3">
          <SignalBar score={score} className="w-10 shrink-0 sm:w-16" />
          <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums">{formatComposite(score)}</span>
          <span className="hidden text-xs whitespace-nowrap text-muted-foreground min-[1920px]:inline">
            {score === null ? "" : SIGNAL_BAND_LABELS[signalBand(score)]}
          </span>
        </div>
      )
    },
  },
  {
    key: "value",
    label: "Value",
    align: "left",
    help: {
      title: "Value percentile",
      body: IMPLIED_BASIS,
      points: [
        "The bar and number are the stock's percentile, 0–100, on implied excess return. 100 is the cheapest in the index.",
        "The signed figure is the implied excess return itself, in percentage points (pp) a year.",
        BAND_BASIS,
      ],
    },
    cell: (stock, { ranking, methods }) => {
      const rank = ranking.value.get(stock.ticker) ?? null
      const alpha = impliedAlpha(stock, methods)
      const band = valuationBand(rank)
      return (
        <div className="flex items-center gap-3" title={BAND_LABELS[band]}>
          <ValueBar percentile={rank} className="hidden w-16 shrink-0 sm:block" />
          <span className={cn("w-7 shrink-0 text-right font-mono text-sm tabular-nums", BAND_TEXT_CLASS[band])}>
            {percentile(rank)}
          </span>
          <span className={cn("hidden font-mono text-xs whitespace-nowrap sm:inline", gapTextClass(alpha))}>
            {alpha === null ? "not valued" : formatPp(alpha)}
          </span>
        </div>
      )
    },
  },
  {
    key: "momentum",
    label: "Momentum (12–1)",
    align: "left",
    help: {
      title: "Momentum (12–1) percentile",
      body: "Rank on 12–1 month price momentum: the total return from twelve months ago to one month ago, on dividend-adjusted closes (Jegadeesh & Titman 1993). Skipping the last month avoids its short-term reversal.",
      points: [
        "The number is the stock's percentile, 0–100, across the index. 100 rose the most.",
        "The signed figure is the 12–1 return itself.",
        "Blank when there is not yet a year of prices to measure it.",
      ],
    },
    cell: (stock) => (
      <div className="flex items-center gap-3">
        <span className="w-7 shrink-0 text-right font-mono text-sm tabular-nums">
          {percentile(warehouseRank(stock, "momentum"))}
        </span>
        <span className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground sm:inline">
          {stock.signals?.momentum == null ? "" : formatSignedPct(stock.signals.momentum)}
        </span>
      </div>
    ),
  },
  {
    key: "price",
    label: "Price",
    align: "right",
    cell: (stock) => formatSharePrice(stock.price),
  },
  {
    key: "marketCap",
    label: "Market cap",
    align: "right",
    cell: (stock) => (stock.marketCap === null ? DASH : formatMarketCap(stock.marketCap)),
  },
  {
    key: "peRatio",
    label: "P/E",
    align: "right",
    help: { title: "Price / earnings", body: "Market capitalisation over trailing-twelve-month net income. Blank when earnings are negative or a quarter is missing." },
    cell: (stock) => multiple(stock.peRatio !== null && stock.peRatio > 0 ? stock.peRatio : null),
  },
  {
    key: "pbRatio",
    label: "P/B",
    align: "right",
    group: "ratios",
    help: { title: "Price / book", body: "Market cap over common equity from the latest annual statement. Blank when book value is zero or negative." },
    cell: (stock) => multiple(stock.pbRatio),
  },
  {
    key: "evEbitda",
    label: "EV/EBITDA",
    align: "right",
    group: "ratios",
    help: { title: "EV / EBITDA", body: "Enterprise value (market cap plus net debt, excluding leases) over annual EBITDA. Blank when either is zero or negative." },
    cell: (stock) => multiple(stock.evEbitda),
  },
  {
    key: "fcfYield",
    label: "FCF yield",
    align: "right",
    group: "ratios",
    help: { title: "Free cash flow yield", body: "Free cash flow to the firm over enterprise value: the plain ratio the reverse FCFF model is built from." },
    cell: (stock) => formatPct(stock.fcfYield),
  },
  {
    key: "shareholderYield",
    label: "Shareholder yield",
    align: "right",
    group: "ratios",
    help: { title: "Shareholder yield", body: "Dividends plus net buybacks over market cap: cash returned to shareholders, the base of the shareholder-yield model." },
    cell: (stock) => formatPct(stock.shareholderYield),
  },
  {
    key: "roe",
    label: "ROE",
    align: "right",
    group: "ratios",
    help: { title: "Return on equity", body: "Net income over book equity, latest annual statement." },
    cell: (stock) => formatPct(stock.roe),
  },
  {
    key: "revenueGrowth",
    label: "Revenue growth",
    align: "right",
    group: "ratios",
    help: { title: "Revenue growth", body: "Trailing revenue growth a year: the 2-year compound rate, else 1-year, as reported." },
    cell: (stock) => formatSignedPct(stock.revenueGrowth),
  },
  {
    key: "surprise",
    label: "Earnings surprise",
    align: "right",
    group: "trend",
    help: { title: "Earnings surprise", body: "Reported minus consensus EPS for the latest quarter, as a share of the price. Only reports from the last 100 days count." },
    cell: (stock) => formatSignedPct(stock.signals?.surprise),
  },
  {
    key: "realisedReturn",
    label: "Return, 1y",
    align: "right",
    group: "risk",
    help: {
      title: "Annualised return",
      body: "Mean daily log return over the last 252 sessions × 252, on dividend-adjusted closes.",
      points: ["Past returns are a poor forecast of future ones; the optimiser shrinks them (Bayes–Stein) before use."],
    },
    cell: (stock) => formatSignedPct(stock.realisedReturn),
  },
  {
    key: "volatility",
    label: "Volatility, 1y",
    align: "right",
    group: "risk",
    help: { title: "Annualised volatility", body: "Standard deviation of daily log returns over the last 252 sessions × √252." },
    cell: (stock) => formatPct(stock.volatility),
  },
  {
    key: "beta",
    label: "Beta",
    align: "right",
    group: "risk",
    help: {
      title: "Beta",
      body: "Sensitivity to the market: a CAPM regression of 252 days of daily excess returns on the market factor, shrunk toward the cross-sectional mean by its own standard error, then 25% toward 0.9 (Levi & Welch 2017).",
      points: ["The same beta sets the stock's cost of equity."],
    },
    cell: (stock) => (stock.beta === null ? DASH : stock.beta.toFixed(2)),
  },
]

/** The definition behind a column heading that is not self-explanatory. */
function ColumnHelp({ help, align }: { help: Help; align: "left" | "right" }) {
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
      <PopoverContent align={align === "right" ? "end" : "start"} className="max-w-sm gap-2 normal-case">
        <PopoverTitle>{help.title}</PopoverTitle>
        <p className="text-xs leading-relaxed font-normal tracking-normal text-muted-foreground">{help.body}</p>
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
  ranking,
  methods,
  groups,
  sort,
  direction,
  onSort,
  selected,
  onToggleSelected,
  onToggleAll,
  onReset,
}: {
  stocks: Stock[]
  ranking: Ranking
  /** The models currently switched on; empty means all of them. */
  methods: MethodId[]
  /** Optional column groups switched on. */
  groups: ColumnGroup[]
  sort: SortKey
  direction: "asc" | "desc"
  onSort: (key: SortKey) => void
  selected: Set<string>
  onToggleSelected: (ticker: string) => void
  /** Ticks or clears every row currently on screen. */
  onToggleAll: () => void
  onReset: () => void
}) {
  const router = useRouter()
  const { ref: scrollRef, clipped, maxHeight } = useScrollPane<HTMLDivElement>()
  // The server sends a screenful of rows rather than all 500 (the HTML was
  // 2 MB); the rest render in a transition right after hydration.
  const [rowLimit, setRowLimit] = useState(INITIAL_ROWS)
  useEffect(() => {
    startTransition(() => setRowLimit(Infinity))
  }, [])
  const columns = COLUMNS.filter((column) => !column.group || groups.includes(column.group))

  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 border border-border bg-card px-6 py-16 text-center">
        <p className="text-sm font-semibold">No stocks pass these filters</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Loosen a filter, or reset to the value + momentum composite.
        </p>
        <Button size="sm" variant="outline" onClick={onReset}>
          Reset filters
        </Button>
      </div>
    )
  }

  const allSelected = stocks.every((stock) => selected.has(stock.ticker))
  const someSelected = !allSelected && stocks.some((s) => selected.has(s.ticker))

  return (
    <div className="relative border border-border bg-card">
      <Table
        // The scroll port is this container rather than the page; see
        // `useScrollPane`. The lg class is the pre-measurement fallback. Below
        // lg the page scrolls, but this box must still bound its height: it
        // scrolls sideways, which makes it the header's sticky container, so
        // a box taller than the window would carry the header off-screen.
        // 9rem clears the sticky context bar above it.
        containerClassName="max-h-[calc(100dvh-9rem)] overflow-auto lg:max-h-[calc(100vh-20rem)]"
        containerStyle={maxHeight ? { maxHeight } : undefined}
        containerRef={scrollRef}
      >
        <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
          {/* An inset shadow rather than a border: a sticky row's own border
              is painted with the cell and scrolls out from under it. */}
          <TableRow className="shadow-[inset_0_-1px_0_0_var(--color-border)] hover:bg-card">
            <TableHead className="w-8 px-2">
              <Checkbox
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected
                }}
                onChange={onToggleAll}
                aria-label={allSelected ? `Clear all ${stocks.length} rows` : `Select all ${stocks.length} rows`}
              />
            </TableHead>
            {columns.map((column) => {
              const active = sort === column.key
              return (
                <TableHead
                  key={column.key}
                  className={cn("px-2", column.align === "right" && "text-right")}
                  aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => onSort(column.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-foreground",
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
                  {/* Sibling of the sort button, never nested inside it. */}
                  {column.help && <ColumnHelp align={column.align} help={column.help} />}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.slice(0, rowLimit).map((stock) => (
            <TableRow
              key={stock.ticker}
              // The whole row is the target; the anchor in the first cell keeps
              // middle-click and "open in new tab" working.
              className="group cursor-pointer"
              onClick={(event) => {
                // The anchor and modified clicks (new tab, new window) handle themselves.
                if ((event.target as HTMLElement).closest("a") || event.metaKey || event.ctrlKey || event.shiftKey) return
                router.push(`/stocks/${stock.ticker}`)
              }}
            >
              <TableCell className="px-2" onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  checked={selected.has(stock.ticker)}
                  onChange={() => onToggleSelected(stock.ticker)}
                  aria-label={`Include ${stock.ticker} in the portfolio`}
                />
              </TableCell>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn("px-2", column.align === "right" && "text-right font-mono tabular-nums")}
                >
                  {column.cell(stock, { ranking, methods })}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* The affordance for whatever is past the right edge. */}
      {clipped && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent"
        />
      )}
    </div>
  )
}
