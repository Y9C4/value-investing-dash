import { revalidateTag } from "next/cache"

import { VALUATIONS_CACHE_TAG } from "@/lib/universe"

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export const maxDuration = 800

export async function POST() {
  let upstream: Response
  try {
    upstream = await fetch(
      `${MARKET_DATA_API_URL}/backfill/quarterly-fundamentals`,
      // ~500 tickers at 8 workers measured ~8 minutes end to end, which is
      // well past the 280s the other backfills use.
      { method: "POST", signal: AbortSignal.timeout(780_000) }
    )
  } catch {
    return Response.json(
      { detail: "Market data service is unreachable" },
      { status: 502 }
    )
  }

  const body = await upstream.json()

  if (!upstream.ok) {
    return Response.json(body, { status: upstream.status })
  }

  // Every stage feeds the scored universe, so a success here makes whatever
  // the screener has cached out of date. Purge it now rather than leaving the
  // new numbers invisible until the revalidate window lapses.
  // `expire: 0` rather than the "max" profile: that one serves stale content
  // while refreshing behind it, so the first visit after a backfill would still
  // show the old numbers — the opposite of what someone who just pressed the
  // button expects. (`updateTag` would be the idiomatic choice, but it is only
  // callable from Server Actions, not a Route Handler.)
  revalidateTag(VALUATIONS_CACHE_TAG, { expire: 0 })

  return Response.json(body)
}
