import { proxyBackfill } from "@/lib/market-data-service"

// The one stage this wraps that is genuinely slow is the quarterly fundamentals
// fetch (~8 min on a cold run), and the whole point of this route is not having
// to babysit the stages individually — so it gets a window past what Vercel
// Hobby permits. Safe only because this route is disabled in production: the
// daily and weekly refreshes are Cloud Scheduler jobs calling the service
// directly, with no serverless function in the middle to time out.
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

  return proxyBackfill(`/backfill/all?${query}`, { timeoutMs: 780_000 })
}
