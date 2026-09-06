import { proxyBackfill } from "@/lib/market-data-service"

// ~500 tickers at 8 workers measured ~8 minutes end to end, which is well past
// the 280s the other backfills use — and past what Vercel Hobby allows. That is
// survivable only because this route is disabled in production: the scheduled
// refresh calls the service directly, with no serverless function in between.
export const maxDuration = 300

export async function POST() {
  return proxyBackfill("/backfill/quarterly-fundamentals", {
    timeoutMs: 780_000,
  })
}
