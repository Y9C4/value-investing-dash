import { SignalBar } from "@/components/signal-scale"
import { compositeQuintileLabel } from "@/components/stock-readings"
import { ValueBar } from "@/components/valuation-scale"
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
  Stat,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPp, formatSignedPct } from "@/lib/format"
import {
  SIGNAL_COMPONENTS,
  SIGNAL_EVIDENCE,
  formatComposite,
  formatScore,
  signalBand,
  warehouseRank,
  type SignalId,
} from "@/lib/signals"
import { impliedAlpha, type Stock } from "@/lib/valuation"

/** A tested blend's score for this stock, ranked over the whole universe. */
export type BlendScore = { label: string; score: number | null }

/** The raw reading behind each component, in its own unit. */
function rawReading(stock: Stock, id: SignalId): string {
  const signals = stock.signals
  if (!signals) return "—"
  if (id === "value") {
    // The same figure the percentile ranks: all four models, as on every other surface.
    const alpha = impliedAlpha(stock)
    return alpha === null ? "—" : `${formatPp(alpha)} a year`
  }
  if (id === "momentum") {
    return signals.momentum === null ? "—" : formatSignedPct(signals.momentum)
  }
  if (signals.surprise === null) return "—"
  // In basis points: as a percent of price it would print +0.0% at one decimal.
  return `${formatSignedPct(signals.surprise * 100).replace("%", " bp")} of price`
}

/**
 * The signal for one stock: the two tested blends and each component's raw
 * reading and percentile. The four implied returns behind the value component
 * are in `ImpliedReturnPanel`.
 *
 * Percentiles lead and the raw numbers sit beside them, not the other way
 * round: the backtest found the ranking informative and the magnitudes not
 * (backtests.md §13, test 4).
 */
export function SignalPanel({
  stock,
  valueRank,
  blends,
}: {
  stock: Stock
  /** Value percentile over all four models. */
  valueRank: number | null
  blends: BlendScore[]
}) {
  const signals = stock.signals
  if (!signals) return null

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Factor percentiles</PanelTitle>
        <PanelMeta>0–100 across today&rsquo;s S&amp;P 500</PanelMeta>
      </PanelHeader>

      {/* The two tested composites first: these are what the screener ranks on. */}
      <div className="grid grid-cols-1 gap-px border-b border-border bg-border sm:grid-cols-2 [&>*]:bg-card [&>*]:px-4 [&>*]:py-3">
        {blends.map((blend) => {
          const score = blend.score
          return (
            <Stat
              key={blend.label}
              label={blend.label}
              value={
                <span className="flex items-baseline gap-2">
                  <span>{formatComposite(score)}</span>
                  <span className="font-sans text-xs font-normal text-muted-foreground">
                    {compositeQuintileLabel(signalBand(score))}
                  </span>
                </span>
              }
              size="lead"
            >
              <SignalBar score={score} className="mt-1 w-full" />
            </Stat>
          )
        })}
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Factor</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Raw value</TableHead>
            <TableHead className="w-[45%] sm:w-[40%]">Percentile</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SIGNAL_COMPONENTS.map((component) => {
            const rank =
              component.id === "value" ? valueRank : warehouseRank(stock, component.id)
            const raw = rawReading(stock, component.id)
            return (
              <TableRow key={component.id} className="hover:bg-transparent">
                {/* Under 640px the raw reading folds under the name. */}
                <TableCell className="whitespace-normal">
                  <span className="text-sm font-medium">
                    {component.label}
                  </span>
                  <span className="ml-2 hidden text-xs text-muted-foreground md:inline">
                    {component.full}
                  </span>
                  <span className="block font-figure text-xs text-muted-foreground sm:hidden">
                    {raw}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right font-figure text-sm sm:table-cell">
                  {raw}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {component.id === "value" ? (
                      <ValueBar percentile={rank} className="flex-1" />
                    ) : (
                      <SignalBar score={rank} className="flex-1" />
                    )}
                    <span className="w-7 text-right font-figure text-sm">
                      {formatScore(rank)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <PanelBody className="border-t border-border">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {SIGNAL_EVIDENCE}
        </p>
      </PanelBody>
    </Panel>
  )
}
