import { revalidateTag } from "next/cache"

import { VALUATIONS_CACHE_TAG } from "@/lib/universe"

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

// The one stage this wraps that is genuinely slow is the quarterly fundamentals
// fetch (~8 min on a cold run), and the whole point of this route is not having
// to babysit the stages individually — so it gets the longest window the
// platform allows rather than the 300s the single-stage routes use.
export const maxDuration = 800

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = new URLSearchParams()
  // `full=true` re-pulls the entire price window instead of the gap since the
  // last run — the remedy after the index membership changes.
  if (searchParams.get("full") === "true") query.set("full", "true")
  // `skip_fundamentals=true` is the daily-refresh shape: statements change
  // quarterly, prices change every session.
  if (searchParams.get("skip_fundamentals") === "true") {
    query.set("skip_fundamentals", "true")
  }

  let upstream: Response
  try {
    upstream = await fetch(
      `${MARKET_DATA_API_URL}/backfill/all?${query}`,
      { method: "POST", signal: AbortSignal.timeout(780_000) }
    )
  } catch {
    return Response.json(
      { detail: "Market data service is unreachable" },
      { status: 502 }
    )
  }

  // A crash upstream answers in plain text, and parsing that unguarded turns a
  // described failure into an unhandled one.
  const raw = await upstream.text()
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return Response.json(
      {
        detail:
          raw.slice(0, 500) ||
          `Market data service returned ${upstream.status} with an empty body`,
      },
      { status: upstream.ok ? 502 : upstream.status }
    )
  }

  if (!upstream.ok) {
    return Response.json(body, { status: upstream.status })
  }

  // This run ends in a valuations recompute, so whatever the screener had
  // cached is now stale. See the sp500 route for why `expire: 0`.
  revalidateTag(VALUATIONS_CACHE_TAG, { expire: 0 })

  return Response.json(body)
}
