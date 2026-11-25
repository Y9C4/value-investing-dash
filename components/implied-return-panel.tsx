import { Info } from "@/components/info"
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
import { missingReason, noGrowthReason } from "@/components/stock-readings"
import { formatPct, formatPp, formatSignedPct } from "@/lib/format"
import {
  gapTextClass,
  IMPLIED_BASIS,
  VALUATION_METHODS,
  methodAlpha,
  requiredReturn,
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
    ? "a year: even 100% growth for five years would not justify this price."
    : impliedGrowth === null
      ? noGrowthReason(stock)
      : "a year to start, slowing to 2.5% over five years. Calculated at WACC, so it swings widely when WACC is close to 2.5%."

  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border [&>*]:bg-card [&>*]:px-4 [&>*]:py-3">
      <Stat label="FCFF growth the price assumes" value={assumed} hint={why} />
      <Stat
        label="Revenue growth so far"
        value={formatSignedPct(stock.revenueGrowth)}
        hint={stock.revenueGrowth === null ? "no growth history" : "a year, from reported results"}
      />
    </div>
  )
}

/**
 * What the price implies: each reverse-DCF model's implied return against the
 * rate the stock is required to earn, and their average — the number the
 * screener's value rank is taken from.
 */
export function ImpliedReturnPanel({ stock }: { stock: Stock }) {
  if (!stock.signals) return null

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="flex items-center gap-1.5">
            What the price implies
            <Info title="Return gap">{IMPLIED_BASIS}</Info>
          </span>
        </PanelTitle>
        <PanelMeta>reverse DCF · % a year</PanelMeta>
      </PanelHeader>

      <p className="border-b border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">
        Four reverse-DCF models each work out the return implied by today&rsquo;s
        price. A positive gap means the price offers more than the stock&rsquo;s
        risk calls for.
      </p>

      <ImpliedGrowth stock={stock} />

      {/* Under 640px the Implied and Required columns fold into the model
          cell, so the headline column survives on a phone. */}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Implied</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Required</TableHead>
            <TableHead className="text-right">Gap</TableHead>
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
        <Details>
          <p>
            Each model finds the return at which five years of its cash flow,
            plus a terminal value, equals today&rsquo;s price. It searches from
            long-run growth (2.5%) to 100% a year. The headline figure averages
            the models that have both an implied and a required return.
          </p>
          <p>
            A dash means the figure could not be calculated, and the row says
            why. Under Implied, an input is missing or negative, or no rate in
            that range fits. Under Required, there is no WACC: we do not
            calculate it for financial firms, or no interest expense is reported.
          </p>
          <p>
            The quintile compares this stock with the rest of the index. In
            testing, that ranking was informative but the size of the gap was not.
          </p>
        </Details>
      </PanelBody>
    </Panel>
  )
}
