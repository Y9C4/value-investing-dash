import { readStoredCloses } from "@/lib/closes"

/**
 * Stored daily closes for one ticker, read straight from Supabase.
 *
 * Supabase only, with no fallback to the Python service. That service scales to
 * zero and is publicly reachable, so a fallback made every unknown ticker
 * (`/api/close-history/ZZZ1`, `ZZZ2`, …) wake it and cost a database read.
 * Both copies of the data come from the same Postgres, so the fallback only
 * ever covered "this app cannot reach the database but the service can".
 *
 * The response carries closes and nothing else: beta, the realised return and
 * the risk-free rate are already on the page through the universe snapshot.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/close-history/[ticker]">
) {
  const { ticker } = await ctx.params
  const symbol = ticker.toUpperCase()

  const candles = await readStoredCloses(symbol)
  if (!candles || candles.length === 0) {
    return Response.json(
      { detail: `No stored prices for ${symbol}.` },
      { status: 404 }
    )
  }

  return Response.json({ ticker: symbol, candles })
}
