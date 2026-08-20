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
import { BASELINE_FRONTIER, type FrontierResponse } from "@/lib/baseline-frontier"

const DEFAULT_PORTFOLIOS = 100
const MIN_PORTFOLIOS = 2
const MAX_PORTFOLIOS = 500

/**
 * Three identities, which is the all-pairs cap for a scatter — any two marks
 * here can end up adjacent, so the palette is validated with `--pairs all`.
 * The two anchors are additionally separated by shape (star) and a surface
 * ring, so identity never rests on hue alone.
 */
const chartConfig = {
  envelope: { label: "Efficient frontier", color: "var(--color-series-1)" },
  cml: { label: "Capital market line", color: "var(--color-series-2)" },
  anchor: { label: "Anchor portfolio", color: "var(--color-series-3)" },
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

function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 border border-border bg-card px-5 py-4">
      <span className="text-xs tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      {/* Proportional figures: this is a standalone value, not a column. */}
      <span className="text-2xl font-semibold">{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function EfficientFrontier({
  tickers = [],
}: {
  /** A screened subset handed over by the screener; empty means the full index. */
  tickers?: string[]
}) {
  const [shortAllowed, setShortAllowed] = useState(false)
  const [portfolios, setPortfolios] = useState(String(DEFAULT_PORTFOLIOS))
  // Seeded so the page is never blank: the baseline renders instantly and is
  // replaced the moment a live solve returns.
  const [data, setData] = useState<FrontierResponse>(BASELINE_FRONTIER)
  const [isBaseline, setIsBaseline] = useState(true)
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
      const query = new URLSearchParams({
        short_allowed: String(shortAllowed),
        n_portfolios: String(parsedPortfolios),
      })
      if (tickers.length > 0) {
        query.set("tickers", tickers.join(","))
      }

      const res = await fetch(`/api/efficient-frontier?${query}`, {
        method: "POST",
      })
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.detail ?? "Failed to build the efficient frontier")
      }

      setData(body as FrontierResponse)
      setIsBaseline(false)
    } catch (err) {
      // Keep the previous render on screen rather than dropping to a blank
      // frame — the error line says what happened.
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const envelopeData = data.envelope.map((point) => ({
    volatility: point.volatility,
    return: point.return,
  }))

  // The API extends the CML well into levered territory. Past a little beyond
  // the tangency point it only stretches the axes and flattens the frontier's
  // hook, so the line is clipped to the plotted range.
  const maxEnvelopeVol = Math.max(
    ...data.envelope.map((point) => point.volatility)
  )
  const cmlLimit = maxEnvelopeVol * 1.08
  const cmlSlope =
    data.max_sharpe.volatility > 0
      ? (data.max_sharpe.return - data.risk_free_rate) /
        data.max_sharpe.volatility
      : 0
  const cmlData = [
    { volatility: 0, return: data.risk_free_rate },
    { volatility: cmlLimit, return: data.risk_free_rate + cmlSlope * cmlLimit },
  ]

  const anchors = [
    {
      key: "maxSharpe" as const,
      title: "Max Sharpe",
      portfolio: data.max_sharpe,
    },
    {
      key: "minVolatility" as const,
      title: "Min volatility",
      portfolio: data.min_volatility,
    },
  ]

  return (
    <div className="flex w-full flex-col gap-6">
      {/* States plainly that this solve is scoped to the screened set — the
          whole reason the screener exists ahead of it. */}
      {tickers.length > 0 && (
        <div className="flex flex-col gap-1 border border-border bg-card px-5 py-4">
          <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Screened universe
          </span>
          <p className="text-sm leading-relaxed">
            Optimising over the{" "}
            <span className="font-mono">{tickers.length}</span>{" "}
            {tickers.length === 1 ? "stock" : "stocks"} handed over from the
            screener
            {typeof data.n_assets === "number" && !isBaseline
              ? ` — ${data.n_assets} had the price history to be solved`
              : ""}
            . The optimiser can only allocate within this set, so a stock the
            filters rejected cannot enter the portfolio at any weight.
          </p>
        </div>
      )}

      {/* Controls in one row above the content they scope. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={handleBuild} disabled={loading || !portfoliosValid}>
            {loading
              ? "Optimising…"
              : tickers.length > 0
                ? `Optimise ${tickers.length} screened stocks`
                : "Run live optimisation"}
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

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Max Sharpe"
          value={data.max_sharpe.sharpe.toFixed(2)}
          hint={`${formatPercent(data.max_sharpe.return)} return at ${formatPercent(data.max_sharpe.volatility)} vol`}
        />
        <StatTile
          label="Min volatility"
          value={formatPercent(data.min_volatility.volatility)}
          hint={`${formatPercent(data.min_volatility.return)} expected return`}
        />
        <StatTile
          label="Risk-free rate"
          value={formatPercent(data.risk_free_rate)}
          hint="US 13-week treasury, annualised"
        />
      </div>

      <Card>
        <CardHeader className="flex items-baseline justify-between gap-4">
          <CardTitle>Efficient frontier</CardTitle>
          {/* The provenance of what's on screen is never ambiguous. */}
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            {loading
              ? "Solving…"
              : isBaseline
                ? "Illustrative baseline"
                : `Live · ${data.n_portfolios} portfolios`}
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChartContainer
            config={chartConfig}
            className={`aspect-auto h-[26rem] w-full transition-opacity ${
              loading ? "opacity-60" : "opacity-100"
            }`}
          >
            <ComposedChart
              margin={{ left: 12, right: 16, top: 12, bottom: 28 }}
            >
              <CartesianGrid vertical={false} stroke="var(--color-grid)" />
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
              <ZAxis range={[18, 18]} />
              <ZAxis zAxisId="anchor" range={[260, 260]} />
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
                name="Capital market line"
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
                name="Efficient frontier"
                stroke="var(--color-envelope)"
                strokeWidth={2}
                strokeLinecap="round"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                legendType="none"
              />
              {/* The 2px line carries the frontier's shape; a dot per portfolio
                  would fuse into a solid band at these densities. */}
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
                  fill="var(--color-anchor)"
                  // 2px surface ring keeps the marker legible where it sits on
                  // the frontier line.
                  stroke="var(--color-card)"
                  strokeWidth={2}
                  shape={key === "maxSharpe" ? "star" : "diamond"}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ChartContainer>

          {/* Legend is always present for >= 2 series. */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 4" className="h-1 w-4 shrink-0">
                <line
                  x1="0"
                  y1="2"
                  x2="16"
                  y2="2"
                  stroke="var(--color-series-1)"
                  strokeWidth="2"
                />
              </svg>
              Efficient frontier
            </span>
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 4" className="h-1 w-4 shrink-0">
                <line
                  x1="0"
                  y1="2"
                  x2="16"
                  y2="2"
                  stroke="var(--color-series-2)"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
              </svg>
              Capital market line
            </span>
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 10 10" className="size-3 shrink-0">
                <polygon
                  points="5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"
                  fill="var(--color-series-3)"
                />
              </svg>
              Max Sharpe
            </span>
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 10 10" className="size-3 shrink-0">
                <polygon points="5,0 10,5 5,10 0,5" fill="var(--color-series-3)" />
              </svg>
              Min volatility
            </span>
          </div>

          {isBaseline && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Showing an illustrative baseline frontier so the shape is visible
              immediately. Run the live optimisation to solve across the S&amp;P
              500 with Ledoit-Wolf shrinkage — it takes a few minutes.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Anchor portfolios</CardTitle>
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
                          {key === "maxSharpe" ? (
                            <polygon
                              points="5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"
                              fill="var(--color-series-3)"
                            />
                          ) : (
                            <polygon
                              points="5,0 10,5 5,10 0,5"
                              fill="var(--color-series-3)"
                            />
                          )}
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
                  <TableCell className="font-medium">Risk-free rate</TableCell>
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
            <CardTitle>Max Sharpe — holdings</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                  <TableHead className="w-32">Share</TableHead>
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
                      <TableCell>
                        {/* Sequential: one hue, magnitude by length. */}
                        <span
                          className="block h-2"
                          style={{
                            width: `${Math.min(weight * 900, 100).toFixed(2)}%`,
                            background: "var(--color-seq-3)",
                          }}
                          aria-hidden="true"
                        />
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
