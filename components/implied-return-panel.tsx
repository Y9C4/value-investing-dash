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
  ImpliedReturnBar,
  formatSignedPercent,
} from "@/components/valuation-scale"
import {
  BAND_LABELS,
  gapTextClass,
  IMPLIED_BASIS,
  VALUATION_METHODS,
  impliedAlpha,
  methodAlpha,
  requiredReturn,
  valuationBand,
  type Stock,
} from "@/lib/valuation"

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return `${(value * 100).toFixed(1)}%`
}

/**
 * The same reverse FCFF solved the other way: the growth the price assumes at
 * the WACC, beside the growth the company has delivered. Display only.
 */
function ImpliedGrowth({ stock }: { stock: Stock }) {
  const { impliedGrowth = null, impliedGrowthAboveMax = null } = stock.signals ?? {}
  const assumed = impliedGrowthAboveMax
    ? "over 100%"
    : impliedGrowth === null
      ? "—"
      : `${(impliedGrowth * 100).toFixed(1)}%`
  const why = impliedGrowthAboveMax
    ? "No five-year growth path from today's cash flow reaches this price."
    : impliedGrowth === null
      ? stock.discountRates?.wacc === null
        ? "No WACC (financial firms, or no cost of debt), so FCFF does not apply."
        : "Needs positive free cash flow to the firm."
      : "a year, fading to 2.5% over five years. Solved at WACC, so it is sensitive when WACC is near long-run growth."

  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border [&>*]:bg-card [&>*]:px-4 [&>*]:py-3">
      <Stat label="Implied FCFF growth" value={assumed} hint={why} />
      <Stat
        label="Trailing revenue growth"
        value={stock.revenueGrowth === null ? "—" : `${(stock.revenueGrowth * 100).toFixed(1)}%`}
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
          label="Implied excess return (implied − required), averaged over models"
          className={gapTextClass(alpha)}
          value={
            <span className="flex items-baseline gap-2">
              <span>{alpha === null ? "—" : `${formatSignedPercent(alpha).replace("%", "")} pp`}</span>
              <span className="font-sans text-xs font-normal">
                {BAND_LABELS[band]}
              </span>
            </span>
          }
          size="lead"
        >
          {alpha !== null && (
            <ImpliedReturnBar alpha={alpha} className="mt-1 w-full" />
          )}
        </Stat>
      </div>

      <ImpliedGrowth stock={stock} />

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Implied</TableHead>
            <TableHead className="text-right">Required</TableHead>
            <TableHead className="text-right">Implied − required</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {VALUATION_METHODS.map((method) => {
            const excess = methodAlpha(stock, method.id)
            return (
              <TableRow key={method.id} className="hover:bg-transparent">
                <TableCell>
                  <span className="text-sm font-medium">
                    {method.label}
                  </span>
                  <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
                    {method.full}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {percent(stock.signals?.impliedReturns[method.id])}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {percent(requiredReturn(stock, method.id))}{" "}
                  <span className="text-xs">
                    {method.against === "wacc" ? "WACC" : "kₑ"}
                  </span>
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-sm ${gapTextClass(excess)}`}
                >
                  {excess === null ? "—" : `${formatSignedPercent(excess).replace("%", "")} pp`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <PanelBody className="border-t border-border">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each model solves for the return that makes five years of its cash
          flow, then a perpetuity, worth today&rsquo;s price. The headline
          averages whichever solved. A dash means no solution at this price (no
          positive cash flow, or an implied return above 100%). The band is
          this stock&rsquo;s value quintile; the backtest found the ranking
          useful and the size not.
        </p>
      </PanelBody>
    </Panel>
  )
}
