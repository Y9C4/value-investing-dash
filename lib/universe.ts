import { SAMPLE_UNIVERSE } from "@/lib/sample-universe"
import { selectSnapshotRow } from "@/lib/supabase"
import { VALUATION_METHODS, type MethodId, type Stock } from "@/lib/valuation"

/**
 * Loads the scored universe for the screener and the stock pages.
 *
 * Three sources, tried in order, and the ordering is the point.
 *
 * The normal path is `universe_snapshot`: one indexed row of Postgres holding
 * the payload the valuations backfill already assembled. Assembling it costs
 * five full-table reads and most of a minute, and it changes once a day, so
 * the front end reading it straight from the warehouse is not a cache — it is
 * where that payload belongs. The consequence is worth stating: the screener
 * and every stock page render with the solver scaled to zero. Only the
 * optimiser needs a running Python service, which is the one surface that is
 * genuinely CPU-bound.
 *
 * `GET /valuations` is the fallback for a snapshot that has not been written
 * yet, and `SAMPLE_UNIVERSE` is the last resort — an illustrative screen beats
 * an empty one, provided it is labelled, which every surface that renders it
 * does.
 */

const MARKET_DATA_API_URL =
  process.env.MARKET_DATA_API_URL ?? "http://127.0.0.1:8000"

// The screener is a browsing surface over data that refreshes daily, so an
// hour-stale render is fine and saves a round trip per visitor.
// An hour in production, where the snapshot changes once a day and the cost of
// a stale read is one revalidation window. Zero in development, where an
// hour-long window means a backfill you just ran is invisible until it expires
// — there is no purge path for a snapshot written by Cloud Scheduler calling
// the service directly, with no Next in the chain to call `revalidateTag`.
const REVALIDATE_SECONDS = process.env.NODE_ENV === "development" ? 0 : 3600

/** Cache tag for the scored universe; see `revalidateValuations`. */
export const VALUATIONS_CACHE_TAG = "valuations"

type ValuationsResponse = {
  computed_at: string | null
  count: number
  risk_free_rate?: number | null
  /** Absent on any snapshot written before 2026-09-05. */
  expected_market_return?: number | null
  index?: IndexLevel | null
  data_freshness?: Record<string, JobRun> | null
  stocks: Stock[]
}

/** One recorded run of a scheduled ingest stage, from `job_runs`. */
export type JobRun = {
  /** `partial` is a run that lost some tickers and refreshed the rest. */
  status: "succeeded" | "partial" | "failed"
  finishedAt: string
  durationSeconds: number | null
  rowsUpserted: number | null
}

/**
 * The stages the freshness readout lists, in the order it lists them.
 *
 * Ordered by how much a reader cares that it is current: prices move every
 * session, statements once a quarter, and the valuations at the end are a
 * computation over the three above rather than a fetch of anything.
 */
export const DATA_SOURCES = [
  { job: "daily_close_prices", label: "Prices", ingest: true },
  { job: "quarterly_fundamentals", label: "Fundamentals", ingest: true },
  { job: "company_profile", label: "Profiles", ingest: true },
  { job: "factor_returns", label: "Factors", ingest: true },
  { job: "valuations", label: "Valuations", ingest: false },
] as const

/** Where the benchmark closed, for the market context bar. */
export type IndexLevel = {
  ticker: string
  date: string
  close: number
  /** One-session change, or null when only one session is stored. */
  change: number | null
}

/** Past this, the valuations are old enough for the context bar to say so. */
const STALE_AFTER_HOURS = 48

export type Universe = {
  stocks: Stock[]
  /** False when the live service answered; true when the sample is standing in. */
  isBaseline: boolean
  /** When the live valuations were computed, if known. */
  computedAt: string | null
  /** The last recorded run of each ingest stage. Empty before the first run. */
  freshness: Record<string, JobRun>
  /**
   * When data was last *fetched*, as opposed to last computed over.
   *
   * These are different claims and only one of them is what a reader wants.
   * The models recompute in seconds over whatever the feeder tables hold, so a
   * valuations pass on a fortnight-old price table stamps itself fresh and is
   * not. Null until the first scheduled run is recorded, where every consumer
   * falls back to `computedAt`.
   */
  gatheredAt: string | null
  /** The annualised 13-week treasury rate every model discounted at. */
  riskFreeRate: number | null
  /**
   * The index's own annualised log return over the same 252-day window.
   *
   * Null on the sample, and on any snapshot written before this field existed:
   * the stock page prints the placeholder rather than a zero, because a market
   * return of zero is a claim and an absent one is not.
   */
  marketReturn: number | null
  /** Null on the sample, and whenever the index read failed. */
  index: IndexLevel | null
  /**
   * Whether the data is older than the refresh it is supposed to get every
   * weekday. Measured against `gatheredAt` where there is one, so stale inputs
   * under a fresh recompute are caught rather than papered over.
   *
   * Decided here rather than in the component that renders it: reading the
   * clock during a render is impure, and a statically rendered page would
   * freeze the comparison at build time and then insist forever that the data
   * was fresh. As a property of the load it is re-evaluated whenever the page
   * is — at worst one revalidation window behind, against a 48-hour threshold.
   */
  isStale: boolean
}

