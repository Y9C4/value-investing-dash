"use client"

import Link from "next/link"
import { RiArrowDownLine, RiArrowUpLine } from "@remixicon/react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MarginBar, formatSignedPercent } from "@/components/valuation-scale"
import {
  BAND_LABELS,
  consensusMarginOfSafety,
  valuationBand,
  type Stock,
} from "@/lib/valuation"
import { cn } from "@/lib/utils"

export type SortKey = "margin" | "ticker" | "beta" | "peRatio" | "coverage"

const COLUMNS: {
  key: SortKey
  label: string
  align: "left" | "right"
  numeric: boolean
}[] = [
  { key: "ticker", label: "Company", align: "left", numeric: false },
  { key: "margin", label: "Margin of safety", align: "left", numeric: false },
  { key: "peRatio", label: "P/E", align: "right", numeric: true },
  { key: "beta", label: "Beta", align: "right", numeric: true },
  { key: "coverage", label: "Models", align: "right", numeric: true },
]

export function ScreenerTable({
  stocks,
  sort,
  direction,
  onSort,
  selected,
  onToggleSelected,
}: {
  stocks: Stock[]
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
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {stocks.map((stock) => {
            const margin = consensusMarginOfSafety(stock)
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
                  {stock.peRatio.toFixed(1)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {stock.beta.toFixed(2)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">
                  {stock.verdicts.length}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
