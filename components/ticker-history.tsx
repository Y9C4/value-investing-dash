"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
  Stat,
} from "@/components/ui/panel"
import { formatPct, formatSignedPct } from "@/lib/format"

type Candle = {
  date: string
  close: number
}

/**
 * What the chart is fetched over the wire.
 *
 * Closes and nothing else. It used to carry a 2x2 covariance matrix and three
 * scalars as well, all of which came from the solver and only one of which was
 * ever read: `deriveCapm` reduced the whole matrix to a single beta and threw
 * the rest away. That beta is already measured over the same window and stored
 * in `ticker_statistics`, so it reaches the page as `Stock.beta` on a payload
 * the route already loads. Deriving it a second time from a second source was
 * two numbers that could disagree, and the page had no way to say which was
 * right.
 */
type ReturnsResponse = {
  ticker: string
  candles: Candle[]
}

// A single series, so no legend box — the card title names what is plotted.
const chartConfig = {
  close: {
    label: "Close",
    color: "var(--color-series-1)",
  },
} satisfies ChartConfig

/** A trading date, "YYYY-MM-DD". Read as UTC so no reader's timezone moves it a day. */
function formatDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** "Nov 23, 2026", for the summary a screen reader hears. */
function formatLongDate(iso: string) {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

function formatPrice(value: number, digits = 2) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/**
 * Round price ticks (steps of 1, 2, 2.5 or 5 × 10ⁿ) and the domain they span.
 * Recharts' own ticks on a padded domain land on values like $66.26.
 */
function niceTicks(low: number, high: number, target = 5) {
  const raw = (high - low || Math.abs(high) || 1) / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!
  const ticks: number[] = []
  // Up to the first tick at or above the high, and never fewer than two (a flat series).
  for (let t = Math.floor(low / step) * step; ; t += step) {
    // Float error would otherwise print $72.49999.
    ticks.push(Number(t.toFixed(6)))
    if (t >= high && ticks.length > 1) break
  }
  return { ticks, digits: Number.isInteger(step) ? 0 : 2 }
}

/**
 * One tick per month start, thinned to at most `count`, labelled with the
 * month and, on the first tick and wherever the year turns, the year.
 */
function monthTicks(dates: string[], count: number) {
  const starts = dates.filter((d, i) => i > 0 && d.slice(0, 7) !== dates[i - 1].slice(0, 7))
  const every = Math.max(1, Math.ceil(starts.length / count))
  const ticks = starts.filter((_, i) => i % every === 0)
  const labels = new Map(
    ticks.map((d, i) => {
      const month = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      })
      const newYear = i === 0 || d.slice(0, 4) !== ticks[i - 1].slice(0, 4)
      return [d, newYear ? `${month} ${d.slice(0, 4)}` : month]
    })
  )
  return { ticks, labels }
}

// Fewer date ticks on a phone, where six "Mmm YYYY" labels would collide.
const wideQuery = "(min-width: 640px)"
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(wideQuery)
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    },
    () => window.matchMedia(wideQuery).matches,
    () => true
  )
}

/**
 * The price, risk and CAPM cards for one stock, and the request behind them.
 *
 * Not a page: `/stocks/[ticker]` composes these into its own grid alongside the
 * valuation table, and `/stocks` is now only the search box that routes here.
 * The CAPM, covariance-matrix and daily-returns cards that used to live below
 * these were removed with the standalone page, and the covariance matrix they
 * ran on is no longer fetched. Bringing them back means bringing that read
 * back, which `GET /returns/{ticker}` on the solver still serves.
 */

/**
 * Loads one ticker's price history and CAPM inputs.
 *
 * Extracted from the component so the detail page can lay the resulting cards
 * out in its own grid while sharing a single request — two components each
 * fetching the same symbol would double the work for identical data.
 */
export function useTickerReturns(requested: string) {
  const [data, setData] = useState<ReturnsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!requested) return

    const controller = new AbortController()

    async function load(symbol: string) {
      setLoading(true)
      setError(null)
      // The last ticker's chart must not stand in for this one while it loads.
      setData(null)

      try {
        const res = await fetch(
          `/api/close-history/${encodeURIComponent(symbol)}`,
          { signal: controller.signal }
        )
        // An error page may not be JSON; the status decides, the body only explains.
        const body = await res.json().catch(() => null)

        if (!res.ok) {
          throw new Error(
            body?.detail ?? `Failed to fetch history for ${symbol}`
          )
        }

        setData(body as ReturnsResponse)
      } catch (err) {
        if (controller.signal.aborted) return
        setData(null)
        setError(err instanceof Error ? err.message : "Something went wrong")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load(requested)

    return () => controller.abort()
  }, [requested])

  return { data, loading, error }
}

/**
 * The one-year close series.
 *
 * It used to carry every forward model's fair value as a dashed line. Those
 * models were retired (20261117000003) and the reverse-DCF readings that
 * replaced them are returns, not prices, so they live in the signal panel
 * instead of on this axis.
 */
