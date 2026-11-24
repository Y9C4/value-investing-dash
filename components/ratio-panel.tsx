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
        <PanelTitle>Classic ratios</PanelTitle>
        <PanelMeta>against {sector}</PanelMeta>
      </PanelHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Ratio</TableHead>
            <TableHead className="text-right">This stock</TableHead>
            <TableHead className="text-right">Sector median</TableHead>
            <TableHead className="w-[30%]">
              <span className="flex items-center gap-1">
                Rank in sector
                <Info title="Rank in sector">
                  Where this stock&rsquo;s figure sits among sector peers that
                  report it, counted from the lowest. A low P/E and a high FCF
                  yield both point to cheap.
                </Info>
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
                <TableCell>
                  <span className="flex items-center gap-1 text-sm">
                    {field.label}
                    <Info title={field.label}>{field.help}</Info>
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {formatRatio(row.value, field.unit)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {formatRatio(row.sectorMedian, field.unit)}
                </TableCell>
                <TableCell>
                  {pct === null ? (
                    <span className="text-xs text-muted-foreground">not measured</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      {/* A position on the peer range, not a score: no fill colour. */}
                      <div className="relative h-5 flex-1" aria-hidden="true">
                        <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
                        <span className="absolute inset-y-1 left-1/2 w-px bg-muted-foreground/40" />
                        <span
                          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
                          style={{ left: `${(pct * 100).toFixed(1)}%` }}
                        />
                      </div>
                      <span className="w-16 text-right font-mono text-xs text-muted-foreground">
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
        <p className="text-xs leading-relaxed text-muted-foreground">
          The dot is where the stock sits among peers with a reading, lowest on
          the left; the tick is the median. Ratios are
          context: in the backtest each lost to the reverse-DCF model built
          on the same figures.
        </p>
      </PanelBody>
    </Panel>
  )
}
