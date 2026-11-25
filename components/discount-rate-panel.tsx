import { noWaccReason } from "@/components/stock-readings"
import { formatPct } from "@/lib/format"
import type { DiscountRates, Stock } from "@/lib/valuation"

/**
 * The required returns each implied return on this page is measured against.
 *
 * The numbers come from `warehouse.discount_rates`, which reads the same
 * `warehouse.inputs` row the signal solves from, so the panel cannot drift
 * from the rates the comparison used. Rendered inside the page's collapsed
 * "Required return and risk inputs" section, which is its title.
 */

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
      <dd className="font-figure text-base font-semibold">
        {value}
      </dd>
      {formula && (
        <span className="font-figure text-xs leading-tight text-muted-foreground">
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
  stock,
  rates,
}: {
  /** The shrunk beta kₑ uses, and what a missing WACC is explained from. */
  stock: Stock
  rates: DiscountRates
}) {
  const beta = stock.beta
  const coverage = rates.interestCoverage
  const debtNote = rates.syntheticRating
    ? `rf + the default spread for a ${rates.syntheticRating} synthetic rating (EBIT ÷ interest ${
        coverage === null || coverage === undefined ? "—" : `${coverage.toFixed(1)}×`
      })`
    : "not measured: no interest expense reported"
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Figure
          label="Cost of equity"
          value={formatPct(rates.costOfEquity)}
          formula="rf + β × market premium"
          note={
            rates.costOfEquity === null
              ? "none: no beta measured"
              : "CAPM; the hurdle for residual income and shareholder yield"
          }
        />
        <Figure
          label="WACC"
          value={formatPct(rates.wacc)}
          formula="ke(E/V) + kd(D/V)(1 − t)"
          note={noWaccReason(stock) ?? "the hurdle for FCFF and revenue"}
        />
        <Figure
          label="Beta"
          value={beta === null ? "—" : beta.toFixed(2)}
          note={
            rates.betaRaw === null || rates.betaRaw === undefined
              ? "adjusted toward the market average (Levi & Welch 2017)"
              : `adjusted from a measured ${rates.betaRaw.toFixed(2)} (Levi & Welch 2017)`
          }
        />
        <Figure
          label="Risk-free rate, 10-year Treasury"
          value={formatPct(rates.riskFree)}
          note="Today's yield, used as the risk-free rate in CAPM and as the base of the cost of debt"
        />
        <Figure
          label="Cost of debt"
          value={formatPct(rates.costOfDebt)}
          note={debtNote}
        />
        <Figure
          label="Equity weight (E/V)"
          value={formatPct(rates.equityWeight)}
          note="market cap over market cap plus debt"
        />
        <Figure
          label="Tax rate"
          value={formatPct(rates.taxRate)}
          note="from the latest annual statement"
        />
      </dl>

      <p className="border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
        Beta comes from 252 days of returns against the Fama-French market
        factor, pulled toward the index average according to how noisy it is
        (Vasicek), then a quarter of the way toward 0.9 (Levi &amp; Welch 2017).
        The market premium is that factor&rsquo;s long-run average. Cost of debt
        uses Damodaran&rsquo;s synthetic rating table (January 2026). We use the
        10-year Treasury here because a DCF discounts cash flows over decades.
      </p>
    </div>
  )
}