// Derived from the method registry rather than restated. A hand-maintained
// copy of this list is what let `capm`, `ff3`, `graham` and `epv` linger here
// after they stopped being modelled.
const METHOD_IDS: string[] = VALUATION_METHODS.map((method) => method.id)

/**
 * Drops anything the API sent that this build does not model.
 *
 * Load-bearing across a model change: `valuations` rows for a retired method
 * survive in the database until the next backfill, and this is what keeps them
 * from reaching the consensus in the meantime.
 */
function isKnownMethod(method: string): method is MethodId {
  return METHOD_IDS.includes(method)
}

function isStale(asOf: string | null | undefined): boolean {
  if (!asOf) return false
  const at = new Date(asOf).getTime()
  return Number.isFinite(at) && Date.now() - at > STALE_AFTER_HOURS * 3_600_000
}

/**
 * The newest of the stages that actually fetch something.
 *
 * Valuations are excluded on purpose: they are a solve over the tables the
 * other stages fill, so letting them set this would answer "when was data
 * gathered" with the timestamp of the one job that gathered none.
 */
function newestIngest(freshness: Record<string, JobRun>): string | null {
  const stamps = DATA_SOURCES.filter((source) => source.ingest)
    .map((source) => freshness[source.job]?.finishedAt)
    .filter((stamp): stamp is string => Boolean(stamp))

  if (stamps.length === 0) return null
  return stamps.reduce((newest, stamp) => (stamp > newest ? stamp : newest))
}

function normalise(stock: Stock): Stock {
  return {
    ...stock,
    verdicts: (stock.verdicts ?? []).filter((verdict) =>
      isKnownMethod(verdict.method)
    ),
  }
}

/** Shape the response into a `Universe`, or null if there is nothing usable. */
function toUniverse(body: ValuationsResponse | null | undefined): Universe | null {
  if (!body?.stocks || body.stocks.length === 0) return null

  const freshness = body.data_freshness ?? {}
  const gatheredAt = newestIngest(freshness)

  return {
    stocks: body.stocks.map(normalise),
    isBaseline: false,
    computedAt: body.computed_at,
    freshness,
    gatheredAt,
    riskFreeRate: body.risk_free_rate ?? null,
    marketReturn: body.expected_market_return ?? null,
    index: body.index ?? null,
    isStale: isStale(gatheredAt ?? body.computed_at),
  }
}

/** The warehouse row the valuations backfill writes. */
async function fromSnapshot(): Promise<Universe | null> {
  const row = await selectSnapshotRow<{
    payload: ValuationsResponse
    computed_at: string | null
  }>("universe_snapshot", "id=eq.1&select=payload,computed_at", {
    revalidate: REVALIDATE_SECONDS,
    tags: [VALUATIONS_CACHE_TAG],
  })

  const universe = toUniverse(row?.payload)
  if (!universe) return null

  // `payload.computed_at` is when the verdicts were computed; the row's own
  // stamp is when they were published. The first is what the page is claiming
  // about, so it wins.
  const computedAt = universe.computedAt ?? row?.computed_at ?? null
  return {
    ...universe,
    computedAt,
    isStale: isStale(universe.gatheredAt ?? computedAt),
  }
}

/** The solver's own endpoint — correct, but it pays the assembly cost again. */
async function fromService(): Promise<Universe | null> {
  try {
    const response = await fetch(`${MARKET_DATA_API_URL}/valuations`, {
      // Tagged so a backfill can purge this entry the moment it finishes.
      // Without that, fresh numbers sit invisible behind the hour-long window.
      next: { revalidate: REVALIDATE_SECONDS, tags: [VALUATIONS_CACHE_TAG] },
    })

    if (!response.ok) return null

    return toUniverse((await response.json()) as ValuationsResponse)
  } catch {
    return null
  }
}

export async function loadUniverse(): Promise<Universe> {
  return (
    (await fromSnapshot()) ??
    (await fromService()) ?? {
      stocks: SAMPLE_UNIVERSE,
      isBaseline: true,
      computedAt: null,
      freshness: {},
      gatheredAt: null,
      riskFreeRate: null,
      marketReturn: null,
      index: null,
      isStale: false,
    }
  )
}
