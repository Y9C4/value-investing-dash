import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { DiscountRates } from "@/lib/valuation"

/**
 * The rates every valuation on this page was discounted at.
 *
 * CAPM and WACC live here rather than in the model table because they are not
 * fair-value models — they produce a rate, not an intrinsic value per share.
 * Listing CAPM alongside FCFE and DDM is what left a permanently empty "CAPM"
 * row on every stock page while the UI claimed nine live models.
 *
 * The numbers come from `ticker_statistics`, written by the same pass that
 * produced the verdicts, so this panel cannot drift from the rate the models
 * actually used. Computing a WACC here for display would reintroduce exactly
 * the class of bug this replaced.
 */

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return `${(value * 100).toFixed(2)}%`
}

const SOURCE_LABEL: Record<string, string> = {
  ff5: "Fama-French 5-factor",
  ff3: "Fama-French 3-factor",
  capm: "CAPM",
}

function Figure({
  label,
  value,
  formula,
  note,
}: {
  label: string
  value: string
  formula?: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="text-xl font-semibold">{value}</dd>
      {formula && (
        <span className="font-mono text-[0.7rem] text-muted-foreground">
          {formula}
        </span>
      )}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  )
}

export function DiscountRatePanel({ rates }: { rates: DiscountRates }) {
  const source = rates.costOfEquitySource
  const sourceLabel = source ? SOURCE_LABEL[source] : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount rates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
          <Figure
            label="Cost of equity"
            value={formatPercent(rates.costOfEquity)}
            note={
              sourceLabel
                ? `via ${sourceLabel} — discounts FCFE, DDM and RIM`
                : undefined
            }
          />
          <Figure
            label="WACC"
            value={formatPercent(rates.wacc)}
            formula="(E/V)·ke + (D/V)·kd·(1−t)"
            note="discounts FCFF"
          />
          <Figure
            label="CAPM cost of equity"
            value={formatPercent(rates.capmCostOfEquity)}
            formula="rf + β(E[rm] − rf)"
            note={
              source && source !== "capm"
                ? "shown for reference; not the rate used"
                : "used — no factor regression available"
            }
          />
          <Figure
            label="Cost of debt"
            value={formatPercent(rates.costOfDebt)}
            formula="interest expense ÷ total debt"
          />
          <Figure
            label="Equity weight (E/V)"
            value={formatPercent(rates.equityWeight)}
            note={
              rates.equityWeight !== null && rates.equityWeight <= 0.4
                ? "at the 60% debt-weight cap"
                : undefined
            }
          />
          <Figure
            label="Risk-free rate"
            value={formatPercent(rates.riskFree)}
            note="13-week T-bill (^IRX), 252-day average"
          />
        </dl>

        <p className="text-xs leading-relaxed text-muted-foreground">
          A higher discount rate produces a lower fair value. The debt weight is
          capped at 60%: market-value weights otherwise make the discount rate a
          function of the price being valued, so a falling share price would
          lower WACC and make the model call the same equity more valuable.
        </p>
      </CardContent>
    </Card>
  )
}
