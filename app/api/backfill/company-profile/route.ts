import { proxyBackfill } from "@/lib/market-data-service"

export const maxDuration = 800

export async function POST() {
  return proxyBackfill("/backfill/company-profile", { timeoutMs: 780_000 })
}
