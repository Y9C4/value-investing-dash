import { MARKET_DATA_API_URL, originHeaders } from "@/lib/market-data-service"
import { DEFAULT_PORTFOLIOS } from "@/lib/portfolio-settings"
import { checkRateLimit, clientKey } from "@/lib/rate-limit"
import { selectRows } from "@/lib/supabase"

export const maxDuration = 300

/**
 * The row `frontier.precompute_default()` writes under a fixed key.
 *
 * A solve is real convex optimisation and cannot move out of Python, so unlike
 * the screener and the stock pages this route cannot be made independent of
 * the solver in general. What it can do is stop needing the solver for the one
 * request that is both the most common and already answered: a bare visit to
 * /portfolio asks for the full index at default settings, which the nightly
 * backfill has already solved and stored.
 *
 * That path is now served straight from Postgres. The solver is still what
 * answers every screened set, every changed constraint and every rerun, which
 * is the right division: those are genuinely new work.
 */
const DEFAULT_SNAPSHOT_KEY = "default"

/** An hour: the snapshot is rewritten once a day by the scheduled backfill. */
const SNAPSHOT_REVALIDATE_SECONDS = 3600

/**
 * The ticker list from a JSON body, or null when there isn't one.
 *
 * Deliberately forgiving: no body, an empty body or non-JSON means a caller
 * using the query-string form, not an error.
 */
async function readBodyTickers(request: Request): Promise<string | null> {
  try {
    const body = await request.json()
    const tickers = (body as { tickers?: unknown })?.tickers
    if (!Array.isArray(tickers) || tickers.length === 0) return null
    return tickers.filter((t): t is string => typeof t === "string").join(",")
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  // Checked before the body is read, so a caller in a loop costs this function
  // nothing beyond the header parse. The solver's own two limits — the point
  // budget and the hourly compute budget — sit behind this one and are what
  // bound the damage a caller who evades it can do.
  const verdict = checkRateLimit(clientKey(request))
  if (!verdict.allowed) {
    return Response.json(
      { detail: verdict.detail },
      {
        status: 429,
        headers: { "Retry-After": String(verdict.retryAfterSeconds) },
      }
    )
  }

  const { searchParams } = new URL(request.url)
  const shortAllowed = searchParams.get("short_allowed") === "true"
  const nPortfolios = searchParams.get("n_portfolios")

  // A screened subset, or the full index when omitted. It arrives in the body
  // because ~500 tickers make a ~3KB URL, and a URL is a header: past ~13KB of
  // cookies the server answered 431 before reaching anything. The query form
  // still works for hand-built calls, which carry no cookies.
  const tickers = (await readBodyTickers(request)) ?? searchParams.get("tickers")

  // Every knob at its default and no ticker list is exactly what the stored
  // frontier was solved for. Anything else is a different question, and asking
  // Postgres for it would answer the wrong one confidently.
  const isDefaultRequest =
    !tickers &&
    !shortAllowed &&
    (nPortfolios === null || nPortfolios === String(DEFAULT_PORTFOLIOS)) &&
    ["min_weight", "max_weight"].every((key) => {
      const value = searchParams.get(key)
      return value === null || value === ""
    }) &&
    ["0", "", null].includes(searchParams.get("gamma"))

  if (isDefaultRequest) {
    const stored = await readDefaultSnapshot()
    if (stored) return Response.json(stored)
  }

  const query = new URLSearchParams({ short_allowed: String(shortAllowed) })
  if (nPortfolios) query.set("n_portfolios", nPortfolios)
  if (tickers) query.set("tickers", tickers)

  // Forwarded only when present: omitting a bound is how the caller asks the
  // solver to scale it to the universe, and "" or 0 would mean something else.
  // Not range-checked here — only the service knows how many stocks survived
  // the history filter.
  for (const key of ["min_weight", "max_weight", "gamma"] as const) {
    const value = searchParams.get(key)
    if (value !== null && value !== "") query.set(key, value)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${MARKET_DATA_API_URL}/efficient-frontier?${query}`, {
      method: "POST",
      // Proves the request came through this app rather than from something
      // pointed straight at the service URL, which the browser never sees.
      headers: originHeaders(),
      signal: AbortSignal.timeout(280_000),
    })
  } catch {
    return Response.json(
      { detail: "Market data service is unreachable" },
      { status: 502 }
    )
  }

  // Never assume the upstream body is JSON: a crash answers with plain text,
  // and parsing that turned a describable failure into an unhandled 500.
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

  // The solver sends `Retry-After` when its hourly compute budget is spent.
  // Dropping it would turn a "come back in twenty minutes" into a bare 429.
  const retryAfter = upstream.headers.get("retry-after")

  return Response.json(body, {
    status: upstream.status,
    headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
  })
}

/**
 * The precomputed default frontier, or null if there isn't one to serve.
 *
 * Null on every failure — unconfigured, unreachable, empty, a payload that is
 * not a frontier — because the caller's answer to all of them is the same:
 * ask the solver. A stored frontier is a fast path, never the only one.
 *
 * `cached` is rewritten rather than trusted. The stored payload was produced by
 * a scheduled run, where the solver records it as a miss because it did the
 * work; from here it is unambiguously a cache hit, and the page prints that
 * distinction.
 */
async function readDefaultSnapshot(): Promise<Record<string, unknown> | null> {
  const rows = await selectRows<{ payload: Record<string, unknown> }>(
    "frontier_snapshot",
    `select=payload&cache_key=eq.${DEFAULT_SNAPSHOT_KEY}&limit=1`,
    { revalidate: SNAPSHOT_REVALIDATE_SECONDS }
  )

  const payload = rows?.[0]?.payload
  if (!payload || typeof payload !== "object") return null
  if (!("max_sharpe" in payload) || !("envelope" in payload)) return null

  return {
    ...payload,
    n_portfolios_requested: payload.n_portfolios,
    resolution_capped: false,
    cached: true,
  }
}
