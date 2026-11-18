import { proxyBackfill } from "@/lib/market-data-service"

export const maxDuration = 300

export async function POST() {
  return proxyBackfill("/backfill/prices", { timeoutMs: 280_000 })
}
