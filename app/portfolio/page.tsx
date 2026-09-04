import { PageHeader } from "@/components/page-header"
import { PortfolioBuilder } from "@/components/portfolio-builder"
import { decodeTickerSet } from "@/lib/ticker-set"

export const metadata = {
  title: "Portfolio",
}

/**
 * Receives the screened set as `?set=<token>` — a URL rather than client
 * state, so a scoped optimisation stays shareable and survives a reload.
 *
 * The token is a bitmask over the index, not a list of names; see
 * `lib/ticker-set.ts`. `?tickers=A,AAPL,…` still works for hand-built URLs.
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
            ? `Mean-variance optimisation over the ${screened.length} stocks the screener handed across. The frontier is traced as one solved problem per point, not interpolated between two anchors.`
            : "Mean-variance optimisation over the full index. Screen first to optimise a set chosen on value rather than on price history alone."
        }
      />
      <div className="px-6 py-5 lg:px-10">
        <PortfolioBuilder tickers={screened} staleSet={staleSet} />
      </div>
    </>
  )
}
