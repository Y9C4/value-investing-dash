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
      <dt className="text-xs font-semibold text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-base font-semibold">
        {value}
      </dd>
      {formula && (
        <span className="font-mono text-xs leading-tight text-muted-foreground">
          {formula}
        </span>
      )}
      {note && (
        <span className="text-xs leading-tight text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  )
}

export function DiscountRatePanel({
  rates,
  beta,
}: {
  rates: DiscountRates
  /** The shrunk beta kₑ uses, from the stock row. */
  beta: number | null
}) {
  const coverage = rates.interestCoverage
  const debtNote = rates.syntheticRating
    ? `rf + the default spread for a ${rates.syntheticRating} synthetic rating (EBIT ÷ interest ${
        coverage === null || coverage === undefined ? "—" : `${coverage.toFixed(1)}×`
      })`
    : "not measured: no interest expense reported"
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
            note={
              rates.wacc === null
                ? "none: financial firm, or no cost of debt"
                : "what FCFF and revenue must beat"
            }
          />
          <Figure
            label="Beta"
            value={beta === null ? "—" : beta.toFixed(2)}
            note={
              rates.betaRaw === null || rates.betaRaw === undefined
                ? "shrunk (Levi & Welch 2017)"
                : `shrunk from a raw ${rates.betaRaw.toFixed(2)} (Levi & Welch 2017)`
            }
          />
          <Figure
            label="10Y Treasury"
            value={formatPercent(rates.riskFree)}
            note="10-year Treasury (^TNX), spot"
          />
          <Figure
            label="Cost of debt"
            value={formatPercent(rates.costOfDebt)}
            note={debtNote}
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
          Beta is the 252-day regression on Fama-French market excess
          returns, shrunk toward the index mean by its own standard error
          (Vasicek), then a quarter of the way toward 0.9 (Levi &amp; Welch
          2017). The premium is the long-run average of that series. The cost
          of debt follows Damodaran&rsquo;s synthetic rating table (January
          2026).
        </p>
      </PanelBody>
    </Panel>
  )
}