export function PriceChartCard({ data }: { data: ReturnsResponse }) {
  const wide = useWide()
  const chartData = data.candles.map((candle) => ({
    date: candle.date.slice(0, 10),
    close: candle.close,
  }))

  const closes = chartData.map((point) => point.close)
  const low = Math.min(...closes)
  const high = Math.max(...closes)
  const y = niceTicks(low, high)
  const x = monthTicks(
    chartData.map((point) => point.date),
    wide ? 6 : 3
  )
  const first = chartData[0]
  const last = chartData[chartData.length - 1]
  const change = last.close / first.close - 1
  const summary =
    `${data.ticker} daily closes from ${formatLongDate(first.date)} to ${formatLongDate(last.date)}: ` +
    `${formatPrice(first.close)} to ${formatPrice(last.close)}, ${formatSignedPct(change)}; ` +
    `low ${formatPrice(low)}, high ${formatPrice(high)}.`

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{data.ticker} · price, 1 year</PanelTitle>
        <PanelMeta>
          {formatSignedPct(change)} over {chartData.length} sessions to {formatLongDate(last.date)}
        </PanelMeta>
      </PanelHeader>
      <PanelBody>
        <figure className="relative">
          <figcaption className="sr-only">{summary}</figcaption>
          <ChartContainer config={chartConfig} className="h-72 w-full sm:h-96">
            {/* The right margin is the room the last-price label needs. */}
            <LineChart data={chartData} margin={{ left: 0, right: 8 + 7 * formatPrice(last.close).length, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--color-grid)" />
              <XAxis
                dataKey="date"
                ticks={x.ticks}
                interval={0}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => x.labels.get(String(value)) ?? formatDate(String(value))}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                domain={[y.ticks[0], y.ticks[y.ticks.length - 1]]}
                ticks={y.ticks}
                tickFormatter={(value) => formatPrice(Number(value), y.digits)}
                width={16 + 8 * formatPrice(y.ticks[y.ticks.length - 1], y.digits).length}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => formatLongDate(String(value))}
                    formatter={(value) => formatPrice(Number(value))}
                  />
                }
              />

              {/* Linear, not monotone: a smoothed curve overshoots daily closes. */}
              <Line
                dataKey="close"
                type="linear"
                stroke="var(--color-close)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <ReferenceDot
                x={last.date}
                y={last.close}
                r={4}
                fill="var(--color-close)"
                stroke="var(--card)"
                strokeWidth={2}
                label={{
                  value: formatPrice(last.close),
                  position: "right",
                  offset: 8,
                  fill: "var(--foreground)",
                  fontSize: 12,
                }}
              />
            </LineChart>
          </ChartContainer>
        </figure>
        <p className="mt-2 text-xs text-muted-foreground">
          Daily closes, split-adjusted; dividends are not added back.
        </p>
      </PanelBody>
    </Panel>
  )
}

/**
 * The chart for a stock whose closes were not in the warehouse at render
 * time: fetched from the route, which falls back to the market data service.
 */
export function PriceChartLoader({ ticker }: { ticker: string }) {
  const { data, loading, error } = useTickerReturns(ticker)
  if (error) {
    return (
      <div className="border border-border bg-card px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only the price chart is affected: everything else on this page is precomputed.
        </p>
      </div>
    )
  }
  if (loading || !data) return <div className="h-[21rem] animate-pulse border border-border bg-card" />
  return data.candles.length > 0 ? <PriceChartCard data={data} /> : null
}

/**
 * Beta, the risk-free rate and the two realised returns behind it.
 *
 * Every figure is precomputed and arrives with the page: beta and the stock's
 * return from `ticker_statistics` by way of the universe snapshot, the two
 * scalars from that snapshot's own payload. None of it waits on the chart
 * request, so this card renders with the server response rather than after it.
 *
 * Nullable throughout, because a snapshot written before the market return
 * existed simply does not carry one. The placeholder is the app's convention
 * for a value that is absent, and it is the honest answer here: a market
 * return printed as 0.00% would be a claim nobody made.
 */
export function KeyStatisticsCard({
  beta,
  riskFreeRate,
  realisedReturn,
  marketReturn,
}: {
  beta: number | null
  riskFreeRate: number | null
  realisedReturn: number | null
  marketReturn: number | null
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Key statistics</PanelTitle>
        <PanelMeta>252-day window</PanelMeta>
      </PanelHeader>
      <PanelBody>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat
            label="Beta"
            value={beta?.toFixed(2) ?? "—"}
            hint="against the market, shrunk (Levi & Welch)"
          />
          <Stat
            label="Risk-free rate, 3-month T-bill"
            value={formatPct(riskFreeRate)}
            hint="252-day average: the cash rate over this window, and the optimiser's Sharpe ratios"
          />
          <Stat
            label="Realised return"
            value={formatSignedPct(realisedReturn)}
            hint="log, annualised: mean daily log return × 252"
          />
          <Stat
            label="Market return"
            value={formatSignedPct(marketReturn)}
            hint="S&P 500, log, annualised, same window"
          />
        </div>
        <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Required returns use the 10-year Treasury instead, the horizon a
          DCF discounts over (see Required return and risk inputs).
        </p>
      </PanelBody>
    </Panel>
  )
}
