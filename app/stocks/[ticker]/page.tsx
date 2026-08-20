import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { TickerHistory } from "@/components/ticker-history"
import { ValuationBreakdown } from "@/components/valuation-breakdown"
import { loadUniverse } from "@/lib/universe"

export default async function StockPage({
  params,
}: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase()

  const { stocks } = await loadUniverse()
  const stock = stocks.find((item) => item.ticker === symbol)

  if (!stock) notFound()

  return (
    <>
      <PageHeader
        eyebrow={stock.sector}
        title={`${stock.ticker} · ${stock.name}`}
        description="Every model's view of what this company is worth, alongside the price history and the risk statistics the optimiser will use if you include it."
      />

      <div className="flex flex-col gap-6 px-6 py-8 lg:px-10">
        <ValuationBreakdown stock={stock} />
        <TickerHistory initialTicker={stock.ticker} />
      </div>
    </>
  )
}
