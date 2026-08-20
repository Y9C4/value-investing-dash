import { BackfillCard } from "@/components/backfill-card"
import { PageHeader } from "@/components/page-header"

export const metadata = {
  title: "Data — Margin",
}

/**
 * The stages run top to bottom: valuations read the three tables above them,
 * so a full cold start works down the page. Each stage is incremental — it
 * asks what it already has and fetches only the gap — so a daily run costs a
 * fraction of a cold one, and a run after a five-day gap catches up on its own.
 */
export default function DataPage() {
  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Data"
        description="Everything downstream — the screener, the valuations, the frontier — reads from these tables. Each stage only fetches what it is missing, so a daily refresh is cheap and a cold start is the expensive one."
      />
      <div className="grid gap-6 px-6 py-8 lg:grid-cols-2 lg:px-10">
        <BackfillCard
          title="Daily close prices"
          description="Closes for the S&P 500 plus the index and the 13-week T-bill. Fetches only the span since the newest stored date; a cold table pulls two years so a full 252-trading-day window is always available."
          endpoint="/api/backfill/sp500"
          buttonLabel="Backfill prices"
          estimate="~25s incremental"
        />
        <BackfillCard
          title="Factor returns"
          description="Fama-French daily factors from the Ken French library — market, size, value, profitability, investment and momentum. Feeds FF3, FF5 and the cost of equity every cash-flow model discounts at."
          endpoint="/api/backfill/factor-returns"
          buttonLabel="Backfill factors"
          estimate="~20s"
        />
        <BackfillCard
          title="Quarterly fundamentals"
          description="Income statement, balance sheet, cash flow, company profile and dividend history. Stored at quarterly grain and rolled to trailing-twelve-month in SQL, never expanded into daily rows."
          endpoint="/api/backfill/quarterly-fundamentals"
          buttonLabel="Backfill fundamentals"
          estimate="~8 min"
        />
        <BackfillCard
          title="Valuations"
          description="Runs all nine models over every stock and replaces the valuations table. The models themselves take under a second; the time is the bulk read that feeds them. Run this after any of the three above."
          endpoint="/api/backfill/valuations"
          buttonLabel="Recompute valuations"
          estimate="~70s"
        />
      </div>
    </>
  )
}
