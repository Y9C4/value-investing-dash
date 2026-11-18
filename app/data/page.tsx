import { notFound } from "next/navigation"
import { connection } from "next/server"

import { BackfillCard } from "@/components/backfill-card"
import { RefreshAllCard } from "@/components/refresh-all-card"
import { isDataPageEnabled } from "@/lib/market-data-service"

export const metadata = {
  title: "Data",
}

/**
 * The stages run top to bottom: the three loads fill the `raw` schema and the
 * refresh rebuilds every derived number from it in SQL, so a full cold start
 * works down the page. Prices are incremental per ticker, so a daily run costs
 * a fraction of a cold one and a run after a five-day gap catches up on its own.
 *
 * Local-only. There are no accounts, so on a public deployment these buttons
 * would let any visitor start a ten-minute ingest; `ENABLE_DATA_PAGE` gates
 * both this page and the routes behind it, and production runs the same jobs
 * from Cloud Scheduler instead. The page is kept rather than deleted because
 * it is still the fastest way to bring a stale database current by hand.
 */
export default async function DataPage() {
  // Opts this page into dynamic rendering, which is what makes the flag a
  // deployment setting rather than a build artifact. Without it Next
  // prerenders the page and freezes whatever the variable was during the
  // build, so turning maintenance on would need a redeploy to take effect.
  await connection()
  if (!isDataPageEnabled()) notFound()

  return (
    <>
      <p className="border-b border-border bg-card px-6 py-4 text-sm leading-relaxed text-muted-foreground lg:px-10">
        Extract and load into the raw schema, then transform in the warehouse.
        The screener, the valuations, the signal and the frontier are all
        rebuilt from these rows by the refresh at the end.
      </p>
      <div className="grid gap-6 px-6 py-8 lg:grid-cols-2 lg:px-10">
        <RefreshAllCard />
        <BackfillCard
          title="Prices"
          description="Daily bars (split-adjusted and dividend-adjusted closes), dividends and splits for the S&P 500, the index, the 10-year yield and the 13-week T-bill. Each ticker fetches from its own newest stored date; a ticker with a new dividend or split is re-pulled in full, because Yahoo restates its whole adjusted history."
          endpoint="/api/backfill/prices"
          buttonLabel="Load prices"
          estimate="~25s incremental"
        />
        <BackfillCard
          title="Factor returns"
          description="Fama-French daily factors from the Ken French library — market, size, value, profitability, investment and momentum. Feed the CAPM betas, the market premium and the factor-adjusted backtest target."
          endpoint="/api/backfill/factor-returns"
          buttonLabel="Load factors"
          estimate="~20s"
        />
        <BackfillCard
          title="Fundamentals"
          description="Annual and quarterly statements as long line items, share-count history, earnings dates with the analyst estimate, and company profiles. Upserted, never deleted, so history accumulates past the four years Yahoo returns."
          endpoint="/api/backfill/fundamentals"
          buttonLabel="Load fundamentals"
          estimate="~8 min"
        />
        <BackfillCard
          title="Warehouse refresh"
          description="Rebuilds every derived number in SQL — statements, betas, the reverse-DCF implied returns, the signal — archives the day, then re-solves the default frontier. Run this after any of the three above."
          endpoint="/api/backfill/refresh"
          buttonLabel="Refresh warehouse"
          estimate="~60s"
        />
      </div>
    </>
  )
}
