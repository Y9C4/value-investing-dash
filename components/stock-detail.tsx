"use client"

import { DiscountRatePanel } from "@/components/discount-rate-panel"
import { ImpliedReturnPanel } from "@/components/implied-return-panel"
import { RatioPanel } from "@/components/ratio-panel"
import { SignalPanel, type BlendScore } from "@/components/signal-panel"
import {
  KeyStatisticsCard,
  PriceChartCard,
  useTickerReturns,
} from "@/components/ticker-history"
import type { RatioContext } from "@/lib/sectors"
import type { Stock } from "@/lib/valuation"

/**
 * The stock page's evidence, in reading order: what the price implies, the
 * multiples against the sector, momentum and earnings surprise, the price itself,
 * and — collapsed, because it is the machinery — the required return.
 * On a wide screen the first two and the next two sit side by side.
 */
export function StockDetail({
  stock,
  riskFreeRate,
  marketReturn,
  valueRank,
  ratios,
  blends,
}: {
  stock: Stock
  valueRank: number | null
  ratios: RatioContext[]
  blends: BlendScore[]
  /** Both scalars ride on the universe payload this page already loaded. */
  riskFreeRate: number | null
  marketReturn: number | null
}) {
  const { data, loading, error } = useTickerReturns(stock.ticker)

  return (
    <div className="flex flex-col gap-4 px-6 py-5 lg:px-10">
      <div className="grid items-start gap-4 2xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <ImpliedReturnPanel stock={stock} valuePercentile={valueRank} />
          <RatioPanel sector={stock.sector} context={ratios} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SignalPanel stock={stock} valueRank={valueRank} blends={blends} />

          {error && (
            <div className="border border-border bg-card px-4 py-3">
              <p className="text-sm text-destructive">{error}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Only the price chart is affected: everything else on this page
                is precomputed.
              </p>
            </div>
          )}
          {loading && !data && (
            <div className="h-[21rem] animate-pulse border border-border bg-card" />
          )}
          {data && data.candles.length > 0 && <PriceChartCard data={data} />}

          <KeyStatisticsCard
            beta={stock.beta}
            riskFreeRate={riskFreeRate}
            realisedReturn={stock.realisedReturn}
            marketReturn={marketReturn}
          />
        </div>
      </div>

      {/* Absent on the offline sample, which has no rates to report. */}
      {stock.discountRates && (
        <details className="group border border-border bg-card">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase select-none hover:text-foreground">
            Required return and risk inputs
          </summary>
          <div className="border-t border-border [&>section]:border-0">
            <DiscountRatePanel rates={stock.discountRates} beta={stock.beta} />
          </div>
        </details>
      )}
    </div>
  )
}
