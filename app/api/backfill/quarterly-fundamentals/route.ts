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

  return Response.json(body)
}
