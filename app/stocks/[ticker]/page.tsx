import { notFound } from "next/navigation"

import { StockDetail } from "@/components/stock-detail"
import { formatMarketCap, formatSharePrice } from "@/lib/format"
import { rankUniverse } from "@/lib/screen"
import { ratioContext } from "@/lib/sectors"
import { SIGNAL_BAND_LABELS, formatScore, signalBand } from "@/lib/signals"
import { loadUniverse } from "@/lib/universe"
import { impliedAndRequired, valuationBand, type ValuationBand } from "@/lib/valuation"

const QUINTILE: Record<ValuationBand, string> = {
  "deep-value": "value quintile 5, the cheapest 20% of the index",
  undervalued: "value quintile 4",
  fair: "value quintile 3, the middle of the index",
  overvalued: "value quintile 2",
  expensive: "value quintile 1, the dearest 20% of the index",
  unrated: "no value quintile",
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export async function generateMetadata({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  return { title: decodeURIComponent(ticker).toUpperCase() }
}

export default async function StockPage({ params }: PageProps<"/stocks/[ticker]">) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase()

  const { stocks, isBaseline, riskFreeRate, marketReturn } = await loadUniverse()
  const stock = stocks.find((item) => item.ticker === symbol)

  if (!stock) notFound()

  // Ranked over the whole index at all four models, as the screener opens.
  const valueMomentum = rankUniverse(stocks, [], ["value", "momentum"])
  const momentumSurprise = rankUniverse(stocks, [], ["momentum", "surprise"])
  const valueRank = valueMomentum.value.get(stock.ticker) ?? null
  const score = valueMomentum.score.get(stock.ticker) ?? null
  const rates = impliedAndRequired(stock)

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

      {/* The verdict first, in words; every panel below is its evidence. */}
      <header className="flex flex-col gap-2 border-b border-border px-6 py-5 lg:px-10">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="font-heading text-2xl">{stock.name}</h2>
          <span className="font-mono text-sm text-muted-foreground">
            {stock.ticker} · {formatSharePrice(stock.price)}
            {stock.marketCap !== null && ` · ${formatMarketCap(stock.marketCap)}`}
          </span>
          <span className="text-sm text-muted-foreground">{stock.sector}</span>
        </div>
        <p className="max-w-3xl text-base leading-relaxed">
          {rates === null ? (
            <>
              None of the four reverse-DCF models solves for {stock.ticker} at
              this price, so it has no value rank.
            </>
          ) : (
            <>
              At {formatSharePrice(stock.price)}, the price implies a return
              of {pct(rates.implied)} a year; {stock.ticker}&rsquo;s risk
              requires {pct(rates.required)}. That places it in{" "}
              {QUINTILE[valuationBand(valueRank)]}
              {score !== null && (
                <>
                  , with a value + momentum composite of {formatScore(score)} of
                  100 ({SIGNAL_BAND_LABELS[signalBand(score)]})
                </>
              )}
              .
            </>
          )}
        </p>
      </header>

      <StockDetail
        stock={stock}
        riskFreeRate={riskFreeRate}
        marketReturn={marketReturn}
        valueRank={valueRank}
        ratios={ratioContext(stocks, stock)}
        blends={[
          { label: "Value + momentum composite", score },
          { label: "Momentum + earnings surprise composite", score: momentumSurprise.score.get(stock.ticker) ?? null },
        ]}
      />
    </>
  )
}
