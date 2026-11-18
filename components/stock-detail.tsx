"use client"

import { DiscountRatePanel } from "@/components/discount-rate-panel"
import { ImpliedReturnPanel } from "@/components/implied-return-panel"
import { SignalPanel } from "@/components/signal-panel"
import {
  KeyStatisticsCard,
  PriceChartCard,
  useTickerReturns,
} from "@/components/ticker-history"
import type { Stock } from "@/lib/valuation"

/**
 * The stock detail layout: what the company has done on the left, what it is
 * worth on the right.
 *
 * The discount rates moved to the left column with the restyle. They are an
 * input to the right-hand column, not a reading of it, and the two columns
 * used to end at wildly different heights — the left ran out after two cards
 * and left a quarter of the page empty on a wide screen. Grouping the measured
 * quantities (price, beta, the rates derived from them) against the estimated
 * ones (the signal, what the price implies) is also the more honest split.
 */
export function StockDetail({
  stock,
  riskFreeRate,
  marketReturn,
}: {
  stock: Stock
  /** Both scalars ride on the universe payload this page already loaded. */
  riskFreeRate: number | null
  marketReturn: number | null
}) {
  const { data, loading, error } = useTickerReturns(stock.ticker)

  return (
    <div className="grid items-start gap-4 px-6 py-5 lg:px-10 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {error && (
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything else on this page is precomputed and unaffected: only
              the close series is fetched.
            </p>
          </div>
        )}

        {/* A placeholder for the chart alone. Key statistics used to sit
            behind this too, because it read the same request; every figure it
            prints is now on the server payload, so it renders immediately and
            has nothing to wait for. */}
        {loading && !data && (
          <div className="h-[21rem] animate-pulse border border-border bg-card" />
        )}

        {data && <PriceChartCard data={data} />}

        <KeyStatisticsCard
          beta={stock.beta}
          riskFreeRate={riskFreeRate}
          realisedReturn={stock.realisedReturn}
          marketReturn={marketReturn}
        />

        {/* Absent on the offline sample, which has no rates to report. */}
        {stock.discountRates && (
          <DiscountRatePanel rates={stock.discountRates} />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* The signal leads the estimated side of the page, as it leads the
            screener; what the price implies is its value component broken
            down by model. */}
        <SignalPanel stock={stock} />
        <ImpliedReturnPanel stock={stock} />
      </div>
    </div>
  )
}
