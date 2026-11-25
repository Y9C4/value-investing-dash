import { PortfolioBuilder } from "@/components/portfolio-builder"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import { selectSnapshotRow } from "@/lib/supabase"
import { decodeTickerSet } from "@/lib/ticker-set"
import { loadUniverse, VALUATIONS_CACHE_TAG } from "@/lib/universe"

export const metadata = {
  title: "Portfolio optimiser",
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

  // The scheduled default solve (`frontier.precompute_default`), so a bare
  // visit opens on today's frontier rather than the illustrative baseline.
  const row = await selectSnapshotRow<{ payload: FrontierResponse; computed_at: string }>(
    "frontier_snapshot",
    "select=payload,computed_at&cache_key=eq.default",
    { revalidate: process.env.NODE_ENV === "development" ? 0 : 3600, tags: [VALUATIONS_CACHE_TAG] }
  )
  const snapshot = row ? { data: row.payload, computedAt: row.computed_at } : null

  const decoded = set ? decodeTickerSet(set) : null

  const screened =
    decoded && !decoded.stale
      ? decoded.tickers
      : // String(): a repeated `?tickers=` arrives as an array.
        [...new Set(String(tickers ?? "")
          .split(",")
          .map((ticker) => ticker.trim().toUpperCase())
          .filter(Boolean))]

  // A hand-typed `?tickers=` can name anything. What the index does not hold is
  // listed back to the reader rather than dropped silently. With no universe
  // loaded there is nothing to check against, so nothing is called unknown.
  const index = new Set(stocks.map((stock) => stock.ticker))
  const unknown = index.size > 0 ? screened.filter((t) => !index.has(t)) : []
  const known = screened.filter((t) => !unknown.includes(t))

  // A token built against a different index decodes into a different portfolio,
  // so it is refused rather than approximated. Saying so beats silently
  // optimising the whole index under a link that promised a screen.
  const staleSet = decoded?.stale === true && screened.length === 0

  return (
    <div className="px-6 py-6 lg:px-10">
      <PortfolioBuilder
        // Keyed by scope: a client-side `?set=` / `?tickers=` change reuses this
        // page, and without a new key the previous scope's frontier stays up.
        key={[...screened].sort().join(",") || "index"}
        tickers={known}
        unknownTickers={unknown}
        staleSet={staleSet}
        // Only what the valuation reading needs: the full rows were ~700 KB.
        stocks={stocks.map(({ ticker, signals }) => ({
          ticker,
          signals: signals && {
            impliedReturns: signals.impliedReturns,
            requiredReturnEquity: signals.requiredReturnEquity,
            requiredReturnFirm: signals.requiredReturnFirm,
          },
        }))}
        snapshot={snapshot}
      />
    </div>
  )
}
