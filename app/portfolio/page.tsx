import { EfficientFrontier } from "@/components/efficient-frontier"
import { PageHeader } from "@/components/page-header"

export const metadata = {
  title: "Portfolio — Margin",
}

/**
 * Receives the screened set from the screener as `?tickers=AAPL,MSFT,…`. The
 * handoff is a URL rather than client state on purpose: a scoped optimisation
 * stays shareable and survives a reload.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ tickers?: string }>
}) {
  const { tickers } = await searchParams

  const screened = (tickers ?? "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean)

  return (
    <>
      <PageHeader
        eyebrow="Step three"
        title="Portfolio builder"
        description={
          screened.length > 0
            ? "Convex optimisation over the stocks that cleared the screen. Because the optimiser can only choose from names that passed a value filter, it cannot chase a stock whose Sharpe ratio looks good purely because it has already run up."
            : "Convex optimisation over the screened universe, with Ledoit-Wolf shrinkage on the covariance matrix and a risk-free rate taken from the annualised US 13-week treasury. Screen first to optimise over a filtered set instead of the whole index."
        }
      />
      <div className="px-6 py-8 lg:px-10">
        <EfficientFrontier tickers={screened} />
      </div>
    </>
  )
}
