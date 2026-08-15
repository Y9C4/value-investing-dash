const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/close-history/[ticker]">
) {
  const { ticker } = await ctx.params

  let upstream: Response
  try {
    upstream = await fetch(
      `${MARKET_DATA_API_URL}/returns/${encodeURIComponent(ticker)}`
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

  return Response.json(body)
}
