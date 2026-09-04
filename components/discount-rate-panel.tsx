import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
} from "@/components/ui/panel"
import type { DiscountRates } from "@/lib/valuation"

/**
 * The rates every valuation on this page was discounted at.
 *
 * CAPM and WACC sit here rather than in the model table because they produce
 * a rate, not a value per share. Listing CAPM beside FCFE left a permanently
 * empty row on every stock page.
 *
 * The numbers come from `ticker_statistics`, written by the pass that produced
 * the verdicts, so the panel cannot drift from the rate the models used.
 * Computing a WACC here for display would reintroduce that bug.
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
  const source = rates.costOfEquitySource
  const sourceLabel = source ? SOURCE_LABEL[source] : null

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Discount rates</PanelTitle>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Figure
            label="Cost of equity"
            value={formatPercent(rates.costOfEquity)}
            note={
              sourceLabel
                ? `derrived from ${sourceLabel} regression. discounts FCFE, DDM and RIM`
                : "discounts FCFE, DDM and RIM"
            }
          />
          <Figure
            label="WACC"
            value={formatPercent(rates.wacc)}
            formula="ke(E/V) + (kd(D/V))(1-t)"
            note="blends cost of equity and cost of debt. discounts FCFF"
          />
          <Figure
            label="CAPM cost of equity"
            value={formatPercent(rates.capmCostOfEquity)}
            formula="rf + β(E[rm] - rf)"
            note={
              source && source !== "capm"
                ? "required return on asset value, unused"
                : "required return on asset value (WACC)"
            }
          />
          <Figure
            label="Cost of debt"
            value={formatPercent(rates.costOfDebt)}
            note="As reported in latest income statement"
          />
          <Figure
            label="Equity weight (E/V)"
            value={formatPercent(rates.equityWeight)}
            note={
              rates.equityWeight !== null && rates.equityWeight <= 0.4
                ? "at the 60% debt-weight cap"
                : "% of stock value derrived from equity"
            }
          />
          <Figure
            label="Risk-free rate"
            value={formatPercent(rates.riskFree)}
            note="13-week T-bill (^IRX), 252-day average"
          />
        </dl>

        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Cost of Equity is derrived from the {" "}
          {sourceLabel ?? "factor"} regression. WACC uses cost of debt off the company's latest financial statements.
        </p>
      </PanelBody>
    </Panel>
  )
}
