import { MARKET_DATA_API_URL } from "@/lib/market-data-service"
import { readStoredCloses } from "@/lib/closes"

/**
 * Stored daily closes for one ticker.
 *
 * **Supabase first, the solver second**, which is the point of this route. It
 * used to proxy `GET /returns/{ticker}` unconditionally, so `/stocks/[ticker]`
 * could not draw its chart unless the Python service was awake. On Cloud Run
 * that service scales to zero, so every first visit of the day would have shown
 * a broken panel for as long as a container took to start — while the closes
 * being asked for sat in Postgres the whole time, already read directly by the
 * screener on the same page load.
 *
 * The response carries closes and nothing else. Everything else the panel used
 * to take from `/returns` — beta, the realised return, the risk-free rate — is
 * already precomputed and already on the page: `public.screener` feeds
 * `Stock.beta` and `Stock.realisedReturn` through the universe snapshot, and
 * the two scalars ride on the snapshot's own payload. Fetching them a second
 * time here would have been the same numbers by a longer road, and the two
 * copies could disagree.
 *
 * The service fallback stays for the case the snapshot path cannot cover: no
 * Supabase credentials, or a database reachable by the solver and not by this
 * app. It costs nothing when the first path works.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/close-history/[ticker]">
) {
  const { ticker } = await ctx.params
  const symbol = ticker.toUpperCase()

  const fromWarehouse = await readStoredCloses(symbol)
  if (fromWarehouse && fromWarehouse.length > 0) {
    return Response.json({ ticker: symbol, candles: fromWarehouse })
  }

  return readFromService(symbol)
}

/** The original path, kept as the fallback rather than the default. */
async function readFromService(symbol: string): Promise<Response> {
  let upstream: Response
  try {
    upstream = await fetch(
      `${MARKET_DATA_API_URL}/returns/${encodeURIComponent(symbol)}`
    )
  } catch {
    return Response.json(
      { detail: "No stored prices for this ticker, and the market data service is unreachable." },
      { status: 502 }
    )
  }

  // The service answers JSON, but a proxy or crash page in front of it may not.
  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || body === null) {
    return Response.json(
      { detail: body?.detail ?? "The market data service returned an unreadable response." },
      { status: upstream.ok ? 502 : upstream.status }
    )
  }

  const candles = Array.isArray(body?.candles)
    ? (body.candles as { date: string; close: number }[]).map(
        ({ date, close }) => ({ date, close })
      )
    : []

  return Response.json({ ticker: symbol, candles })
}
