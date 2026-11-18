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
  BAND_TEXT_CLASS,
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
 * What the price implies: each reverse-DCF model's implied return against the
 * rate the stock is required to earn, and their average — the number the
 * screener's "Price implies" column shows and its bands are cut on.
 */
export function ImpliedReturnPanel({ stock }: { stock: Stock }) {
  if (!stock.signals) return null

  const alpha = impliedAlpha(stock)
  const band = valuationBand(alpha)

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="flex items-center gap-1.5">
            What the price implies
            <Info title="Implied excess return">{IMPLIED_BASIS}</Info>
          </span>
        </PanelTitle>
        <PanelMeta>per year, reverse DCF</PanelMeta>
      </PanelHeader>

      <div className="border-b border-border px-4 py-3">
        <Stat
          label="Over the required return"
          className={BAND_TEXT_CLASS[band]}
          value={
            <span className="flex items-baseline gap-2">
              <span>{alpha === null ? "—" : formatSignedPercent(alpha)}</span>
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

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Implied</TableHead>
            <TableHead className="text-right">Required</TableHead>
            <TableHead className="text-right">Excess</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {VALUATION_METHODS.map((method) => {
            const excess = methodAlpha(stock, method.id)
            return (
              <TableRow key={method.id} className="hover:bg-transparent">
                <TableCell>
                  <span className="text-xs font-semibold tracking-wider uppercase">
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
                  className={`text-right font-mono text-sm ${BAND_TEXT_CLASS[valuationBand(excess)]}`}
                >
                  {excess === null ? "—" : formatSignedPercent(excess)}
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
          positive cash flow, or an implied return above 100%). Bands are
          quintiles of the index, and the backtest found the ranking useful and
          the size not.
        </p>
      </PanelBody>
    </Panel>
  )
}
