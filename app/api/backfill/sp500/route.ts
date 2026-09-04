import { proxyBackfill } from "@/lib/market-data-service"

export const maxDuration = 300

export async function POST() {
  return proxyBackfill("/backfill/sp500-daily-close", { timeoutMs: 280_000 })
}
