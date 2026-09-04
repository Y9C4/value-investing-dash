"use client"

import { DiscountRatePanel } from "@/components/discount-rate-panel"
import { ModelDisagreement } from "@/components/model-disagreement"
import {
  KeyStatisticsCard,
  PriceChartCard,
  deriveCapm,
  useTickerReturns,
} from "@/components/ticker-history"
import { ValuationBreakdown } from "@/components/valuation-breakdown"
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
 * ones (fair values, the spread between them) is also the more honest split.
 */
export function StockDetail({ stock }: { stock: Stock }) {
  const { data, loading, error } = useTickerReturns(stock.ticker)
  const { beta } = deriveCapm(data)

  return (
    <div className="grid items-start gap-4 px-6 py-5 lg:px-10 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {error && (
          <div className="border border-border bg-card px-4 py-3">
            <p className="text-sm text-destructive">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The valuations beside this are precomputed and unaffected — only
              the price history needs the live service.
            </p>
          </div>
        )}

        {/* Placeholders rather than a collapsed column: the valuation table on
            the right renders immediately from server data, so without these the
            left side would pop in late and shift the page. Heights track the
            panels they stand in for. */}
        {loading && !data && (
          <>
            <div className="h-[21rem] animate-pulse border border-border bg-card" />
            <div className="h-28 animate-pulse border border-border bg-card" />
          </>
        )}

        {data && (
          <>
            {/* The verdicts ride along so the chart can draw each fair value
                on the same axis as the price it is a claim about. */}
            <PriceChartCard data={data} stock={stock} />
            <KeyStatisticsCard data={data} beta={beta} />
          </>
        )}

        {/* Absent on the offline sample, which has no rates to report. */}
        {stock.discountRates && (
          <DiscountRatePanel rates={stock.discountRates} />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <ValuationBreakdown stock={stock} />
        {/* Directly under the table it reads: the table states each number and
            this states what the set of them amounts to. */}
        <ModelDisagreement stock={stock} />
      </div>
    </div>
  )
}
