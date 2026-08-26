"use client"

import { DiscountRatePanel } from "@/components/discount-rate-panel"
import {
  KeyStatisticsCard,
  PriceChartCard,
  deriveCapm,
  useTickerReturns,
} from "@/components/ticker-history"
import { ValuationBreakdown } from "@/components/valuation-breakdown"
import type { Stock } from "@/lib/valuation"

/**
 * The stock detail layout: price and risk on the left, every model's verdict on
 * the right.
 *
 * The split follows the question being asked: what has this company done,
 * then what is it worth. The valuation table takes the full right column
 * because it is the reason to be on the page.
 */
export function StockDetail({ stock }: { stock: Stock }) {
  const { data, loading, error } = useTickerReturns(stock.ticker)
  const { beta } = deriveCapm(data)

  return (
    <div className="grid items-start gap-6 px-6 py-8 lg:px-10 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6">
        {error && (
          <div className="border border-border bg-card px-5 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The valuations beside this are precomputed and unaffected — only
              the price history needs the live service.
            </p>
          </div>
        )}

        {/* Placeholders rather than a collapsed column: the valuation table on
            the right renders immediately from server data, so without these the
            left side would pop in late and shift the page. */}
        {loading && !data && (
          <>
            <div className="h-[26rem] animate-pulse border border-border bg-card" />
            <div className="h-56 animate-pulse border border-border bg-card" />
          </>
        )}

        {data && (
          <>
            <PriceChartCard data={data} />
            <KeyStatisticsCard data={data} beta={beta} />
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <ValuationBreakdown stock={stock} />
        {/* Below the verdicts, because the rates only mean something once you
            have seen what they produced. Absent on the offline sample, which
            has no rates to report. */}
        {stock.discountRates && (
          <DiscountRatePanel rates={stock.discountRates} />
        )}
      </div>
    </div>
  )
}
