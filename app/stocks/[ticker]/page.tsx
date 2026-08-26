import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { StockDetail } from "@/components/stock-detail"
import { loadUniverse } from "@/lib/universe"

export default async function StockPage({
  params,
}: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase()

  const { stocks, isBaseline } = await loadUniverse()
  const stock = stocks.find((item) => item.ticker === symbol)

  if (!stock) notFound()

  return (
    <>
      {/* Title only. Which company this is, is information; a sentence
          describing the cards below it is not — they have their own titles. */}
      <PageHeader
        eyebrow={stock.sector}
        title={`${stock.ticker} · ${stock.name}`}
      />

      {/* The screener says which data it is showing; this page renders the same
          fallback and has to say so too. Fair values from the sample are
          invented, and a page of invented valuations is indistinguishable from
          a live one unless it is labelled. */}
      {isBaseline && (
        <p
          role="status"
          className="border-b border-border bg-card px-6 py-3 text-xs text-muted-foreground lg:px-10"
        >
          Illustrative sample — market data service unreachable. The fair values
          below are invented, not market data.
        </p>
      )}

      <StockDetail stock={stock} />
    </>
  )
}
