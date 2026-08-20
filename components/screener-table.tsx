"use client"

import Link from "next/link"
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
import {
  BAND_LABELS,
  consensusMarginOfSafety,
  valuationBand,
  type Stock,
  type MethodId,
} from "@/lib/valuation"
import { cn } from "@/lib/utils"

export type SortKey =
  | "margin"
  | "ticker"
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
  { key: "ticker", label: "Company", align: "left", numeric: false },
  {
    key: "margin",
    label: "Margin of safety",
    align: "left",
    numeric: false,
    help: {
      title: "Margin of safety",
      body: "Benjamin Graham's term, and the central idea of value investing: the discount between what a company is worth and what it currently costs. Here it is (fair value − price) ÷ price, where fair value is the confidence-weighted consensus of the models switched on in the filter rail.",
      points: [
        "+20% means the models put the company's worth a fifth above its price — you are paying 80 cents for a dollar of value.",
        "−20% means the price sits a fifth above what the models can justify.",
        "The cushion is the point: buy far enough below fair value and the estimate can be wrong without losing money.",
      ],
    },
  },
  {
    key: "realisedReturn",
    label: "Return (ann.)",
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
    label: "Volatility (ann.)",
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
}: {
  stocks: Stock[]
  /** The models currently switched on; empty means all of them. */
  methods?: MethodId[]
  sort: SortKey
  direction: "asc" | "desc"
  onSort: (key: SortKey) => void
  selected: string[]
  onToggleSelected: (ticker: string) => void
}) {
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

  return (
    <div className="border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            {COLUMNS.map((column) => {
              const active = sort === column.key

              return (
                <TableHead
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.key === "margin" && "w-[22rem]"
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
                      "inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-foreground",
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
            const margin = consensusMarginOfSafety(stock, methods)
            const band = valuationBand(margin)
            const isSelected = selected.includes(stock.ticker)

            return (
              <TableRow key={stock.ticker}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={isSelected}
                    onChange={() => onToggleSelected(stock.ticker)}
                    aria-label={`Include ${stock.ticker} in the portfolio`}
                  />
                </TableCell>

                <TableCell>
                  <Link
                    href={`/stocks/${stock.ticker}`}
                    className="flex flex-col gap-0.5 hover:underline"
                  >
                    <span className="font-medium">{stock.ticker}</span>
                    <span className="text-xs text-muted-foreground">
                      {stock.name}
                    </span>
                  </Link>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-3">
                    <MarginBar margin={margin} className="w-40 shrink-0" />
                    {/* Value in text ink, never the series colour. */}
                    <span className="w-16 shrink-0 text-right font-mono text-sm">
                      {formatSignedPercent(margin)}
                    </span>
                    <span className="hidden text-xs whitespace-nowrap text-muted-foreground xl:inline">
                      {BAND_LABELS[band]}
                    </span>
                  </div>
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
    </div>
  )
}
