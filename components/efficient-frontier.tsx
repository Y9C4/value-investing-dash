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
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "@/components/ui/panel"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import { formatPercent, percentTickFormatter } from "@/lib/format"

/**
 * The two views of a solved frontier: the curve itself, and the Sharpe ratio
 * measured along it.
 *
 * Both are presentational: they render whatever `data` they are handed and
 * never fetch. `PortfolioBuilder` owns the solve.
 */

/**
 * One data hue and one ink.
 *
 * The frontier is the only series on this chart that is a measurement: the
 * capital market line is a construction drawn through it, and the anchors are
 * two of its own points singled out. So the curve takes the app's data blue,
 * the CML recedes to chart chrome, and the anchors are ink — the same "never a
 * series" role `--primary` plays elsewhere. A third and fourth hue said
 * nothing that position on the curve was not already saying, and read as
 * decoration beside the rest of the site.
 */
const chartConfig = {
  envelope: { label: "Efficient frontier", color: "var(--color-series-1)" },
  cml: { label: "Capital market line", color: "var(--color-muted-foreground)" },
  anchor: { label: "Anchor portfolio", color: "var(--color-foreground)" },
} satisfies ChartConfig

/**
 * Past this many solved points the per-point markers stop being marks and
 * become a beaded chain, at which point the line carries the shape on its own
 * and they are dropped. Measured against the 60-point shipped baseline, which
 * is denser than any resolution worth asking the solver for.
 */
const MARKER_LIMIT = 40

/** The dot every solved portfolio gets, on both charts here. */
const pointDot = (color: string) => ({
  r: 3,
  fill: "var(--color-card)",
  stroke: color,
  strokeWidth: 1.75,
})

/**
 * A domain that frames the values, with a margin either side.
 *
 * Both charts here plot a frontier whose whole span is often three percentage
 * points wide, so an axis anchored at zero — or run flush to the data, which
 * clips the marker on the last point in half — wastes the panel. The margin is
 * a fraction of the span, so it scales with whatever was solved.
 */
function framed(values: number[]): [number, number] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  // A one-point envelope has no span of its own to pad against, so the pad
  // falls back to a fraction of the value itself.
  const spread = high - low || Math.abs(high) || 0.02
  const pad = spread * 0.14
  return [low - pad, high + pad]
}

