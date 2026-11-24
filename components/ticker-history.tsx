"use client"

import { useEffect, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  })
}

function formatReturn(value: number) {
  return value.toLocaleString("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
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

      try {
        const res = await fetch(
          `/api/close-history/${encodeURIComponent(symbol)}`,
          { signal: controller.signal }
        )
        const body = await res.json()

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
  const chartData = data.candles.map((candle) => ({
    date: candle.date,
    close: candle.close,
  }))

  const closes = chartData.map((point) => point.close)
  const low = Math.min(...closes)
  const high = Math.max(...closes)
  const pad = (high - low) * 0.04

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{data.ticker} · price, 1 year</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ChartContainer config={chartConfig} className="h-96 w-full">
          <LineChart data={chartData} margin={{ left: 8, right: 44, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={[low - pad, high + pad]}
              tickFormatter={(value) => formatPrice(value)}
              width={72}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatDate(String(value))}
                  formatter={(value) => formatPrice(Number(value))}
                />
              }
            />

            <Line
              dataKey="close"
              type="monotone"
              stroke="var(--color-close)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </PanelBody>
    </Panel>
  )
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
          <Stat label="Beta" value={beta?.toFixed(3) ?? "—"} />
          <Stat
            label="T-bill (3M)"
            value={riskFreeRate === null ? "—" : formatReturn(riskFreeRate)}
          />
          <Stat
            label="Realised return"
            value={realisedReturn === null ? "—" : formatReturn(realisedReturn)}
          />
          <Stat
            label="Market return"
            value={marketReturn === null ? "—" : formatReturn(marketReturn)}
          />
        </div>
      </PanelBody>
    </Panel>
  )
}
