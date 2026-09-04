import { StockSearch } from "@/components/stock-search"
import { loadUniverse } from "@/lib/universe"

export const metadata = {
  title: "Analysis",
}

/**
 * The parent route is the search box and nothing else.
 *
 * It used to render AAPL's price history and statistics on arrival, which made
 * `/stocks` a page about a company nobody had asked about — and put the same
 * content at two URLs, one of which could not be linked to. Every stock now
 * lives at `/stocks/[ticker]`; this resolves a query and sends you there.
 */
export default async function StocksPage() {
  const { stocks } = await loadUniverse()

  return (
    <div className="border-b border-border bg-card px-6 py-4 lg:px-10">
      <StockSearch
        stocks={stocks.map(({ ticker, name }) => ({ ticker, name }))}
      />
    </div>
  )
}