function LegendLine({ dashed, color }: { dashed?: boolean; color: string }) {
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

/** The marker vocabulary, shared with the anchor table so the two agree. */
export function LegendDot({ hollow }: { hollow?: boolean }) {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0">
      <circle
        cx="5"
        cy="5"
        r={hollow ? 3.4 : 4}
        fill={hollow ? "var(--color-card)" : "var(--color-foreground)"}
        stroke="var(--color-foreground)"
        strokeWidth={hollow ? 1.6 : 0}
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
  solving,
}: {
  data: FrontierResponse
  isBaseline: boolean
  loading: boolean
  /** What the in-flight solve was asked for, for the progress readout. */
  solving?: { portfolios: number; assets: number; seconds: number }
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
  // A screened set can contain no portfolio that beats the risk-free asset,
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

  /**
   * The window is the frontier, not the origin.
   *
   * Anchoring x at 0 so the CML's risk-free intercept stayed on screen spent
   * four fifths of the plot on empty space and squeezed the curve — the only
   * thing here anyone is reading — into a sliver at the right-hand edge. The
   * axes are framed on the solved points instead, and the CML is clipped where
   * it leaves the window (`allowDataOverflow`) rather than being allowed to
   * dictate the scale.
   */
  const volatilities = data.envelope.map((point) => point.volatility)
  const returns = data.envelope.map((point) => point.return)
  const volatilityDomain = framed(volatilities)
  const returnDomain = framed(returns)
  // Volatility cannot be negative, and a tick at -1% on a small-span frontier
  // is a claim rather than a margin.
  volatilityDomain[0] = Math.max(0, volatilityDomain[0])

  // Framing on the curve makes both axes narrow — a frontier is often three
  // percentage points wide — and whole-percent ticks then print "13%" twice
  // running. The formatter takes its precision from the span it is labelling.
  const formatVolatilityTick = percentTickFormatter(
    volatilityDomain[1] - volatilityDomain[0]
  )
  const formatReturnTick = percentTickFormatter(
    returnDomain[1] - returnDomain[0]
  )

  // Every solved portfolio gets a marker; the anchors are two of these points
  // restated larger, not separate things.
  const showPoints = envelopeData.length <= MARKER_LIMIT

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Efficient frontier</PanelTitle>
        {/* The provenance of what's on screen is never ambiguous. */}
        {/* A solve is five to twenty seconds of real work. Saying what is
            being solved, over how many names, and how long it has been going
            is the difference between a page that is working and a page that
            looks stuck. */}
        <PanelMeta>
          {loading && solving
            ? `Solving ${solving.portfolios} portfolios over ${solving.assets} names · ${solving.seconds}s`
            : loading
              ? "Solving…"
              : isBaseline
                ? "Illustrative baseline"
                : `Live · ${data.n_portfolios} portfolios${data.cached ? " · cached" : ""}`}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        {/* Dimming while a solve is in flight is applied once, to every panel
            below the toolbar, by the results column that wraps this one — not
            here, so the frontier and the tables it sits beside fade together
            rather than each finding its own opacity. */}
        <ChartContainer config={chartConfig} className="aspect-auto h-[26rem] w-full">
          <ComposedChart margin={{ left: 12, right: 16, top: 12, bottom: 28 }}>
            <CartesianGrid vertical={false} stroke="var(--color-grid)" />
            <XAxis
              type="number"
              dataKey="volatility"
              name="Volatility"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              domain={volatilityDomain}
              allowDataOverflow
              tickFormatter={formatVolatilityTick}
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
              domain={returnDomain}
              allowDataOverflow
              tickFormatter={formatReturnTick}
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
            <ZAxis zAxisId="anchor" range={[150, 150]} />
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
            {/* Monotone interpolation, not straight segments. The frontier is
                a concave curve, so joining solved points with chords draws it
                fractionally inside itself and the seams show at low point
                counts. Monotone cubic preserves the ordering it is given and
                cannot invent a peak between two points, which is what makes it
                safe to use on a curve the reader is meant to trust, and it is
                what lets a budget-capped 24-point solve look like a 200-point
                one. */}
            <Line
              data={envelopeData}
              dataKey="return"
              name="Efficient frontier"
              type="monotone"
              stroke="var(--color-envelope)"
              strokeWidth={2}
              strokeLinecap="round"
              // A dot on every solved portfolio. The curve is interpolated
              // between them, and without markers nothing on screen separates
              // the handful of points that were actually solved from the shape
              // drawn through them.
              dot={showPoints ? pointDot("var(--color-envelope)") : false}
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
            />
            {/* The same circle, larger and in ink. Filled is the tangency,
                hollow the minimum-variance end — weight and fill rather than a
                hue that would then have to mean something. */}
            {anchors.map(({ key, title, portfolio }) => (
              <Scatter
                key={key}
                name={title}
                data={[
                  { volatility: portfolio.volatility, return: portfolio.return },
                ]}
                zAxisId="anchor"
                shape="circle"
                fill={
                  key === "maxSharpe"
                    ? "var(--color-anchor)"
                    : "var(--color-card)"
                }
                stroke="var(--color-anchor)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ChartContainer>

        {/* Legend is always present for >= 2 series. */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <LegendLine color="var(--color-series-1)" />
            Efficient frontier
          </span>
          {drawCml && (
            <span className="flex items-center gap-1.5">
              <LegendLine dashed color="var(--color-muted-foreground)" />
              Capital market line
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <LegendDot />
            Max Sharpe
          </span>
          <span className="flex items-center gap-1.5">
            <LegendDot hollow />
            Min volatility
          </span>
        </div>

        {/* The one thing here a reader cannot see for themselves: a line that
            is missing rather than merely off screen. The panel meta already
            says when the curve is the shipped baseline, and the rail already
            states the penalty the solve ran under, so both of those notes are
            gone. */}
        {!isBaseline && !drawCml && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No capital market line: nothing the constraints allow out-earned
            the {formatPercent(data.risk_free_rate)} risk-free rate, so there
            is no portfolio to draw one through.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}

/**
 * Sharpe ratio measured along the frontier.
 *
 * The frontier chart shows where the max-Sharpe portfolio sits; this shows
 * how confidently. A flat plateau means it is one of many nearly as good; a
 * sharp spike means it is a knife-edge worth distrusting.
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
  // Framed rather than run flush to the data: the marker on the first and last
  // point sat half outside the plot.
  const volatilityDomain = framed(points.map((point) => point.volatility))
  const formatVolatilityTick = percentTickFormatter(
    volatilityDomain[1] - volatilityDomain[0]
  )

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Sharpe along the frontier</PanelTitle>
        {/* The paragraph that used to sit under this chart said the peak, the
            volatility it sits at and that it is the portfolio every panel
            below describes. The first two are facts and belong in the meta;
            the third is said by those panels themselves. */}
        <PanelMeta>
          Peak {peak.sharpe.toFixed(2)} at {formatPercent(peak.volatility)}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
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
              domain={volatilityDomain}
              allowDataOverflow
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
            {/* Sized against the frontier chart's anchors: this is the same
                portfolio, and it should be the same dot. */}
            <ZAxis zAxisId="peak" range={[64, 64]} />
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
              // Same marker rule as the frontier: one dot per solved point.
              dot={
                points.length <= MARKER_LIMIT
                  ? pointDot("var(--color-series-1)")
                  : false
              }
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
            />
            <Scatter
              name="Max Sharpe"
              data={[peak]}
              dataKey="sharpe"
              zAxisId="peak"
              shape="circle"
              fill="var(--color-foreground)"
              stroke="var(--color-foreground)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LegendDot />
          Max Sharpe
          {isBaseline && " · illustrative baseline"}
        </div>
      </PanelBody>
    </Panel>
  )
}
