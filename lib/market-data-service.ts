/**
 * The server-side edge between this app and the Python market-data service.
 *
 * The browser never holds the service URL: every call is made from a route
 * handler, which is what lets the service require a shared secret and treat
 * anything else as not coming from here. That only holds if every route does
 * it, so the proxying lives in one place rather than being restated per route.
 */

import { revalidateTag } from "next/cache"

import { VALUATIONS_CACHE_TAG } from "@/lib/universe"

export const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

/**
 * Whether the maintenance surface is reachable at all.
 *
 * There are no accounts, so a public "Refresh everything" button is an open
 * invitation to spend ten minutes of CPU and a chunk of the Supabase egress
 * quota. Off by default: the deployed site 404s `/data` and every backfill
 * route, while `ENABLE_DATA_PAGE=true` in `.env.local` keeps the whole thing
 * working locally, where it is genuinely useful. The scheduled refreshes go
 * straight to the service from Cloud Scheduler and never pass through here.
 *
 * Read inside a function, not captured at module scope, so the value is the
 * deployment's rather than the build's.
 */
export function isDataPageEnabled(): boolean {
  return process.env.ENABLE_DATA_PAGE === "true"
}

/**
 * Headers proving a solve came through this app.
 *
 * Empty when the secret is unset, which is the local default and is why
 * `pnpm dev` needs no extra configuration.
 */
export function originHeaders(): Record<string, string> {
  const secret = process.env.MARGIN_ORIGIN_SECRET
  return secret ? { "X-Margin-Origin": secret } : {}
}

/**
 * Run one backfill stage on the service and refresh what it invalidated.
 *
 * Every stage shares this shape, including the two guards — the feature flag
 * and the bearer token. Repeating a security check across six route handlers
 * is how one of them ends up without it.
 */
export async function proxyBackfill(
  path: string,
  { timeoutMs }: { timeoutMs: number }
): Promise<Response> {
  if (!isDataPageEnabled()) {
    // 404, not 403: on the deployed site this route does not exist, and
    // saying "forbidden" would advertise that it does.
    return new Response(null, { status: 404 })
  }

  const token = process.env.BACKFILL_TOKEN

  let upstream: Response
  try {
    upstream = await fetch(`${MARKET_DATA_API_URL}${path}`, {
      method: "POST",
      headers: token ? { "X-Backfill-Token": token } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
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

  // A success here makes whatever the screener cached out of date. `expire: 0`
  // rather than the "max" profile, which serves stale content while refreshing
  // behind it — the first visit after a backfill would still show the old
  // numbers. (`updateTag` is idiomatic but only callable from Server Actions.)
  revalidateTag(VALUATIONS_CACHE_TAG, { expire: 0 })

  return Response.json(body)
}
