"use client"

import { useEffect, useRef } from "react"

import { LegendDot } from "@/components/efficient-frontier"
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import { formatPercent } from "@/lib/format"
import {
  isSameSelection,
  type SelectedPortfolio,
} from "@/lib/portfolio-selection"
import { cn } from "@/lib/utils"

/**
 * Every portfolio on the solved curve, as a list you can pick from.
 *
 * This replaced a two-row "anchor portfolios" table. The frontier was always a
 * curve of real, separately-solved portfolios, but only its two ends were ever
 * named, so the other eight — or the other hundred and ninety-eight — existed
 * on screen as dots and nowhere else. Naming them is what makes the curve
 * something a reader can move along rather than just look at.
 *
 * It is also the *reliable* way to select one, and on a dense curve the only
 * one: the chart's marks stop being clickable past the point where they stop
 * being drawn, and a scatter mark cannot be reached from a keyboard at all.
 * Every row here is a real button for that reason.
 */

/** One row per solved point, plus the two anchors, in curve order. */
type Row = {
  selection: SelectedPortfolio
  label: string
  /** Anchors are marked; the points between them are not. */
  mark?: "filled" | "hollow"
  portfolio: { return: number; volatility: number; sharpe: number }
  /** Points from a response that predates per-point weights cannot be shown. */
  selectable: boolean
}

function buildRows(data: FrontierResponse): Row[] {
  const rows: Row[] = data.envelope.map((point, index) => ({
    // Index 0 is the minimum-variance portfolio by construction — the trace
    // starts there — so it is presented as that anchor rather than as an
    // anonymous first point that happens to sit on top of one.
    selection:
      index === 0
        ? { kind: "minVolatility" }
        : { kind: "envelope", index },
    label: index === 0 ? "Min volatility" : `Point ${index + 1}`,
    mark: index === 0 ? "hollow" : undefined,
    portfolio: point,
    selectable: index === 0 || Boolean(point.weights),
  }))

  // The tangency is not one of the solved points — `refine_tangency` searches
  // between them — so it is inserted rather than matched, at the volatility it
  // actually sits at. Appending it instead would have put the row the page
  // opens on at the bottom of a list that otherwise reads left-to-right along
  // the curve, and scrolled the list to its end on every load.
  const tangencyRow: Row = {
    selection: { kind: "maxSharpe" },
    label: "Max Sharpe",
    mark: "filled",
    portfolio: data.max_sharpe,
    selectable: true,
  }
  const at = rows.findIndex(
    (row) => row.portfolio.volatility > data.max_sharpe.volatility
  )
  rows.splice(at === -1 ? rows.length : at, 0, tangencyRow)

  return rows
}

