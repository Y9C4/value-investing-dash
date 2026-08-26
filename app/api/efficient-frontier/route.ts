const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export const maxDuration = 300

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
  const { searchParams } = new URL(request.url)
  const shortAllowed = searchParams.get("short_allowed") === "true"
  const nPortfolios = searchParams.get("n_portfolios")

  // A screened subset, or the full index when omitted. It arrives in the body
  // because ~500 tickers make a ~3KB URL, and a URL is a header: past ~13KB of
  // cookies the server answered 431 before reaching anything. The query form
  // still works for hand-built calls, which carry no cookies.
  const tickers = (await readBodyTickers(request)) ?? searchParams.get("tickers")

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

  return Response.json(body, { status: upstream.status })
}
