import { SAMPLE_UNIVERSE } from "@/lib/sample-universe"
import { selectRows } from "@/lib/supabase"
import {
  type DiscountRates,
  type Stock,
  type StockSignals,
} from "@/lib/valuation"

/**
 * Loads the scored universe for the screener and the stock pages.
 *
 * Straight from the warehouse's serving layer: `public.screener` (one row per
 * stock), `public.market_summary` (one row) and `public.latest_job_runs`. Every
 * number in them is computed in SQL by `warehouse.refresh()`, so the screener
 * and every stock page render with the Python service scaled to zero — only the
 * optimiser needs it.
 *
 * This replaced a single-row JSON snapshot the Python service assembled after
 * each run, and the `GET /valuations` fallback that assembled it again on
 * demand. Typed rows from a view need neither: the view is current with the
 * last refresh by construction. `SAMPLE_UNIVERSE` stays as the last resort — an
 * illustrative screen beats an empty one, provided it is labelled, which every
 * surface that renders it does.
 */

// An hour in production, where the warehouse refreshes once a day and the cost
// of a stale read is one revalidation window. Zero in development, where an
// hour-long window means a refresh you just ran is invisible until it expires —
// there is no purge path for a refresh run by Cloud Scheduler calling the
// service directly, with no Next in the chain to call `revalidateTag`.
const REVALIDATE_SECONDS = process.env.NODE_ENV === "development" ? 0 : 3600

/** Cache tag for the scored universe; see `proxyBackfill`. */
export const VALUATIONS_CACHE_TAG = "valuations"

/** One recorded run of a scheduled pipeline stage, from `job_runs`. */
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
 * session, statements once a quarter, and the refresh at the end is a
 * computation over the three above rather than a fetch of anything.
 */
export const DATA_SOURCES = [
  { job: "prices", label: "Prices", ingest: true },
  { job: "fundamentals", label: "Fundamentals", ingest: true },
  { job: "factor_returns", label: "Factors", ingest: true },
  { job: "refresh", label: "Warehouse refresh", ingest: false },
] as const

/** Where the benchmark closed, for the market context bar. */
export type IndexLevel = {
  ticker: string
  date: string
  close: number
  /** One-session change, or null when only one session is stored. */
  change: number | null
}

/** Past this, the data is old enough for the context bar to say so. */
const STALE_AFTER_HOURS = 48

