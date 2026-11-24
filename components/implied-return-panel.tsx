import { Info } from "@/components/info"
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
import {
  missingReason,
  noGrowthReason,
  valueQuintileLabel,
} from "@/components/stock-readings"
import { ImpliedReturnBar } from "@/components/valuation-scale"
import { formatPct, formatPp, formatSignedPct } from "@/lib/format"
import {
  gapTextClass,
  IMPLIED_BASIS,
  VALUATION_METHODS,
  impliedAlpha,
  methodAlpha,
  requiredReturn,
  valuationBand,
  type Stock,
} from "@/lib/valuation"

/**
 * The same reverse FCFF solved the other way: the growth the price assumes at
 * the WACC, beside the growth the company has delivered. Display only.
 */
function ImpliedGrowth({ stock }: { stock: Stock }) {
  const { impliedGrowth = null, impliedGrowthAboveMax = null } = stock.signals ?? {}
  const assumed = impliedGrowthAboveMax ? "over 100%" : formatPct(impliedGrowth)
  const why = impliedGrowthAboveMax
    ? "a year: no five-year growth path up to 100% a year from today's cash flow reaches this price."
    : impliedGrowth === null
      ? noGrowthReason(stock)
      : "a year, fading to 2.5% over five years. Solved at WACC, so it is sensitive when WACC is near long-run growth."

  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border [&>*]:bg-card [&>*]:px-4 [&>*]:py-3">
      <Stat label="Implied FCFF growth" value={assumed} hint={why} />
      <Stat
        label="Trailing revenue growth"
        value={formatSignedPct(stock.revenueGrowth)}
        hint={stock.revenueGrowth === null ? "no growth history" : "a year, trailing, as reported"}
      />
    </div>
  )
}

/**
 * What the price implies: each reverse-DCF model's implied return against the
 * rate the stock is required to earn, and their average — the number the
 * screener's value rank is taken from.
 */
export function ImpliedReturnPanel({
  stock,
  valuePercentile,
}: {
  stock: Stock
  /** This stock's value percentile in the index, which sets its band. */
  valuePercentile: number | null
}) {
  if (!stock.signals) return null

  const alpha = impliedAlpha(stock)
  const band = valuationBand(valuePercentile)
  const counted = VALUATION_METHODS.filter((method) => methodAlpha(stock, method.id) !== null).length

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="flex items-center gap-1.5">
            Implied return, reverse DCF
            <Info title="Implied excess return">{IMPLIED_BASIS}</Info>
          </span>
        </PanelTitle>
        <PanelMeta>% a year</PanelMeta>
      </PanelHeader>

      <div className="border-b border-border px-4 py-3">
        <Stat
          label={
            counted > 0
              ? `Implied excess return (implied − required), mean of ${counted} of 4 models`
              : "Implied excess return (implied − required): no model has both readings"
          }
          className={gapTextClass(alpha)}
          value={
            <span className="flex items-baseline gap-2">
              <span>{alpha === null ? "—" : formatPp(alpha)}</span>
              <span className="font-sans text-xs font-normal">
                {valueQuintileLabel(band)}
              </span>
            </span>
          }
          size="lead"
        >
          {alpha !== null && (
            <ImpliedReturnBar alpha={alpha} className="mt-1 w-full max-w-xl" />
          )}
        </Stat>
      </div>

      <ImpliedGrowth stock={stock} />

      {/* Under 640px the Implied and Required columns fold into the model
          cell, so the headline column survives on a phone. */}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Implied</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Required</TableHead>
            <TableHead className="text-right">Implied − required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {VALUATION_METHODS.map((method) => {
            const excess = methodAlpha(stock, method.id)
            const implied = formatPct(stock.signals?.impliedReturns[method.id])
            const required = formatPct(requiredReturn(stock, method.id))
            const against = method.against === "wacc" ? "WACC" : "kₑ"
            const reason = missingReason(stock, method)
            return (
              <TableRow key={method.id} className="hover:bg-transparent">
                <TableCell className="whitespace-normal">
                  <span className="text-sm font-medium">{method.label}</span>
                  <span className="ml-2 hidden text-xs text-muted-foreground lg:inline">
                    {method.full}
                  </span>
                  <span className="block font-figure text-xs text-muted-foreground sm:hidden">
                    {implied} implied · {required} {against}
                  </span>
                  {reason && (
                    <span className="block text-xs leading-snug text-muted-foreground">
                      {reason}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-right font-figure text-sm sm:table-cell">
                  {implied}
                </TableCell>
                <TableCell className="hidden text-right font-figure text-sm text-muted-foreground sm:table-cell">
                  {required} <span className="text-xs">{against}</span>
                </TableCell>
                <TableCell
                  className={`text-right font-figure text-sm ${gapTextClass(excess)}`}
                >
                  {formatPp(excess)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <PanelBody className="border-t border-border">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each model solves for the return that makes five years of its cash
          flow, then a perpetuity, worth today&rsquo;s price, searching from
          long-run growth (2.5%) to 100% a year. The headline is the mean over
          the models with both an implied and a required return. A dash under
          Implied means the model did not solve (an input it needs is missing
          or not positive, or no rate in that range fits); a dash under
          Required means there is no WACC (not computed for financial firms,
          or no cost of debt because no interest expense is reported). Each
          such row says which. The quintile ranks this stock&rsquo;s reading
          against the index; the backtest found the ranking useful and the
          size not.
        </p>
      </PanelBody>
    </Panel>
  )
}
