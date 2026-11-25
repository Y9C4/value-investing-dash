import { Tex } from "@/components/tex"
import { Info } from "@/components/info"
import { Panel, PanelBody, PanelHeader, PanelMeta, PanelTitle } from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RATIO_FIELDS, formatRatio, type RatioContext, type RatioKey } from "@/lib/sectors"
import { BAND_FILL, valuationBand } from "@/lib/valuation"

/** Which end of the sector is cheap. ROE and growth are not prices, so neither. */
const CHEAP_END: Partial<Record<RatioKey, "low" | "high">> = {
  peRatio: "low",
  pbRatio: "low",
  evEbitda: "low",
  fcfYield: "high",
  dividendYield: "high",
  shareholderYield: "high",
}

/** The bar's colour: the value quintile of the stock's cheapness among its peers. */
function barFill(row: RatioContext, pct: number): string {
  const end = CHEAP_END[row.key]
  if (!end) return "var(--color-signal-q4)"
  // Share of peers no cheaper than this one, so the cheapest multiple reads as 1.
  return BAND_FILL[valuationBand(end === "high" ? pct : 1 - pct + 1 / row.peers)]
}

/**
 * The classic ratios against the stock's sector: the language most readers
 * value a company in. Context, not signal — in the backtest each lost to its
 * reverse-DCF counterpart (backtests.md §13, test 2).
 */
export function RatioPanel({ sector, context }: { sector: string; context: RatioContext[] }) {
  const fields = new Map(RATIO_FIELDS.map((field) => [field.key, field]))

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Relative valuation vs sector</PanelTitle>
        <PanelMeta>{sector} · context only, not in the composite</PanelMeta>
      </PanelHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Multiple</TableHead>
            <TableHead className="text-right">
              Stock<span className="sm:hidden"> / median</span>
            </TableHead>
            <TableHead className="hidden text-right sm:table-cell">Sector median</TableHead>
            <TableHead className="w-[38%] sm:w-[30%]">Sector rank</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {context.map((row) => {
            const field = fields.get(row.key)!
            const pct = row.sectorPercentile
            return (
              <TableRow key={row.key} className="hover:bg-transparent">
                {/* Under 640px the median folds under the stock's figure and the
                    rank count under the bar, so all four readings stay. */}
                <TableCell className="whitespace-normal">
                  <span className="flex items-center gap-1 text-sm">
                    {field.label}
                    <Info title={field.label}>
                      <Tex block>{field.tex}</Tex>
                      {field.help}
                    </Info>
                  </span>
                </TableCell>
                <TableCell className="text-right font-figure text-sm">
                  {formatRatio(row.value, field.unit)}
                  <span className="block text-xs text-muted-foreground sm:hidden">
                    {formatRatio(row.sectorMedian, field.unit)}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right font-figure text-sm text-muted-foreground sm:table-cell">
                  {formatRatio(row.sectorMedian, field.unit)}
                </TableCell>
                <TableCell>
                  {pct === null ? (
                    <span className="text-xs text-muted-foreground">n/a</span>
                  ) : (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      {/* Length is the rank, low to high; the tick is the median. */}
                      <div className="relative h-5 w-full sm:flex-1" aria-hidden="true">
                        <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
                        <span
                          className="absolute top-1/2 left-0 h-2 min-w-2 -translate-y-1/2 rounded-full"
                          style={{ width: `${(pct * 100).toFixed(1)}%`, background: barFill(row, pct) }}
                        />
                        <span className="absolute inset-y-1 left-1/2 w-px bg-foreground/70" />
                      </div>
                      <span className="font-figure text-xs text-muted-foreground sm:w-16 sm:text-right">
                        {Math.round(pct * row.peers)} of {row.peers}
                      </span>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <PanelBody className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border text-xs text-muted-foreground">
        {(
          [
            ["Cheap", BAND_FILL["deep-value"]],
            ["Mid", BAND_FILL.fair],
            ["Rich", BAND_FILL.expensive],
            ["ROE, growth (not a price)", "var(--color-signal-q4)"],
          ] as const
        ).map(([label, fill]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-4 rounded-full" style={{ background: fill }} />
            {label}
          </span>
        ))}
        <span>Bar length: rank low → high · tick: median</span>
      </PanelBody>
    </Panel>
  )
}
