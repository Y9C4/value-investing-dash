"use client"

import { useEffect, useState } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Field } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

/**
 * Parks the CAPM, variance/covariance and daily-returns cards.
 *
 * Set to `true` to bring them back. Kept behind a flag rather than commented
 * out so the code stays type-checked and linted — a commented-out block rots
 * silently as the types around it move, and this one is meant to return.
 */
const SHOW_DIAGNOSTICS = false

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

/** The one-year close series. Own component so pages can place it freely. */
export function PriceChartCard({ data }: { data: ReturnsResponse }) {
  const chartData = data.candles.map((candle) => ({
    date: candle.date,
    close: candle.close,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{data.ticker} — last 1 year</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-72 w-full">
          <LineChart data={chartData} margin={{ left: 8, right: 8 }}>
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
              domain={["auto", "auto"]}
              tickFormatter={(value) => formatPrice(value)}
              width={80}
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
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>{data.ticker} — key statistics</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs tracking-wider text-muted-foreground uppercase">
              Beta
            </dt>
            <dd className="text-xl font-semibold">
              {beta?.toFixed(3) ?? "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs tracking-wider text-muted-foreground uppercase">
              Risk-free rate
            </dt>
            <dd className="text-xl font-semibold">
              {formatReturn(data.risk_free_rate)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs tracking-wider text-muted-foreground uppercase">
              Realised return
            </dt>
            <dd className="text-xl font-semibold">
              {formatReturn(data.expected_stock_return)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs tracking-wider text-muted-foreground uppercase">
              Market return
            </dt>
            <dd className="text-xl font-semibold">
              {formatReturn(data.expected_market_return)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

export function TickerHistory({
  initialTicker = "",
}: {
  /** When set, the history loads on mount — used by the stock detail page. */
  initialTicker?: string
}) {
  const [ticker, setTicker] = useState(initialTicker)
  // The symbol whose history is on screen (or in flight). Submitting the form
  // and arriving with an `initialTicker` both funnel through this.
  const [requested, setRequested] = useState(initialTicker.trim())
  const { data, loading, error } = useTickerReturns(requested)
  const { varStock, covStockMarket, varMarket, beta, capmRequired, capmAlpha } =
    deriveCapm(data)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setRequested(ticker.trim())
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <form onSubmit={handleSubmit} className="max-w-md">
        <Field orientation="horizontal">
          <Input
            type="search"
            placeholder="Stock ticker"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Loading…" : "View"}
          </Button>
        </Field>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <PriceChartCard data={data} />

          <div
            className={cn("grid gap-6", SHOW_DIAGNOSTICS && "lg:grid-cols-2")}
          >
            <KeyStatisticsCard data={data} beta={beta} />

            {SHOW_DIAGNOSTICS && (
              <Card>
                <CardHeader>
                  <CardTitle>CAPM</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {/* Required vs realised is the whole CAPM read, so it leads. */}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Measure</TableHead>
                        <TableHead className="text-right">
                          Annualised return
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Required by CAPM</TableCell>
                        <TableCell className="text-right font-mono">
                          {capmRequired !== null
                            ? formatReturn(capmRequired)
                            : "—"}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">
                          Actually realised
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatReturn(data.expected_stock_return)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium">Alpha</TableCell>
                        <TableCell className="text-right font-mono">
                          {capmAlpha !== null ? formatReturn(capmAlpha) : "—"}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
  
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {capmAlpha === null
                      ? "Alpha needs a market variance to compute."
                      : capmAlpha >= 0
                        ? "Delivered more than its systematic risk demanded over this window."
                        : "Delivered less than its systematic risk demanded over this window."}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {SHOW_DIAGNOSTICS && (
            <Card>
              <CardHeader>
                <CardTitle>Variance / covariance matrix</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead />
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Market</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableHead>Stock</TableHead>
                      <TableCell className="text-right font-mono">
                        {varStock?.toExponential(3)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {covStockMarket?.toExponential(3)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead>Market</TableHead>
                      <TableCell className="text-right font-mono">
                        {covStockMarket?.toExponential(3)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {varMarket?.toExponential(3)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {SHOW_DIAGNOSTICS && (
            <Card>
              <CardHeader>
                <CardTitle>Daily prices &amp; returns</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[32rem] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Close</TableHead>
                      <TableHead className="text-right">Stock Return</TableHead>
                      <TableHead className="text-right">Market Return</TableHead>
                      <TableHead className="text-right">Excess Return</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data.candles].reverse().map((candle) => (
                      <TableRow key={candle.date}>
                        <TableCell>{formatDate(candle.date)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(candle.close)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatReturn(candle.stock_log_return)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatReturn(candle.market_log_return)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatReturn(candle.excess_log_return)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
