import { TickerHistory } from "@/components/ticker-history"

export const metadata = {
  title: "Analysis — Margin",
}

export default function StocksPage() {
  return (
    <div className="px-6 py-8 lg:px-10">
      {/* Seeded so the page is never blank, the same reason the portfolio page
          ships a baseline frontier. Arriving here from the screener lands on
          `/stocks/[ticker]` instead, so nothing is being overridden. */}
      <TickerHistory initialTicker="AAPL" />
    </div>
  )
}
