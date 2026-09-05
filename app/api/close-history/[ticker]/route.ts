import { selectRows } from "@/lib/supabase"

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

/**
 * How many trading days the chart draws. Matches `RETURNS_LOOKBACK_DAYS` in
 * `api/market.py`, so both sources answer over the same window.
 */
const LOOKBACK_DAYS = 252

/** An hour, matching the screener's revalidation: both read the same closes. */
const REVALIDATE_SECONDS = 3600

type Candle = { date: string; close: number }

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
 * already precomputed and already on the page: `ticker_statistics` feeds
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

/**
 * The closes as PostgREST returns them: newest first, then reversed.
 *
 * Ordered descending with a limit rather than ascending, because "the last 252
 * rows" is only expressible from the newest end. The reversal afterwards is
 * what the chart wants, and 252 numbers cost nothing to turn around.
 */
async function readStoredCloses(symbol: string): Promise<Candle[] | null> {
  const rows = await selectRows<{ date: string; close: number | string }>(
    "daily_close_prices",
    `select=date,close&ticker=eq.${encodeURIComponent(symbol)}` +
      `&order=date.desc&limit=${LOOKBACK_DAYS}`,
    { revalidate: REVALIDATE_SECONDS }
  )

  if (!rows) return null

  return rows
    .map((row) => ({ date: row.date, close: Number(row.close) }))
    .filter((candle) => Number.isFinite(candle.close))
    .reverse()
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

  const body = await upstream.json()
  if (!upstream.ok) return Response.json(body, { status: upstream.status })

  const candles = Array.isArray(body?.candles)
    ? (body.candles as { date: string; close: number }[]).map(
        ({ date, close }) => ({ date, close })
      )
    : []

  return Response.json({ ticker: symbol, candles })
}
