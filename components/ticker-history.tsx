"use client"

import { useState } from "react"
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

const chartConfig = {
  close: {
    label: "Close",
    color: "var(--chart-2)",
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

export function TickerHistory() {
  const [ticker, setTicker] = useState("")
  const [data, setData] = useState<ReturnsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchCloseHistory(symbol: string): Promise<ReturnsResponse> {
    const res = await fetch(`/api/close-history/${encodeURIComponent(symbol)}`)
    const body = await res.json()

    if (!res.ok) {
      throw new Error(body?.detail ?? `Failed to fetch history for ${symbol}`)
    }

    return body as ReturnsResponse
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const symbol = ticker.trim()
    if (!symbol) return

    setLoading(true)
    setError(null)

    try {
      const result = await fetchCloseHistory(symbol)
      setData(result)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const chartData =
    data?.candles.map((candle) => ({
      date: candle.date,
      close: candle.close,
    })) ?? []

  const [varStock, covStockMarket, , varMarket] = data
    ? [data.varcov[0][0], data.varcov[0][1], data.varcov[1][0], data.varcov[1][1]]
    : [null, null, null, null]
  const beta =
    varMarket && covStockMarket !== null ? covStockMarket / varMarket : null

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <form onSubmit={handleSubmit}>
        <Field orientation="horizontal">
          <Input
            type="search"
            placeholder="Stock Ticker"
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
          <Card>
            <CardHeader>
              <CardTitle>{data.ticker} — Last 1 Year</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <LineChart data={chartData} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} />
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

          <Card>
            <CardHeader>
              <CardTitle>{data.ticker} — Key Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Variance (Stock)</dt>
                  <dd className="font-mono">{varStock?.toExponential(3)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Beta</dt>
                  <dd className="font-mono">{beta?.toFixed(3)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Risk-Free Rate (1Y avg)</dt>
                  <dd className="font-mono">
                    {formatReturn(data.risk_free_rate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expected Stock Return</dt>
                  <dd className="font-mono">
                    {formatReturn(data.expected_stock_return)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Expected Market Return</dt>
                  <dd className="font-mono">
                    {formatReturn(data.expected_market_return)}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variance / Covariance Matrix</CardTitle>
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

          <Card>
            <CardHeader>
              <CardTitle>Valuation Methods</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Expected Return</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-chart-2">
                      Actual Return
                    </TableCell>
                    <TableCell className="text-right font-mono text-chart-2">
                      {formatReturn(data.expected_stock_return)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>CAPM</TableCell>
                    <TableCell className="text-right font-mono">
                      {beta !== null
                        ? formatReturn(
                            data.risk_free_rate +
                              beta *
                                (data.expected_market_return -
                                  data.risk_free_rate)
                          )
                        : "—"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily Prices &amp; Returns</CardTitle>
            </CardHeader>
            <CardContent>
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
        </>
      )}
    </div>
  )
}
