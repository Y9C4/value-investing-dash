const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

export const maxDuration = 300

export async function POST() {
  let upstream: Response
  try {
    upstream = await fetch(`${MARKET_DATA_API_URL}/backfill/valuations`, {
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

  return Response.json(body)
}
