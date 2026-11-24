import { notFound } from "next/navigation"

import { StockDetail } from "@/components/stock-detail"
import { StockVerdict } from "@/components/stock-verdict"
import { readStoredCloses } from "@/lib/closes"
import { rankUniverse } from "@/lib/screen"
import { ratioContext } from "@/lib/sectors"
import { loadUniverse } from "@/lib/universe"

/**
 * Rendered on first visit, then cached and revalidated with the universe it
 * reads (incremental static regeneration). The empty list is what opts a
 * dynamic segment into runtime ISR rather than a render per request.
 */
export function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  return { title: decodeURIComponent(ticker).toUpperCase() }
}

export default async function StockPage({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase()

  const [{ stocks, isBaseline, riskFreeRate, marketReturn }, closes] = await Promise.all([
    loadUniverse(),
    readStoredCloses(symbol).catch(() => null),
  ])
  const stock = stocks.find((item) => item.ticker === symbol)

  if (!stock) notFound()

  // Ranked over the whole index at all four models, as the screener opens.
  const valueMomentum = rankUniverse(stocks, [], ["value", "momentum"])
  const momentumSurprise = rankUniverse(stocks, [], ["momentum", "surprise"])
  const valueRank = valueMomentum.value.get(stock.ticker) ?? null
  const score = valueMomentum.score.get(stock.ticker) ?? null

  return (
    <>
      {isBaseline && (
        <p
          role="status"
          className="border-b border-border bg-card px-6 py-3 text-xs text-muted-foreground lg:px-10"
        >
          Illustrative sample — the database is not configured. These figures
          are a fixed snapshot, not current market data.
        </p>
      )}

      {/* The verdict first; every panel below is its evidence. */}
      <StockVerdict stock={stock} stocks={stocks} valueRank={valueRank} composite={score} />

      <StockDetail
        stock={stock}
        riskFreeRate={riskFreeRate}
        marketReturn={marketReturn}
        valueRank={valueRank}
        ratios={ratioContext(stocks, stock)}
        closes={closes}
        blends={[
          { label: "Value + momentum composite", score },
          { label: "Momentum + earnings surprise composite", score: momentumSurprise.score.get(stock.ticker) ?? null },
        ]}
      />
    </>
  )
}
