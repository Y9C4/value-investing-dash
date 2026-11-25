import { Tex } from "@/components/tex"
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
  const assumed = impliedGrowthAboveMax ? "over 100%" : formatPct(impliedGrowth).replace("-", "−")
  const why = impliedGrowthAboveMax
    ? "p.a.: no g₀ up to 100% reaches the current EV."
    : impliedGrowth === null
      ? noGrowthReason(stock)
      : <><Tex>g_0</Tex> fading linearly to <Tex>{"g = 2.5\\%"}</Tex> over 5 years, solved at WACC. Sensitive as <Tex>{"\\text{WACC} \\to g"}</Tex>.</>

  return (
    <div className="grid grid-cols-2 gap-px border-b border-border bg-border [&>*]:bg-card [&>*]:px-4 [&>*]:py-3">
      <Stat label={<span>Market-implied FCFF growth (<Tex>g_0</Tex>)</span>} value={assumed} hint={why} />
      <Stat
        label="Trailing revenue CAGR"
        value={formatSignedPct(stock.revenueGrowth)}
        hint={stock.revenueGrowth === null ? "no growth history" : "p.a., as reported"}
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
            Implied return · reverse DCF
            <Info title="Implied alpha">
              <Tex block>{"\\alpha = \\frac{1}{n} \\sum_{i=1}^{n} (r_i - k_i)"}</Tex>
              Each r solves price = PV of cash flows. k is WACC for FCFF and revenue, cost of equity for
              residual income and shareholder yield.
            </Info>
          </span>
        </PanelTitle>
        <PanelMeta>% p.a.</PanelMeta>
      </PanelHeader>

      <ImpliedGrowth stock={stock} />

      {/* Under 640px the Implied and Required columns fold into the model
          cell, so the headline column survives on a phone. */}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Implied r</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Hurdle k</TableHead>
            <TableHead className="text-right"><Tex>{"\\alpha = r - k"}</Tex></TableHead>
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
                  <span className="hidden text-xs text-muted-foreground sm:block">
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
        <Details summary="Formulas">
          <dl className="flex flex-col gap-2">
            {VALUATION_METHODS.map((method) => (
              <div key={method.id}>
                <dt className="text-xs font-semibold text-foreground">{method.label}</dt>
                <dd className="text-sm"><Tex block>{method.formula}</Tex></dd>
              </div>
            ))}
            <div>
              <dt className="text-xs font-semibold text-foreground">Terminal value and growth</dt>
              <dd className="text-sm">
                <Tex block>{"\\text{TV} = \\frac{\\text{CF}_5\\,(1+g)}{r-g}, \\quad g = \\min(2.5\\%,\\ y_{10\\text{Y}})"}</Tex>
                <Tex block>{"r \\in [g,\\ 100\\%]"}</Tex>
              </dd>
              <dd className="text-xs">Each model is solved for r. No root in that range, no reading.</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-foreground">Headline</dt>
              <dd className="text-sm"><Tex block>{"\\alpha = \\frac{1}{n} \\sum_{i=1}^{n} (r_i - k_i)"}</Tex></dd>
              <dd className="text-xs">Over the models with both r and k.</dd>
            </div>
          </dl>
        </Details>
      </PanelBody>
    </Panel>
  )
}
