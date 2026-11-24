import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel"
import type { DiscountRates } from "@/lib/valuation"

/**
 * The required returns each implied return on this page is measured against.
 *
 * The numbers come from `warehouse.discount_rates`, which reads the same
 * `warehouse.inputs` row the signal solves from, so the panel cannot drift
 * from the rates the comparison used.
 */

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—"
  return `${(value * 100).toFixed(2)}%`
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
      <dt className="text-[0.6875rem] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="font-mono text-base font-semibold tabular-figures">
        {value}
      </dd>
      {formula && (
        <span className="font-mono text-[0.6875rem] leading-tight text-muted-foreground">
          {formula}
        </span>
      )}
      {note && (
        <span className="text-[0.6875rem] leading-tight text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  )
}

export function DiscountRatePanel({ rates }: { rates: DiscountRates }) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Required returns</PanelTitle>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Figure
            label="Cost of equity"
            value={formatPercent(rates.costOfEquity)}
            formula="rf + β × market premium"
            note="CAPM. what RIM and shareholder yield must beat"
          />
          <Figure
            label="WACC"
            value={formatPercent(rates.wacc)}
            formula="ke(E/V) + kd(D/V)(1 − t)"
            note="what FCFF and revenue must beat"
          />
          <Figure
            label="10Y Treasury"
            value={formatPercent(rates.riskFree)}
            note="10-year Treasury (^TNX), spot"
          />
          <Figure
            label="Cost of debt"
            value={formatPercent(rates.costOfDebt)}
            note="interest over debt ex leases, clamped to 2-15%"
          />
          <Figure
            label="Equity weight (E/V)"
            value={formatPercent(rates.equityWeight)}
            note="market cap over market cap plus debt"
          />
          <Figure
            label="Tax rate"
            value={formatPercent(rates.taxRate)}
            note="from the latest annual statement"
          />
        </dl>

        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Beta is the 252-day CAPM regression on Fama-French market excess
          returns, and the premium is the long-run average of that series. CAPM
          replaced the Fama-French regression after the backtest found it the
          better required return.
        </p>
      </PanelBody>
    </Panel>
  )
}
