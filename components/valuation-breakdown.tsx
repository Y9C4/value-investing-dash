import {
  Panel,
  PanelBody,
  PanelHeader,
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
import { formatSignedPercent } from "@/components/valuation-scale"
import {
  VALUATION_METHODS,
  consensusFairValue,
  consensusMarginOfSafety,
  type Stock,
} from "@/lib/valuation"

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

/**
 * Every model's verdict on one stock, side by side. The spread between them is
 * the point: agreement is conviction, disagreement is a reason to read further.
 */
export function ValuationBreakdown({ stock }: { stock: Stock }) {
  const consensus = consensusMarginOfSafety(stock)
  const scored = new Map(stock.verdicts.map((v) => [v.method, v]))

  // What the consensus margin says the share is worth. The margin is the
  // headline because it is comparable across companies, but it is a ratio, and
  // a ratio against an unstated price is half a statement — this is the other
  // half, in the unit the reader is actually going to pay in.
  //
  // Through the shared helper rather than multiplied out here, so this and the
  // consensus bar on the disagreement panel below cannot come from two
  // different arithmetics and quietly disagree by a cent.
  const fairValue = consensusFairValue(stock)

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Valuation models</PanelTitle>
      </PanelHeader>

      {/* Consensus first — the headline the row-by-row table then explains.
          Its own strip rather than a box inside the body: this is what the
          panel exists to report, and a border around it inside a border around
          the panel is two frames for one figure. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">

          <div className="flex flex-wrap items-baseline gap-2">
            <Stat
              label="Consensus Margin of Safety"
              value={formatSignedPercent(consensus)}
              size="lead"
              className={
                consensus > 0 ? "text-undervalued" : "text-overvalued"
              }
            />
          </div>
        </div>

        {/* The two prices the margin is the ratio between, side by side and in
            the same weight, so the comparison is read rather than computed. */}
        <div className="flex items-end gap-6">
          <Stat label="Market price" value={formatPrice(stock.price)} size="lead" />
          <Stat
            label="Consensus value"
            value={formatPrice(fairValue)}
            size="lead"
            className={
              consensus > 0 ? "text-undervalued" : "text-overvalued"
            }
          />
        </div>
      </div>

      <PanelBody className="px-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Fair value</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {VALUATION_METHODS.map((method) => {
              const verdict = scored.get(method.id)

              if (!verdict) {
                return (
                  <TableRow key={method.id}>
                    <TableCell className="text-muted-foreground">
                      <span className="flex items-baseline gap-2">
                        <span>{method.label}</span>
                        <span className="hidden text-xs sm:inline">
                          {method.full}
                        </span>
                      </span>
                    </TableCell>
                    {/* Every model here is implemented. A missing row means
                        this one declined to value this company — it has
                        nothing to say, which is a result, not a gap. */}
                    <TableCell
                      colSpan={3}
                      className="text-right text-xs tracking-wider text-muted-foreground uppercase"
                    >
                      Does not apply
                    </TableCell>
                  </TableRow>
                )
              }

              return (
                <TableRow key={method.id}>
                  <TableCell>
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">{method.label}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {method.full}
                      </span>
                    </span>
                  </TableCell>

                  <TableCell
                    className={
                      verdict.marginOfSafety > 0 ? "text-right font-mono text-undervalued" : "text-right font-mono text-overvalued"
                    }
                  >
                    {formatPrice(verdict.fairValue)}
                  </TableCell>

                  <TableCell
                    className={
                      verdict.marginOfSafety > 0 ? "text-right font-mono text-undervalued" : "text-right font-mono text-overvalued"
                    }
                  >
                    {formatSignedPercent(verdict.marginOfSafety)}
                  </TableCell>

                  <TableCell className="text-right">
                    <span className="flex items-center justify-end gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {(verdict.confidence * 100).toFixed(0)}%
                      </span>
                      <span
                        className="h-2 w-10 shrink-0"
                        style={{
                          background: `linear-gradient(to right, var(--color-seq-3) ${(
                            verdict.confidence * 100
                          ).toFixed(0)}%, var(--color-muted) ${(
                            verdict.confidence * 100
                          ).toFixed(0)}%)`,
                        }}
                        aria-hidden="true"
                      />
                    </span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}
