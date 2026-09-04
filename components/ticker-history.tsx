"use client"

import { useEffect, useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
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
import { BAND_FILL, VALUATION_METHODS, disagreementBand, type Stock } from "@/lib/valuation"

type Candle = {
  date: string
  close: number
  stock_log_return: number
  market_log_return: number
  excess_log_return: number
}

type ReturnsResponse = {
  ticker: string
  candles: Candle[]
  varcov: [[number, number], [number, number]]
  risk_free_rate: number
  expected_stock_return: number
  expected_market_return: number
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
 * these were removed with the standalone page; `deriveCapm` still computes
 * their inputs, which is where they would come back from.
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

/** Beta and the CAPM read derived from one response. */
export function deriveCapm(data: ReturnsResponse | null) {
  const [varStock, covStockMarket, , varMarket] = data
    ? [data.varcov[0][0], data.varcov[0][1], data.varcov[1][0], data.varcov[1][1]]
    : [null, null, null, null]
  const beta =
    varMarket && covStockMarket !== null ? covStockMarket / varMarket : null

  // The return CAPM says this beta ought to have earned, and the gap between
  // that and what it actually earned.
  const capmRequired =
    data && beta !== null
      ? data.risk_free_rate +
      beta * (data.expected_market_return - data.risk_free_rate)
      : null
  const capmAlpha =
    data && capmRequired !== null
      ? data.expected_stock_return - capmRequired
      : null

  return { varStock, covStockMarket, varMarket, beta, capmRequired, capmAlpha }
}

/**
 * The one-year close series, with every model's fair value laid over it.
 *
 * The reference lines are the point of the chart rather than a decoration on
 * it: a fair value is a claim about where this line should be, so drawing the
 * claim on the same axis as the price is the only place the two can be
 * compared without the reader holding a number in their head.
 *
 * ALL of them are drawn, whatever that does to the axis. An earlier version
 * dropped any fair value more than 1.5x the price range away, on the argument
 * that one outlier squashes a year of price action — but a model that thinks
 * the company is worth four times its price is making the single most
 * interesting claim on the page, and hiding it to protect the shape of the
 * line is the wrong trade. A tall panel absorbs most of the cost.
 */
export function PriceChartCard({
  data,
  stock,
}: {
  data: ReturnsResponse
  /** Absent on any surface that has no verdicts to lay over the price. */
  stock?: Stock
}) {
  const chartData = data.candles.map((candle) => ({
    date: candle.date,
    close: candle.close,
  }))

  const closes = chartData.map((point) => point.close)
  const verdicts = (stock?.verdicts ?? []).filter(
    (v) => v.confidence > 0.5
  )
  // The last close is what the models were valued against, so it is the price
  // the reference lines have to be read relative to.
  const current = stock?.price ?? closes[closes.length - 1]

  const low = Math.min(...closes, current, ...verdicts.map((v) => v.fairValue))
  const high = Math.max(...closes, current, ...verdicts.map((v) => v.fairValue))
  const pad = (high - low) * 0.04

  const labelOf = new Map(VALUATION_METHODS.map((m) => [m.id, m.label]))

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{data.ticker} · price, 1 year</PanelTitle>
        <PanelMeta className="text-muted-foreground">
          vs modeled fair value
        </PanelMeta>
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

            {/* Dashed, and behind the price in the paint order: these are
                estimates about the solid line, not readings of their own. */}
            {verdicts.map((verdict) => (
              <ReferenceLine
                key={verdict.method}
                y={verdict.fairValue}
                stroke={BAND_FILL[disagreementBand(verdict.marginOfSafety)]}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{
                  value: labelOf.get(verdict.method) ?? verdict.method,
                  position: "right",
                  fill: "var(--color-muted-foreground)",
                  fontSize: 10,
                }}
              />
            ))}

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

/** Beta, the risk-free rate and the two realised returns behind it. */
export function KeyStatisticsCard({
  data,
  beta,
}: {
  data: ReturnsResponse
  beta: number | null
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
            label="Risk-free"
            value={formatReturn(data.risk_free_rate)}
          />
          <Stat
            label="Realised return"
            value={formatReturn(data.expected_stock_return)}
          />
          <Stat
            label="Market return"
            value={formatReturn(data.expected_market_return)}
          />
        </div>
      </PanelBody>
    </Panel>
  )
}
