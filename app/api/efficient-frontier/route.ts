const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export const maxDuration = 300

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const shortAllowed = searchParams.get("short_allowed") === "true"
  const nPortfolios = searchParams.get("n_portfolios")

  // A screened subset from the screener. Omitted means the full index.
  const tickers = searchParams.get("tickers")

  const query = new URLSearchParams({ short_allowed: String(shortAllowed) })
  if (nPortfolios) {
    query.set("n_portfolios", nPortfolios)
  }
  if (tickers) {
    query.set("tickers", tickers)
  }

  let upstream: Response
  try {
    upstream = await fetch(
      `${MARKET_DATA_API_URL}/efficient-frontier?${query}`,
      { method: "POST", signal: AbortSignal.timeout(280_000) }
    )
  } catch {
    return Response.json(
      { detail: "Market data service is unreachable" },
      { status: 502 }
    )
  }

  // Never assume the upstream body is JSON. A crash in the market-data service
  // answers with plain text, and parsing that threw here — turning a solve that
  // failed for a describable reason into an unhandled 500 and a dead page.
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
