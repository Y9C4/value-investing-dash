"use client"

import { useState } from "react"
import {
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

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
import { Input } from "@/components/ui/input"
import { Label as FieldLabel } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type EnvelopePoint = {
  t: number
  return: number
  volatility: number
  sharpe: number
}

type Portfolio = {
  return: number
  volatility: number
  sharpe: number
  weights: Record<string, number>
}

type CmlPoint = { volatility: number; return: number }

type FrontierResponse = {
  short_allowed: boolean
  n_portfolios: number
  risk_free_rate: number
  max_sharpe: Portfolio
  min_volatility: Portfolio
  capital_market_line: CmlPoint[]
  envelope: EnvelopePoint[]
}

const DEFAULT_PORTFOLIOS = 100
const MIN_PORTFOLIOS = 2
const MAX_PORTFOLIOS = 500

// The theme's chart ramp is a single blue hue, so the two anchors are separated
// from the envelope by size and ring as much as by step.
const chartConfig = {
  envelope: { label: "Envelope", color: "var(--chart-1)" },
  cml: { label: "Capital Market Line", color: "var(--chart-4)" },
  maxSharpe: { label: "Max Sharpe (tangency)", color: "var(--chart-5)" },
  minVolatility: { label: "Min Volatility", color: "var(--chart-3)" },
} satisfies ChartConfig

function formatPercent(value: number) {
  return value.toLocaleString("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatAxisPercent(value: number) {
  return value.toLocaleString("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  })
}

export function EfficientFrontier() {
  const [shortAllowed, setShortAllowed] = useState(false)
  const [portfolios, setPortfolios] = useState(String(DEFAULT_PORTFOLIOS))
  const [data, setData] = useState<FrontierResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedPortfolios = Number(portfolios)
  const portfoliosValid =
    Number.isInteger(parsedPortfolios) &&
    parsedPortfolios >= MIN_PORTFOLIOS &&
    parsedPortfolios <= MAX_PORTFOLIOS

  async function handleBuild() {
    if (!portfoliosValid) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/efficient-frontier?short_allowed=${shortAllowed}` +
          `&n_portfolios=${parsedPortfolios}`,
        { method: "POST" }
      )
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.detail ?? "Failed to build the efficient frontier")
      }

      setData(body as FrontierResponse)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const envelopeData =
    data?.envelope.map((point) => ({
      volatility: point.volatility,
      return: point.return,
    })) ?? []

  const cmlData = data?.capital_market_line ?? []

  // Keep dots readable when few, and avoid a solid band when many.
  const envelopeDotSize =
    envelopeData.length > 200 ? 12 : envelopeData.length > 80 ? 24 : 48

  const anchors = data
    ? [
        {
          key: "maxSharpe" as const,
          title: "Max Sharpe",
          portfolio: data.max_sharpe,
        },
        {
          key: "minVolatility" as const,
          title: "Min Volatility",
          portfolio: data.min_volatility,
        },
      ]
    : []

  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleBuild} disabled={loading || !portfoliosValid}>
            {loading ? "Optimizing…" : "Build Efficient Frontier"}
          </Button>

          <FieldLabel
            htmlFor="n-portfolios"
            className="flex items-center gap-2 text-sm font-normal"
          >
            Portfolios
            <Input
              id="n-portfolios"
              type="number"
              inputMode="numeric"
              min={MIN_PORTFOLIOS}
              max={MAX_PORTFOLIOS}
              value={portfolios}
              onChange={(e) => setPortfolios(e.target.value)}
              className="w-24"
              aria-invalid={!portfoliosValid}
            />
          </FieldLabel>

          <FieldLabel className="flex items-center gap-2 text-sm font-normal">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={shortAllowed}
              onChange={(e) => setShortAllowed(e.target.checked)}
            />
            Allow short selling
          </FieldLabel>
        </div>

        {!portfoliosValid && (
          <p className="text-sm text-destructive">
            Enter a whole number between {MIN_PORTFOLIOS} and {MAX_PORTFOLIOS}.
          </p>
        )}

        {loading && (
          <p className="text-sm text-muted-foreground">
            Solving across ~500 tickers — this can take a little while.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {data && (
        <>
          <Card className="bg-background">
            <CardHeader>
              <CardTitle>Efficient Frontier Envelope</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[26rem] w-full"
              >
                <ComposedChart margin={{ left: 12, right: 16, top: 12, bottom: 28 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    type="number"
                    dataKey="volatility"
                    name="Volatility"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    domain={[0, "dataMax"]}
                    tickFormatter={formatAxisPercent}
                  >
                    <Label
                      value="Volatility (annualised)"
                      position="insideBottom"
                      offset={-16}
                      className="fill-muted-foreground text-xs"
                    />
                  </XAxis>
                  <YAxis
                    type="number"
                    dataKey="return"
                    name="Return"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    width={68}
                    domain={["auto", "auto"]}
                    tickFormatter={formatAxisPercent}
                  >
                    <Label
                      value="Expected return (annualised)"
                      angle={-90}
                      position="insideLeft"
                      style={{ textAnchor: "middle" }}
                      className="fill-muted-foreground text-xs"
                    />
                  </YAxis>
                  <ZAxis range={[envelopeDotSize, envelopeDotSize]} />
                  <ZAxis zAxisId="anchor" range={[220, 220]} />
                  <ChartTooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={
                      <ChartTooltipContent
                        hideIndicator
                        labelFormatter={(_, payload) => {
                          const point = payload?.[0]?.payload as
                            | { volatility: number; return: number }
                            | undefined
                          if (!point) return null
                          return (
                            <div className="grid gap-1">
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Volatility
                                </span>
                                <span className="font-mono tabular-nums">
                                  {formatPercent(point.volatility)}
                                </span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                  Return
                                </span>
                                <span className="font-mono tabular-nums">
                                  {formatPercent(point.return)}
                                </span>
                              </div>
                            </div>
                          )
                        }}
                        formatter={() => null}
                      />
                    }
                  />
                  <Line
                    data={cmlData}
                    dataKey="return"
                    name="Capital Market Line"
                    stroke="var(--color-cml)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    legendType="none"
                    tooltipType="none"
                  />
                  <Line
                    data={envelopeData}
                    dataKey="return"
                    name="Envelope"
                    stroke="var(--color-envelope)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={false}
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Scatter
                    data={envelopeData}
                    name="Envelope"
                    fill="var(--color-envelope)"
                    isAnimationActive={false}
                  />
                  {anchors.map(({ key, title, portfolio }) => (
                    <Scatter
                      key={key}
                      name={title}
                      data={[
                        {
                          volatility: portfolio.volatility,
                          return: portfolio.return,
                        },
                      ]}
                      zAxisId="anchor"
                      fill={`var(--color-${key})`}
                      stroke="var(--color-card)"
                      strokeWidth={2}
                      shape="star"
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ChartContainer>

              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: "var(--color-envelope)" }}
                  />
                  Envelope ({data.n_portfolios} portfolios)
                </span>
                <span className="flex items-center gap-1.5">
                  <svg viewBox="0 0 16 4" className="h-1 w-4 shrink-0">
                    <line
                      x1="0"
                      y1="2"
                      x2="16"
                      y2="2"
                      stroke="var(--color-cml)"
                      strokeWidth="2"
                      strokeDasharray="5 4"
                    />
                  </svg>
                  Capital market line
                </span>
                {anchors.map(({ key, title }) => (
                  <span key={key} className="flex items-center gap-1.5">
                    <svg viewBox="0 0 10 10" className="size-3 shrink-0">
                      <polygon
                        points="5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"
                        fill={`var(--color-${key})`}
                      />
                    </svg>
                    {title}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Anchor Portfolios</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Portfolio</TableHead>
                    <TableHead className="text-right">Return</TableHead>
                    <TableHead className="text-right">Volatility</TableHead>
                    <TableHead className="text-right">Sharpe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {anchors.map(({ key, title, portfolio }) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          <svg viewBox="0 0 10 10" className="size-3 shrink-0">
                            <polygon
                              points="5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"
                              fill={`var(--color-${key})`}
                            />
                          </svg>
                          {title}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPercent(portfolio.return)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatPercent(portfolio.volatility)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {portfolio.sharpe.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-medium">Risk-Free Rate</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatPercent(data.risk_free_rate)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Max Sharpe — Holdings</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(data.max_sharpe.weights).map(
                    ([ticker, weight]) => (
                      <TableRow key={ticker}>
                        <TableCell>{ticker}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPercent(weight)}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
