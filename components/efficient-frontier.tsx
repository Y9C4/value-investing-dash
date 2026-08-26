"use client"

import {
  CartesianGrid,
  ComposedChart,
  Label,
  Line,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

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
import type { FrontierResponse } from "@/lib/baseline-frontier"
import {
  formatAxisPercent,
  formatPercent,
  percentTickFormatter,
} from "@/lib/format"

/**
 * The two views of a solved frontier: the curve itself, and the Sharpe ratio
 * measured along it.
 *
 * Both are presentational — they render whatever `data` they are handed and
 * never fetch. `PortfolioBuilder` owns the solve.
 */

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

const STAR_POINTS = "5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"

function LegendSwatch({
  dashed,
  color,
}: {
  dashed?: boolean
  color: string
}) {
  return (
    <svg viewBox="0 0 16 4" className="h-1 w-4 shrink-0">
      <line
        x1="0"
        y1="2"
        x2="16"
        y2="2"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashed ? "5 4" : undefined}
      />
    </svg>
  )
}

/** True when a capital market line can honestly be drawn. */
export function hasTangency(data: FrontierResponse) {
  const slope =
    data.max_sharpe.volatility > 0
      ? (data.max_sharpe.return - data.risk_free_rate) /
        data.max_sharpe.volatility
      : 0
  return data.tangency_beats_risk_free !== false && slope > 0
}

export function FrontierChart({
  data,
  isBaseline,
  loading,
}: {
  data: FrontierResponse
  isBaseline: boolean
  loading: boolean
}) {
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
  // A screened set can contain no portfolio that beats the risk-free asset —
  // routine when the filters select on cheapness rather than momentum. The
  // frontier is still real, but a line tangent to it would slope downwards and
  // claim that risk is paid negatively, so it is withheld and said out loud.
  const drawCml = hasTangency(data)
  const cmlData = drawCml
    ? [
        { volatility: 0, return: data.risk_free_rate },
        {
          volatility: cmlLimit,
          return: data.risk_free_rate + cmlSlope * cmlLimit,
        },
      ]
    : []

  const anchors = [
    { key: "maxSharpe" as const, title: "Max Sharpe", portfolio: data.max_sharpe },
    {
      key: "minVolatility" as const,
      title: "Min volatility",
      portfolio: data.min_volatility,
    },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-4">
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
          <ComposedChart margin={{ left: 12, right: 16, top: 12, bottom: 28 }}>
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
                          <span className="text-muted-foreground">Return</span>
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
                  { volatility: portfolio.volatility, return: portfolio.return },
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
            <LegendSwatch color="var(--color-series-1)" />
            Efficient frontier
          </span>
          <span className="flex items-center gap-1.5">
            <LegendSwatch dashed color="var(--color-series-2)" />
            Capital market line
          </span>
          <span className="flex items-center gap-1.5">
            <svg viewBox="0 0 10 10" className="size-3 shrink-0">
              <polygon points={STAR_POINTS} fill="var(--color-series-3)" />
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

        {!isBaseline && !drawCml && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No capital market line: over this set, no portfolio the constraints
            allow out-earned the {formatPercent(data.risk_free_rate)} risk-free
            rate across the window, so there is no tangency portfolio to draw
            one through. The frontier itself still holds — the best available
            Sharpe ratio is simply negative. A screen selecting on cheapness
            rather than momentum reaches this outcome often.
          </p>
        )}

        {!isBaseline && (data.l2_gamma ?? 0) > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            With an L2 penalty of{" "}
            <span className="font-mono tabular-nums">{data.l2_gamma}</span>,
            every point above minimises variance{" "}
            <em>plus that penalty</em> rather than variance alone, so this curve
            sits fractionally inside the unregularised frontier. That is the
            trade being made deliberately: a little theoretical efficiency for
            weights that are spread rather than piled on a handful of names.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Sharpe ratio measured along the frontier.
 *
 * The frontier chart shows where the tangency portfolio sits; this shows how
 * confidently. A flat plateau means the max-Sharpe portfolio is one of many
 * nearly as good; a sharp spike means it is a knife-edge worth distrusting.
 */
export function SharpeCurve({
  data,
  isBaseline,
}: {
  data: FrontierResponse
  isBaseline: boolean
}) {
  const points = data.envelope.map((point) => ({
    volatility: point.volatility,
    sharpe: point.sharpe,
  }))

  if (points.length < 2) return null

  const peak = points.reduce((best, point) =>
    point.sharpe > best.sharpe ? point : best
  )
  const anyNegative = points.some((point) => point.sharpe < 0)
  // The frontier's volatility range is often only two or three percentage
  // points wide, where whole-percent ticks print the same label twice.
  const volatilities = points.map((point) => point.volatility)
  const formatVolatilityTick = percentTickFormatter(
    Math.max(...volatilities) - Math.min(...volatilities)
  )

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>Sharpe along the frontier</CardTitle>
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          Peak {peak.sharpe.toFixed(2)}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChartContainer
          // A single plotted series, so no legend box — the title names it.
          // The peak marker is direct-labelled instead.
          config={{ sharpe: { label: "Sharpe", color: "var(--color-series-1)" } }}
          className="aspect-auto h-64 w-full"
        >
          <ComposedChart margin={{ left: 4, right: 16, top: 12, bottom: 24 }}>
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              type="number"
              dataKey="volatility"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={["dataMin", "dataMax"]}
              tickFormatter={formatVolatilityTick}
            >
              <Label
                value="Volatility (annualised)"
                position="insideBottom"
                offset={-14}
                className="fill-muted-foreground text-xs"
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="sharpe"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={44}
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => value.toFixed(2)}
            />
            <ZAxis zAxisId="peak" range={[240, 240]} />
            {anyNegative && (
              <ReferenceLine y={0} stroke="var(--color-axis)" strokeWidth={1} />
            )}
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  hideIndicator
                  labelFormatter={(_, payload) => {
                    const point = payload?.[0]?.payload as
                      | { volatility: number; sharpe: number }
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
                          <span className="text-muted-foreground">Sharpe</span>
                          <span className="font-mono tabular-nums">
                            {point.sharpe.toFixed(3)}
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
              data={points}
              dataKey="sharpe"
              stroke="var(--color-series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Scatter
              name="Max Sharpe"
              data={[peak]}
              dataKey="sharpe"
              zAxisId="peak"
              fill="var(--color-series-3)"
              stroke="var(--color-card)"
              strokeWidth={2}
              shape="star"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>

        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="inline-flex translate-y-px items-center pr-1">
            <svg viewBox="0 0 10 10" className="size-3">
              <polygon points={STAR_POINTS} fill="var(--color-series-3)" />
            </svg>
          </span>
          Peak Sharpe of{" "}
          <span className="font-mono tabular-nums">
            {peak.sharpe.toFixed(2)}
          </span>{" "}
          at{" "}
          <span className="font-mono tabular-nums">
            {formatPercent(peak.volatility)}
          </span>{" "}
          volatility — the tangency portfolio the capital market line is drawn
          through.
          {isBaseline && " Measured on the illustrative baseline."}
        </p>
      </CardContent>
    </Card>
  )
}
