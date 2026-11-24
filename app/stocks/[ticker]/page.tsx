import { notFound } from "next/navigation"

import { StockDetail } from "@/components/stock-detail"
import { StockSearch } from "@/components/stock-search"
import { rankUniverse } from "@/lib/screen"
import { loadUniverse } from "@/lib/universe"

export default async function StockPage({
  params,
}: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase()

  const { stocks, isBaseline, riskFreeRate, marketReturn } = await loadUniverse()
  const stock = stocks.find((item) => item.ticker === symbol)

  if (!stock) notFound()

  // Ranked over the whole index, as the screener ranks them, at all four models.
  const valueTrend = rankUniverse(stocks, [], ["value", "momentum"])
  const trendEarnings = rankUniverse(stocks, [], ["momentum", "surprise"])

  return (
    <>
      {/* The same strip as the parent route, in the same place, so moving
          between stocks never means going back to a different page first.
          Which company this is rides along on the right rather than in a
          header of its own: the ticker is already in the context strip above,
          and the name and sector are the only two facts a header was adding. */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-border bg-card/80 px-6 py-4 lg:px-10">
        <StockSearch
          stocks={stocks.map(({ ticker, name }) => ({ ticker, name }))}
          current={stock.ticker}
        />

        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="font-heading text-sm font-semibold tracking-wider uppercase">
            {stock.name}
          </span>
          <span className="text-xs text-muted-foreground">{stock.sector}</span>
        </div>
      </div>

      {/* The screener says which data it is showing; this page renders the same
          fallback and has to say so too. A dated snapshot is
          indistinguishable from a live one unless it is labelled. */}
      {isBaseline && (
        <p
          role="status"
          className="border-b border-border bg-card px-6 py-3 text-xs text-muted-foreground lg:px-10"
        >
          Illustrative sample — the database is unreachable. These figures are
          a fixed snapshot, not current market data.
        </p>
      )}

      <StockDetail
        stock={stock}
        riskFreeRate={riskFreeRate}
        marketReturn={marketReturn}
        valueRank={valueTrend.value.get(stock.ticker) ?? null}
        blends={[
          { label: "Value + trend", score: valueTrend.score.get(stock.ticker) ?? null },
          { label: "Trend + earnings", score: trendEarnings.score.get(stock.ticker) ?? null },
        ]}
      />
    </>
  )
}
