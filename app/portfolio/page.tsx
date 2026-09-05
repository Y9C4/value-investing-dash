import { PortfolioBuilder } from "@/components/portfolio-builder"
import { decodeTickerSet } from "@/lib/ticker-set"
import { loadUniverse } from "@/lib/universe"

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

  // The same read the screener does, for the same cached snapshot. The
  // frontier service knows what a portfolio holds and nothing about what those
  // holdings are worth, so the valuations have to be joined in here — this is
  // the only page that needs both, and neither costs a solve.
  const { stocks } = await loadUniverse()

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
    <div className="px-6 py-5 lg:px-10">
      <PortfolioBuilder
        tickers={screened}
        staleSet={staleSet}
        stocks={stocks}
      />
    </div>
  )
}
