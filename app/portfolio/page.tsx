import { PortfolioBuilder } from "@/components/portfolio-builder"
import { PageHeader } from "@/components/page-header"
import { decodeTickerSet } from "@/lib/ticker-set"

export const metadata = {
  title: "Portfolio — Margin",
}

/**
 * Receives the screened set from the screener as `?set=<token>`. The handoff is
 * a URL rather than client state on purpose: a scoped optimisation stays
 * shareable and survives a reload.
 *
 * The set is a fixed-size bitmask over the index rather than a list of names —
 * see `lib/ticker-set.ts` for why spelling out ~500 tickers made the page
 * unreachable. `?tickers=A,AAPL,…` is still honoured so older links and
 * hand-built URLs keep working; only the screener's own links use the token.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ tickers?: string; set?: string }>
}) {
  const { tickers, set } = await searchParams

  const decoded = set ? decodeTickerSet(set) : null

  const screened =
    decoded && !decoded.stale
      ? decoded.tickers
      : (tickers ?? "")
          .split(",")
          .map((ticker) => ticker.trim().toUpperCase())
          .filter(Boolean)

  // A token built against a different index decodes into a different portfolio,
  // so it is refused rather than approximated. Saying so beats silently
  // optimising the whole index under a link that promised a screen.
  const staleSet = decoded?.stale === true && screened.length === 0

  return (
    <>
      <PageHeader
        eyebrow="Step three"
        title="Portfolio builder"
        description={
          screened.length > 0
            ? "Convex optimisation over the stocks that cleared the screen. Because the optimiser can only choose from names that passed a value filter, it cannot chase a stock whose Sharpe ratio looks good purely because it has already run up."
            : staleSet
              ? "That link was built against a different version of the index, so the set it points at can no longer be read back exactly. Run the screen again to get a fresh link. Optimising below covers the full index."
              : "Convex optimisation over the screened universe, with Ledoit-Wolf shrinkage on the covariance matrix and a risk-free rate taken from the annualised US 13-week treasury. Position bounds, short selling and the L2 penalty are yours to set — every figure below is downstream of them. Screen first to optimise over a filtered set instead of the whole index."
        }
      />
      <div className="px-6 py-8 lg:px-10">
        <PortfolioBuilder tickers={screened} />
      </div>
    </>
  )
}
