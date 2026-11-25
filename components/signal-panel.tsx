import { SignalBar } from "@/components/signal-scale"
import { compositeQuintileLabel } from "@/components/stock-readings"
import { ValueBar } from "@/components/valuation-scale"
import {
  Details,
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
  // Two decimals: the surprise is usually a few hundredths of a percent of price.
  const pct = signals.surprise * 100
  return `${pct < 0 ? "\u2212" : "+"}${Math.abs(pct).toFixed(2)}% of price`
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
        <PanelTitle>How it ranks</PanelTitle>
        <PanelMeta>0–100 across the S&amp;P 500</PanelMeta>
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
            <TableHead>Ingredient</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Reading</TableHead>
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

      <PanelBody className="flex flex-col gap-2 border-t border-border">
        <p className="text-sm leading-relaxed text-muted-foreground">
          100 is the best in the index on that measure. The two scores at the top
          average the ingredients named.
        </p>
        <Details summary="How well has this worked?">
          <p>{SIGNAL_EVIDENCE}</p>
        </Details>
      </PanelBody>
    </Panel>
  )
}
