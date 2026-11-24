import { selectRows } from "@/lib/supabase"
import { VALUATIONS_CACHE_TAG } from "@/lib/universe"

/**
 * How many trading days the chart draws. Matches `RETURNS_LOOKBACK_DAYS` in
 * `python-api/market.py`, so both sources answer over the same window.
 */
const LOOKBACK_DAYS = 252

/** An hour, matching the screener's revalidation: both read the same closes. */
const REVALIDATE_SECONDS = 3600

export type Candle = { date: string; close: number }

/**
 * The closes as PostgREST returns them: newest first, then reversed.
 *
 * Ordered descending with a limit rather than ascending, because "the last 252
 * rows" is only expressible from the newest end. The reversal afterwards is
 * what the chart wants, and 252 numbers cost nothing to turn around.
 */
export async function readStoredCloses(symbol: string): Promise<Candle[] | null> {
  const rows = await selectRows<{ date: string; close: number | string }>(
    "stock_prices",
    `select=date,close&ticker=eq.${encodeURIComponent(symbol)}` +
      `&order=date.desc&limit=${LOOKBACK_DAYS}`,
    { revalidate: REVALIDATE_SECONDS, tags: [VALUATIONS_CACHE_TAG] }
  )

  if (!rows) return null

  return rows
    .map((row) => ({ date: row.date, close: Number(row.close) }))
    .filter((candle) => Number.isFinite(candle.close))
    .reverse()
}