export type Universe = {
  stocks: Stock[]
  /** False when the warehouse answered; true when the sample is standing in. */
  isBaseline: boolean
  /** When the numbers were last computed: the last warehouse refresh. */
  computedAt: string | null
  /** The last recorded run of each pipeline stage. Empty before the first run. */
  freshness: Record<string, JobRun>
  /**
   * When data was last *fetched*, as opposed to last computed over.
   *
   * These are different claims and only one of them is what a reader wants.
   * The warehouse refreshes in seconds over whatever the raw tables hold, so a
   * refresh over a fortnight-old price table stamps itself fresh and is not.
   * Null until the first scheduled run is recorded, where every consumer falls
   * back to `computedAt`.
   */
  gatheredAt: string | null
  /**
   * The 13-week T-bill, 252-day average: the cash rate on the market strip and
   * the optimiser's Sharpe ratios. Required returns use the 10-year yield,
   * which each stock carries in `discountRates.riskFree`.
   */
  riskFreeRate: number | null
  /**
   * The index's own annualised log return over the last 252 sessions.
   *
   * Null on the sample: the stock page prints the placeholder rather than a
   * zero, because a market return of zero is a claim and an absent one is not.
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

function isStale(asOf: string | null | undefined): boolean {
  if (!asOf) return false
  const at = new Date(asOf).getTime()
  return Number.isFinite(at) && Date.now() - at > STALE_AFTER_HOURS * 3_600_000
}

/**
 * The newest of the stages that actually fetch something.
 *
 * The refresh is excluded on purpose: it is a computation over the tables the
 * other stages fill, so letting it set this would answer "when was data
 * gathered" with the timestamp of the one job that gathered none.
 */
function newestIngest(freshness: Record<string, JobRun>): string | null {
  const stamps = DATA_SOURCES.filter((source) => source.ingest)
    .map((source) => freshness[source.job]?.finishedAt)
    .filter((stamp): stamp is string => Boolean(stamp))

  if (stamps.length === 0) return null
  return stamps.reduce((newest, stamp) => (stamp > newest ? stamp : newest))
}

// ---------------------------------------------------------------------------
// Rows as the serving views return them: snake_case, any figure may be null.
// ---------------------------------------------------------------------------

type Num = number | null

type ScreenerRow = {
  ticker: string
  name: string
  sector: string
  as_of: string
  price: number
  market_cap_bn: Num
  beta: Num
  realised_return: Num
  volatility: Num
  pe_ratio: Num
  dividend_yield: Num
  discount_rates: {
    risk_free: Num
    cost_of_equity: Num
    wacc: Num
    cost_of_debt: Num
    equity_weight: Num
    tax_rate: Num
  } | null
  signals: {
    value: Num
    momentum: Num
    surprise: Num
    surprise_date: string | null
    value_rank: Num
    momentum_rank: Num
    surprise_rank: Num
    implied_returns: {
      fcff: Num
      rim: Num
      revenue: Num
      shareholder_yield: Num
    } | null
    required_return_equity: Num
    required_return_firm: Num
  } | null
}

type MarketRow = {
  as_of: string | null
  risk_free_rate: Num
  short_rate: Num
  index_ticker: string
  index_close: Num
  index_change: Num
  market_return: Num
}

type JobRunRow = {
  job: string
  status: JobRun["status"]
  finished_at: string
  duration_seconds: number | string | null
  rows_upserted: number | null
}

function toDiscountRates(row: ScreenerRow["discount_rates"]): DiscountRates | undefined {
  if (!row) return undefined
  return {
    riskFree: row.risk_free,
    costOfEquity: row.cost_of_equity,
    wacc: row.wacc,
    costOfDebt: row.cost_of_debt,
    equityWeight: row.equity_weight,
    taxRate: row.tax_rate,
  }
}

function toSignals(row: ScreenerRow["signals"]): StockSignals | undefined {
  if (!row) return undefined
  return {
    value: row.value,
    momentum: row.momentum,
    surprise: row.surprise,
    surpriseDate: row.surprise_date,
    valueRank: row.value_rank,
    momentumRank: row.momentum_rank,
    surpriseRank: row.surprise_rank,
    impliedReturns: {
      fcff: row.implied_returns?.fcff ?? null,
      rim: row.implied_returns?.rim ?? null,
      revenue: row.implied_returns?.revenue ?? null,
      shareholderYield: row.implied_returns?.shareholder_yield ?? null,
    },
    requiredReturnEquity: row.required_return_equity,
    requiredReturnFirm: row.required_return_firm,
  }
}

function toStock(row: ScreenerRow): Stock {
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    price: row.price,
    // The screener's numeric fields are non-nullable; a missing figure reads
    // as 0, which every cell already renders as a dash.
    marketCap: row.market_cap_bn ?? 0,
    beta: row.beta ?? 0,
    realisedReturn: row.realised_return ?? 0,
    volatility: row.volatility ?? 0,
    peRatio: row.pe_ratio ?? 0,
    dividendYield: row.dividend_yield ?? 0,
    discountRates: toDiscountRates(row.discount_rates),
    signals: toSignals(row.signals),
  }
}

function toFreshness(rows: JobRunRow[] | null): Record<string, JobRun> {
  return Object.fromEntries(
    (rows ?? []).map((row) => [
      row.job,
      {
        status: row.status,
        finishedAt: row.finished_at,
        durationSeconds:
          row.duration_seconds === null ? null : Number(row.duration_seconds),
        rowsUpserted: row.rows_upserted,
      },
    ])
  )
}

/** The three serving-layer reads, in parallel. */
async function fromWarehouse(): Promise<Universe | null> {
  const next = { revalidate: REVALIDATE_SECONDS, tags: [VALUATIONS_CACHE_TAG] }

  const [rows, market, jobs] = await Promise.all([
    selectRows<ScreenerRow>("screener", "select=*&order=ticker", next),
    selectRows<MarketRow>("market_summary", "select=*", next),
    selectRows<JobRunRow>(
      "latest_job_runs",
      "select=job,status,finished_at,duration_seconds,rows_upserted",
      next
    ),
  ])

  if (!rows || rows.length === 0) return null

  const summary = market?.[0]
  const freshness = toFreshness(jobs)
  const gatheredAt = newestIngest(freshness)
  // When the numbers were computed: the last refresh, else the market date.
  const computedAt = freshness.refresh?.finishedAt ?? summary?.as_of ?? null

  return {
    stocks: rows.map(toStock),
    isBaseline: false,
    computedAt,
    freshness,
    gatheredAt,
    riskFreeRate: summary?.short_rate ?? null,
    marketReturn: summary?.market_return ?? null,
    index:
      summary?.as_of && summary.index_close !== null
        ? {
            ticker: summary.index_ticker,
            date: summary.as_of,
            close: summary.index_close,
            change: summary.index_change,
          }
        : null,
    isStale: isStale(gatheredAt ?? computedAt),
  }
}

export async function loadUniverse(): Promise<Universe> {
  return (
    (await fromWarehouse()) ?? {
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
