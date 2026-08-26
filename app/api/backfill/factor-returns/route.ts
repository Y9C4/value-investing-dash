import { revalidateTag } from "next/cache"

import { VALUATIONS_CACHE_TAG } from "@/lib/universe"

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export const maxDuration = 300

export async function POST() {
  let upstream: Response
  try {
    upstream = await fetch(`${MARKET_DATA_API_URL}/backfill/factor-returns`, {
      method: "POST",
      signal: AbortSignal.timeout(280_000),
    })
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

  // A success here makes whatever the screener cached out of date. `expire: 0`
  // rather than the "max" profile, which serves stale content while refreshing
  // behind it — the first visit after a backfill would still show the old
  // numbers. (`updateTag` is idiomatic but only callable from Server Actions.)
  revalidateTag(VALUATIONS_CACHE_TAG, { expire: 0 })

  return Response.json(body)
}
