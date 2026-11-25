import { Info } from "@/components/info"
import { Details, Panel, PanelBody, PanelHeader, PanelMeta, PanelTitle } from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { RATIO_FIELDS, formatRatio, type RatioContext } from "@/lib/sectors"

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
        <PanelTitle>Multiples against the sector</PanelTitle>
        <PanelMeta>{sector}</PanelMeta>
      </PanelHeader>
      <p className="border-b border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        The dot shows where this stock sits among its sector peers, lowest on the
        left; the tick is the sector median. For P/E, P/B and EV/EBITDA, further
        left is cheaper. For yields, further right is cheaper.
      </p>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Ratio</TableHead>
            <TableHead className="text-right">
              Stock<span className="sm:hidden"> / median</span>
            </TableHead>
            <TableHead className="hidden text-right sm:table-cell">Sector median</TableHead>
            <TableHead className="w-[38%] sm:w-[30%]">
              <span className="flex items-center gap-1">
                <span className="sm:hidden">Rank in sector</span>
                <span className="hidden sm:inline">Rank in sector (low → high)</span>
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {context.map((row) => {
            const field = fields.get(row.key)!
            const pct = row.sectorPercentile
            return (
              <TableRow key={row.key} className="hover:bg-transparent">
                {/* Under 640px the median folds under the stock's figure and the
                    rank count under the dot, so all four readings stay. */}
                <TableCell className="whitespace-normal">
                  <span className="flex items-center gap-1 text-sm">
                    {field.label}
                    <Info title={field.label}>{field.help}</Info>
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
                    <span className="text-xs text-muted-foreground">not measured</span>
                  ) : (
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                      {/* A position on the peer range, not a score: no fill colour. */}
                      <div className="relative h-5 w-full sm:flex-1" aria-hidden="true">
                        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                        <span className="absolute inset-y-1 left-1/2 w-px bg-muted-foreground/40" />
                        <span
                          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                          style={{ left: `${(pct * 100).toFixed(1)}%` }}
                        />
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
      <PanelBody className="border-t border-border">
        <Details summary="Do these feed the ranking?">
          <p>
            No. They are here for context. In the backtest, each simple ratio
            predicted returns slightly less well than the reverse-DCF model built
            on the same figures, though the differences were too small to rule out
            luck.
          </p>
        </Details>
      </PanelBody>
    </Panel>
  )
}
