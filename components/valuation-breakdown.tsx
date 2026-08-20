import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { MarginBar, formatSignedPercent } from "@/components/valuation-scale"
import {
  VALUATION_METHODS,
  consensusMarginOfSafety,
  valuationBand,
  BAND_LABELS,
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

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-4">
        <CardTitle>Valuation models</CardTitle>
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {stock.verdicts.length} of {VALUATION_METHODS.length} applied
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Consensus first — the headline the row-by-row table then explains. */}
        <div className="flex flex-col gap-2 border border-border px-5 py-4">
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Consensus margin of safety
          </span>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-semibold">
              {formatSignedPercent(consensus)}
            </span>
            <span className="text-sm text-muted-foreground">
              {BAND_LABELS[valuationBand(consensus)]} · confidence-weighted
              across {stock.verdicts.length}{" "}
              {stock.verdicts.length === 1 ? "model" : "models"}
            </span>
          </div>
          <MarginBar margin={consensus} className="mt-1 w-full max-w-sm" />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Fair value</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="w-40">Signal</TableHead>
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
                      <span className="flex flex-col gap-0.5">
                        <span>{method.label}</span>
                        <span className="text-xs">{method.full}</span>
                      </span>
                    </TableCell>
                    {/* Every model here is implemented. A missing row means
                        this one declined to value this company — it has
                        nothing to say, which is a result, not a gap. */}
                    <TableCell
                      colSpan={4}
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
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{method.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {method.full}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatPrice(verdict.fairValue)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatSignedPercent(verdict.marginOfSafety)}
                  </TableCell>
                  <TableCell>
                    <MarginBar margin={verdict.marginOfSafety} />
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

        <p className="text-xs leading-relaxed text-muted-foreground">
          Current price {formatPrice(stock.price)}. A positive margin means the
          model&rsquo;s fair value sits above the market price.
        </p>
      </CardContent>
    </Card>
  )
}
