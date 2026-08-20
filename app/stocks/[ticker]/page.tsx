import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { StockDetail } from "@/components/stock-detail"
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

      <StockDetail stock={stock} />
    </>
  )
}
