import { SAMPLE_UNIVERSE } from "@/lib/sample-universe"
import type { MethodId, Stock } from "@/lib/valuation"

/**
 * Loads the scored universe for the screener and the stock pages.
 *
 * The live data comes from `GET /valuations`, which reads a precomputed table
 * rather than valuing on demand — the models cost ~0.1s for the whole index
 * while the reads that feed them cost ~70s, so recomputing per request would
 * pay a fixed toll for data that only changes once a day.
 *
 * When the service is unreachable the baseline sample is served instead, the
 * same way the portfolio page falls back to `BASELINE_FRONTIER`: an
 * illustrative screen beats an empty one, provided it is labelled.
 */

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

// The screener is a browsing surface over data that refreshes daily, so an
// hour-stale render is fine and saves a round trip per visitor.
const REVALIDATE_SECONDS = 3600

/** Cache tag for the scored universe; see `revalidateValuations`. */
export const VALUATIONS_CACHE_TAG = "valuations"

type ValuationsResponse = {
  computed_at: string | null
  count: number
  stocks: Stock[]
}

export type Universe = {
  stocks: Stock[]
  /** False when the live service answered; true when the sample is standing in. */
  isBaseline: boolean
  /** When the live valuations were computed, if known. */
  computedAt: string | null
}

const METHOD_IDS: MethodId[] = [
  "capm",
  "ff3",
  "ff5",
  "ddm",
  "fcfe",
  "fcff",
  "graham",
  "epv",
  "rim",
]

/** Drops anything the API sent that this build does not model. */
function isKnownMethod(method: string): method is MethodId {
  return (METHOD_IDS as string[]).includes(method)
}

function normalise(stock: Stock): Stock {
  return {
    ...stock,
    verdicts: (stock.verdicts ?? []).filter((verdict) =>
      isKnownMethod(verdict.method)
    ),
  }
}

export async function loadUniverse(): Promise<Universe> {
  try {
    const response = await fetch(`${MARKET_DATA_API_URL}/valuations`, {
      // Tagged so a backfill can purge this entry the moment it finishes.
      // Without that, fresh numbers sit invisible behind the hour-long window.
      next: { revalidate: REVALIDATE_SECONDS, tags: [VALUATIONS_CACHE_TAG] },
    })

    if (!response.ok) {
      return { stocks: SAMPLE_UNIVERSE, isBaseline: true, computedAt: null }
    }

    const body = (await response.json()) as ValuationsResponse

    if (!body.stocks || body.stocks.length === 0) {
      return { stocks: SAMPLE_UNIVERSE, isBaseline: true, computedAt: null }
    }

    return {
      stocks: body.stocks.map(normalise),
      isBaseline: false,
      computedAt: body.computed_at,
    }
  } catch {
    return { stocks: SAMPLE_UNIVERSE, isBaseline: true, computedAt: null }
  }
}
