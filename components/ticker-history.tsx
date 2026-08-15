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
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type HistoryResponse = {
  ticker: string
  period: string
  interval: string
  candles: Candle[]
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

export function TickerHistory() {
  const [ticker, setTicker] = useState("")
  const [data, setData] = useState<HistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const symbol = ticker.trim()
    if (!symbol) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/history/${encodeURIComponent(symbol)}`
      )
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.detail ?? "Failed to fetch price history")
      }

      setData(body as HistoryResponse)
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
              <CardTitle>{data.ticker} — Last 30 Days</CardTitle>
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
              <CardTitle>Close Prices</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Close</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.candles].reverse().map((candle) => (
                    <TableRow key={candle.date}>
                      <TableCell>{formatDate(candle.date)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPrice(candle.close)}
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
