import { PageHeader } from "@/components/page-header"
import { TickerHistory } from "@/components/ticker-history"

export const metadata = {
  title: "Analysis — Margin",
}

export default function StocksPage() {
  return (
    <>
      <PageHeader
        eyebrow="Step two"
        title="Stock analysis"
        description="Pull the price history and CAPM statistics for any ticker. Reach a company from the screener to see every model's verdict alongside it."
      />
      <div className="px-6 py-8 lg:px-10">
        <TickerHistory />
      </div>
    </>
  )
}