export function PortfolioList({
  data,
  selected,
  onSelect,
  isBaseline,
}: {
  data: FrontierResponse
  selected: SelectedPortfolio
  onSelect: (next: SelectedPortfolio) => void
  /** The illustrative curve carries no weights between its ends. */
  isBaseline: boolean
}) {
  // The illustrative curve carries weights for its two ends and nothing in
  // between, so listing its other fifty-nine points would be fifty-nine rows
  // that cannot be clicked. They are dropped rather than disabled: a row that
  // exists only to be greyed out is worse than no row.
  const all = buildRows(data)
  const rows = isBaseline ? all.filter((row) => row.selectable) : all
  const activeRef = useRef<HTMLTableRowElement>(null)

  // Absent when the index had no usable price history for the window; see the
  // footer below and the tone on each row.
  const market = data.market

  // A click on the chart can select a portfolio hundreds of rows down. Without
  // this the list answers by highlighting something off screen, which reads as
  // nothing having happened.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" })
  }, [selected])

  return (
    <Panel className="min-w-0">
      <PanelHeader>
        <PanelTitle>Portfolios</PanelTitle>
        <PanelMeta>
          {`${rows.length} on the curve`}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="px-0 py-0">
        {/* Tighter cells than the app's default: four columns in a panel a
            third the width of the page, and at the standard padding the last
            one scrolled out of sight. */}
        {/* Tighter and smaller than the app's default table: four columns in a
            panel a third the width of the page, where at standard padding the
            last of them scrolled out of sight. */}
        <Table containerClassName="overflow-y-auto overflow-x-hidden max-h-[26rem] [&_td]:px-2 [&_th]:px-2 [&_td]:py-1.5 [&_td]:text-xs [&_th]:text-[0.6875rem]">
          <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
            {/* An inset shadow rather than a border: a sticky row's own border
                is painted with the cell and scrolls out from under it. */}
            <TableRow className="shadow-[inset_0_-1px_0_0_var(--color-border)] hover:bg-card">
              <TableHead>Portfolio</TableHead>
              <TableHead className="text-right">Return</TableHead>
              <TableHead className="text-right">Vol.</TableHead>
              <TableHead className="text-right">Sharpe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const active = isSameSelection(row.selection, selected)
              const disabled = !row.selectable

              return (
                <TableRow
                  key={row.label}
                  ref={active ? activeRef : undefined}
                  data-active={active || undefined}
                  // `aria-current`, not `aria-selected`: the role here is
                  // button, and "the current one of a set" is what a selected
                  // row actually means.
                  aria-current={active || undefined}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : 0}
                  role="button"
                  onClick={() => !disabled && onSelect(row.selection)}
                  onKeyDown={(event) => {
                    if (disabled) return
                    // Enter and Space are what a row acting as a button owes a
                    // keyboard; Space would otherwise scroll the pane instead.
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelect(row.selection)
                    }
                  }}
                  className={cn(
                    "outline-none",
                    disabled
                      ? "cursor-default opacity-50"
                      : "cursor-pointer focus-visible:bg-accent",
                    active && "bg-accent hover:bg-accent"
                  )}
                >
                  <TableCell
                    className={cn("font-medium", active && "text-foreground")}
                  >
                    <span className="flex items-center gap-2">
                      {/* The anchors wear the same two marks the chart draws
                          for them; the points between are unmarked, which is
                          honest — they are not distinguished portfolios, they
                          are wherever the reader chose to look. */}
                      {row.mark ? (
                        <LegendDot hollow={row.mark === "hollow"} />
                      ) : (
                        <span className="size-2.5 shrink-0" aria-hidden="true" />
                      )}
                      {row.label}
                    </span>
                  </TableCell>
                  {/* Each figure is toned against the index's own, so the
                      column reads as "better or worse than holding the
                      market" rather than as three raw numbers. Written as
                      whole class names because Tailwind matches literals in
                      the source; an interpolated `text-${…}` compiles to
                      nothing on its own. Untoned when there is no index to
                      compare against. */}
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      market &&
                        (row.portfolio.return < market.return
                          ? "text-overvalued"
                          : "text-undervalued")
                    )}
                  >
                    {formatPercent(row.portfolio.return)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      market &&
                        (row.portfolio.volatility > market.volatility
                          ? "text-overvalued"
                          : "text-undervalued")
                    )}
                  >
                    {formatPercent(row.portfolio.volatility)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono tabular-nums",
                      market &&
                        (row.portfolio.sharpe < market.sharpe
                          ? "text-overvalued"
                          : "text-undervalued")
                    )}
                  >
                    {row.portfolio.sharpe.toFixed(2)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>

          {/* The index, scored the same way and on the same window as every
              row above it. A footer rather than a last row: it is what the
              column above is measured against, not another portfolio you can
              pick, and `tfoot` is the one part of a table that stays put when
              the body scrolls. Omitted entirely when the index had no usable
              price history — the rows above then carry no tone either, and
              the panel simply makes no claim about the market.

              Opaque, and shadowed rather than bordered, for the same reason
              the header is: a sticky row's own background must not let the
              body scroll through it, and its border is painted with the cell
              and slides out from under it. */}
          {market && (
            <TableFooter className="sticky bottom-0 z-10 bg-card shadow-[inset_0_1px_0_0_var(--color-border)]">
              <TableRow className="border-b-0 hover:bg-transparent">
                <TableCell className="font-medium text-chart-1">
                  Market portfolio
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-chart-1">
                  {formatPercent(market.return)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-chart-1">
                  {formatPercent(market.volatility)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-chart-1">
                  {market.sharpe.toFixed(2)}
                </TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </PanelBody>

    </Panel >
  )
}
