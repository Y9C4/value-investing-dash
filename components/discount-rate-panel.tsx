import { Tex } from "@/components/tex"
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
  formula?: React.ReactNode
  note?: React.ReactNode
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
        <span className="text-sm text-muted-foreground">
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
  const debtNote = rates.syntheticRating ? (
    <>
      <Tex>{"r_f + \\text{spread}"}</Tex> for synthetic rating {rates.syntheticRating}
      {coverage !== null && coverage !== undefined && (
        <> (<Tex>{`\\text{EBIT} / \\text{interest} = ${coverage.toFixed(1)}\\times`}</Tex>)</>
      )}
    </>
  ) : (
    "not measured: no interest expense reported"
  )
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Figure
          label="Cost of equity"
          value={formatPct(rates.costOfEquity)}
          formula={<Tex>{"k_e = r_f + \\beta \\times \\text{MRP}"}</Tex>}
          note={
            rates.costOfEquity === null
              ? "none: no beta measured"
              : "hurdle for RIM and shareholder yield"
          }
        />
        <Figure
          label="WACC"
          value={formatPct(rates.wacc)}
          formula={<Tex>{"k_e \\dfrac{E}{V} + k_d \\dfrac{D}{V}\\,(1-t)"}</Tex>}
          note={noWaccReason(stock) ?? "hurdle for FCFF and revenue"}
        />
        <Figure
          label="Beta"
          value={beta === null ? "—" : beta.toFixed(2)}
          note={
            rates.betaRaw === null || rates.betaRaw === undefined
              ? "Vasicek-shrunk (Levi & Welch 2017)"
              : `raw OLS ${rates.betaRaw.toFixed(2).replace("-", "−")}`
          }
        />
        <Figure
          label="Risk-free rate, 10-year Treasury"
          value={formatPct(rates.riskFree)}
          note={<>spot yield; <Tex>r_f</Tex> in CAPM and base of <Tex>k_d</Tex></>}
        />
        <Figure
          label="Cost of debt"
          value={formatPct(rates.costOfDebt)}
          note={debtNote}
        />
        <Figure
          label="Equity weight (E/V)"
          formula={<Tex>{"\\dfrac{E}{E+D}"}</Tex>}
          value={formatPct(rates.equityWeight)}
          note="market cap; debt excludes leases"
        />
        <Figure
          label="Tax rate"
          value={formatPct(rates.taxRate)}
          note="effective rate, latest annual statement"
        />
      </dl>

      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm text-muted-foreground">
        <div>
          <Tex>{"\\beta = 0.75\\,\\beta_{\\text{Vasicek}} + 0.25 \\times 0.9"}</Tex>, from 252 daily returns on the
          Fama-French market factor (Levi &amp; Welch 2017)
        </div>
        <div>
          <Tex>{"\\text{MRP} = \\overline{R_m - r_f}"}</Tex>, the long-run mean
        </div>
        <div>
          <Tex>{"k_d = y_{10\\text{Y}} + s(\\text{rating})"}</Tex>, rating from <Tex>{"\\text{EBIT} / \\text{interest}"}</Tex> (Damodaran,
          Jan 2026)
        </div>
        <div>No WACC for financial firms. <Tex>r_f</Tex> is the 10Y because a DCF discounts over decades.</div>
      </div>
    </div>
  )
}
