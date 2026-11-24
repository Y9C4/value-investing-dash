"use client"

import { useState } from "react"
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
} from "@/components/ui/chart"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import {
  MIN_VARIANCE_LABEL,
  pointLabel,
  TANGENCY_LABEL,
  type SelectedPortfolio,
} from "@/lib/portfolio-selection"
import { formatPercent } from "@/lib/format"

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

/**
 * The dot every solved portfolio gets, on both charts here. Inert: recharts
 * re-stacks these above the hover layer after a re-render, where they would
 * swallow the pointer meant for the disc beneath.
 */
const pointDot = (color: string) => ({
  className: "pointer-events-none",
  r: 3,
  fill: "var(--color-card)",
  stroke: color,
  strokeWidth: 1.75,
})

// Round steps a reader can do arithmetic on; recharts' own placement printed
// axes like 3% / 18% / 33% / 49%.
const NICE_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5]

/**
 * A percent axis framed on the values, with round ticks.
 *
 * Unlike `nicePercentAxis` it does not force zero into view: a screened
 * frontier is often three percentage points wide, and an axis anchored at zero
 * squeezes it into a sliver. The values are padded before rounding so the
 * marker on the last point is never cut in half by the plot edge.
 */
function niceAxis(values: number[], floor?: number) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.abs(max) * 0.1 || 0.01
  const step = NICE_STEPS.find((s) => s >= span / 5) ?? 1
  let low = Math.floor((min - span * 0.04) / step) * step
  const high = Math.ceil((max + span * 0.04) / step) * step
  if (floor !== undefined) low = Math.max(floor, low)

  const ticks: number[] = []
  for (let tick = low; tick <= high + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(6)))
  }
  const digits = step < 0.01 ? 1 : 0
  return {
    domain: [Number(low.toFixed(6)), Number(high.toFixed(6))] as [number, number],
    ticks,
    format: (value: number) => `${(value * 100).toFixed(digits)}%`,
  }
}

/** What the frontier tooltip reads off whichever mark is hovered. */
type Point = { name: string; volatility: number; return: number; sharpe: number }
type HoverPoint = Point & { select?: SelectedPortfolio }

function PointTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload?: Partial<Point> }[]
}) {
  const point = payload?.find((item) => item.payload?.name)?.payload
  if (!active || !point) return null
  return <PointCard point={point} />
}

function PointCard({ point }: { point: Partial<Point> }) {
  const rows: [string, string][] = [
    ["Return", formatPercent(point.return ?? 0)],
    ["Volatility", formatPercent(point.volatility ?? 0)],
  ]
  if (typeof point.sharpe === "number") rows.push(["Sharpe", point.sharpe.toFixed(2)])

  return (
    <div className="grid min-w-36 gap-1 bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm ring-1 ring-foreground/10">
      <span className="font-medium">{point.name}</span>
      {rows.map(([label, value]) => (
        <span key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono tabular-nums">{value}</span>
        </span>
      ))}
    </div>
  )
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

/**
 * The benchmark's own mark: a diamond, not a circle.
 *
 * The market is a real measurement, scored the same way every point on the
 * curve is — it earns the anchors' ink rather than the CML's chrome — but it
 * is not a portfolio and cannot be selected, so it needed a shape the reader
 * would never mistake for one more circle on the curve.
 */
function LegendDiamond() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0">
      <path
        d="M5,0.5 L9.5,5 L5,9.5 L0.5,5 Z"
        fill="var(--color-card)"
        stroke="var(--color-foreground)"
        strokeWidth="1.6"
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
  selected,
  onSelect,
}: {
  data: FrontierResponse
  isBaseline: boolean
  /** Which portfolio the page is describing; drawn here as a ring. */
  selected: SelectedPortfolio
  onSelect: (next: SelectedPortfolio) => void
}) {
  // The index rides along in the datum so a click can say which point it hit,
  // and the name and Sharpe so the tooltip can say which portfolio it is.
  const envelopeData = data.envelope.map((point, index) => ({
    name: pointLabel(index),
    volatility: point.volatility,
    return: point.return,
    sharpe: point.sharpe,
    index,
    selectable: Boolean(point.weights),
  }))

  /**
   * The window is the frontier, not the origin.
   *
   * Anchoring x at 0 so the CML's risk-free intercept stayed on screen spent
   * four fifths of the plot on empty space for a narrow screened frontier. The
   * axes are framed on the solved points (and the benchmark, so a "no" is
   * shown rather than clipped away), and the CML is cut where it leaves them.
   */
  const volatilities = data.envelope.map((point) => point.volatility)
  const returns = data.envelope.map((point) => point.return)
  if (data.market) {
    volatilities.push(data.market.volatility)
    returns.push(data.market.return)
  }
  // Volatility cannot be negative, and a tick at -1% is a claim, not a margin.
  const xAxis = niceAxis(volatilities, 0)
  const yAxis = niceAxis(returns)

  // A screened set can contain no portfolio that beats the risk-free asset,
  // routine when the filters select on cheapness rather than momentum. The
  // frontier is still real, but a line tangent to it would slope downwards and
  // claim that risk is paid negatively, so it is withheld and said out loud.
  const drawCml = hasTangency(data)
  const cmlSlope =
    data.max_sharpe.volatility > 0
      ? (data.max_sharpe.return - data.risk_free_rate) / data.max_sharpe.volatility
      : 0
  // The line clipped to the plot analytically: recharts lets a line run past
  // the top of the plot even with `allowDataOverflow`.
  const cmlAt = (volatility: number) => ({
    volatility,
    return: data.risk_free_rate + cmlSlope * volatility,
  })
  const volatilityAtReturn = (target: number) =>
    (target - data.risk_free_rate) / cmlSlope
  const cmlStart = Math.max(xAxis.domain[0], volatilityAtReturn(yAxis.domain[0]))
  const cmlEnd = Math.min(xAxis.domain[1], volatilityAtReturn(yAxis.domain[1]))
  const cmlData =
    drawCml && cmlEnd > cmlStart ? [cmlAt(cmlStart), cmlAt(cmlEnd)] : []

  const anchors = [
    { key: "maxSharpe" as const, title: TANGENCY_LABEL, portfolio: data.max_sharpe },
    { key: "minVolatility" as const, title: MIN_VARIANCE_LABEL, portfolio: data.min_volatility },
  ]

  // Every solved portfolio gets a marker; the anchors are two of these points
  // restated larger, not separate things.
  const showPoints = envelopeData.length <= MARKER_LIMIT

  // Only points the response actually carries weights for can be selected —
  // the shipped baseline and any pre-selection cached solve carry none — and
  // only while their markers are visible, so a click never has to be aimed at
  // something that is not drawn.
  //
  // The tangency and the benchmark ride in the same layer, which is what every
  // tooltip on this chart is read from (see `hovered` below).
  const pickable: HoverPoint[] = [
    ...(showPoints ? envelopeData.filter((p) => p.selectable && p.index > 0) : []).map(
      (p) => ({ ...p, select: { kind: "envelope", index: p.index } as const })
    ),
    ...anchors.map(({ key, title, portfolio }) => ({
      name: title,
      volatility: portfolio.volatility,
      return: portfolio.return,
      sharpe: portfolio.sharpe,
      select: { kind: key },
    })),
    ...(data.market ? [{ name: "S&P 500", ...data.market }] : []),
  ]

  // Where to draw the selection ring. The anchors resolve to their own exact
  // coordinates rather than to an envelope index, because the tangency is a
  // refinement that generally sits between two solved points.
  const selectedPoint =
    selected.kind === "maxSharpe"
      ? { volatility: data.max_sharpe.volatility, return: data.max_sharpe.return }
      : selected.kind === "minVolatility"
        ? {
            volatility: data.min_volatility.volatility,
            return: data.min_volatility.return,
          }
        : (envelopeData[selected.index] ?? null)

  // Recharts 3 hands a single-point Scatter (the tangency, the benchmark) an
  // empty tooltip payload, so this chart draws its own: the hovered disc and
  // where it sits, read straight off the hover layer below.
  const [hovered, setHovered] = useState<{ point: HoverPoint; x: number; y: number } | null>(null)
  const flip = hovered !== null && hovered.point.volatility > (xAxis.domain[0] + xAxis.domain[1]) / 2

  const summary =
    `Efficient frontier of ${data.envelope.length} portfolios, volatility ` +
    `${formatPercent(Math.min(...data.envelope.map((p) => p.volatility)))} to ` +
    `${formatPercent(Math.max(...data.envelope.map((p) => p.volatility)))}. ` +
    `${TANGENCY_LABEL}: ${formatPercent(data.max_sharpe.return)} return at ` +
    `${formatPercent(data.max_sharpe.volatility)} volatility, Sharpe ${data.max_sharpe.sharpe.toFixed(2)}. ` +
    (data.market
      ? `S&P 500: ${formatPercent(data.market.return)} return at ${formatPercent(data.market.volatility)} volatility, Sharpe ${data.market.sharpe.toFixed(2)}.`
      : "")

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Efficient frontier</PanelTitle>
        {/* Provenance (live, nightly, restored) is stated once, in the
            toolbar; this says only what the curve is made of. */}
        <PanelMeta>
          {isBaseline
            ? "Illustrative baseline"
            : `${data.n_portfolios} solved points${data.resolution_capped ? ` (capped from ${data.n_portfolios_requested})` : ""}`}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <figure className="flex flex-col">
          <figcaption className="sr-only">{summary}</figcaption>
          {/* Wide rather than tall: the frontier is the page's hero, and a
              2:1 plot is where the hook of the curve reads. */}
          <div className="relative">
          {hovered && (
            <div
              className="pointer-events-none absolute z-10"
              style={{
                left: hovered.x,
                top: hovered.y,
                transform: `translate(${flip ? "calc(-100% - 14px)" : "14px"}, -50%)`,
              }}
            >
              <PointCard point={hovered.point} />
            </div>
          )}
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-80 w-full sm:aspect-[2/1] sm:h-auto"
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
              domain={xAxis.domain}
              ticks={xAxis.ticks}
              allowDataOverflow
              tickFormatter={xAxis.format}
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
              domain={yAxis.domain}
              ticks={yAxis.ticks}
              allowDataOverflow
              tickFormatter={yAxis.format}
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
            {/* The selection ring sits outside whatever mark it is ringing —
                at the anchors' own size it just filled the hollow one in. */}
            <ZAxis zAxisId="selected" range={[420, 420]} />
            {cmlData.length > 0 && (
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
            )}
            {/* Monotone interpolation, not straight segments. The frontier is
                a concave curve, so joining solved points with chords draws it
                fractionally inside itself and the seams show at low point
                counts. Monotone cubic preserves the ordering it is given and
                cannot invent a peak between two points, which is what makes it
                safe to use on a curve the reader is meant to trust. */}
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
                data={[
                  {
                    name: title,
                    volatility: portfolio.volatility,
                    return: portfolio.return,
                    sharpe: portfolio.sharpe,
                  },
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
                tooltipType="none"
                // Inert like the line dots: the hover layer handles the pointer.
                className="pointer-events-none"
              />
            ))}
            {/* The benchmark every point on this curve is implicitly
                competing with — a diamond rather than one more circle, so it
                reads as a different kind of mark: measured the same way, but
                not a portfolio and not something to click. */}
            {data.market && (
              <Scatter
                data={[
                  {
                    name: "S&P 500",
                    volatility: data.market.volatility,
                    return: data.market.return,
                    sharpe: data.market.sharpe,
                  },
                ]}
                zAxisId="anchor"
                shape="diamond"
                fill="var(--color-card)"
                stroke="var(--color-anchor)"
                strokeWidth={2}
                isAnimationActive={false}
                legendType="none"
                tooltipType="none"
                className="pointer-events-none"
              />
            )}
            {/* The ring around whichever portfolio the page is describing.
                Drawn before the click layer so the transparent hit targets
                still sit on top of it. */}
            {selectedPoint && (
              <Scatter
                data={[selectedPoint]}
                zAxisId="selected"
                shape="circle"
                fill="none"
                stroke="var(--color-anchor)"
                strokeWidth={2}
                isAnimationActive={false}
                tooltipType="none"
                legendType="none"
                className="pointer-events-none"
              />
            )}
            {/* The selection and tooltip surface: one transparent disc per
                solved point, larger than the mark under it. Points are gated on
                the same threshold as the visible dots, so the chart is never
                clickable where it does not look clickable — past that density
                the list beside it is how a portfolio gets picked. */}
            <Scatter
              data={pickable}
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
              shape={(props: unknown) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: HoverPoint }
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={9}
                    fill="transparent"
                    className={payload.select ? "cursor-pointer" : undefined}
                    onClick={() => payload.select && onSelect(payload.select)}
                    // Same-name guard: the datum is rebuilt every render, and a
                    // new object here would re-render forever under a still pointer.
                    onMouseEnter={() =>
                      setHovered((current) =>
                        current?.point.name === payload.name ? current : { point: payload, x: cx, y: cy }
                      )
                    }
                    onMouseLeave={() => setHovered(null)}
                  />
                )
              }}
            />
          </ComposedChart>
          </ChartContainer>
          </div>
        </figure>

        {/* Legend is always present for >= 2 series. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
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
            {TANGENCY_LABEL}
          </span>
          <span className="flex items-center gap-1.5">
            <LegendDot hollow />
            {MIN_VARIANCE_LABEL}
          </span>
          {data.market && (
            <span className="flex items-center gap-1.5">
              <LegendDiamond />
              S&P 500
            </span>
          )}
        </div>

        {/* The one thing here a reader cannot see for themselves: a line that
            is missing rather than merely off screen. */}
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
  const points = data.envelope.map((point, index) => ({
    name: pointLabel(index),
    volatility: point.volatility,
    return: point.return,
    sharpe: point.sharpe,
  }))

  if (points.length < 2) return null

  const peak = points.reduce((best, point) =>
    point.sharpe > best.sharpe ? point : best
  )
  const anyNegative = points.some((point) => point.sharpe < 0)
  const xAxis = niceAxis(
    points.map((point) => point.volatility),
    0
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
        <figure>
        <figcaption className="sr-only">
          Sharpe ratio along the efficient frontier, peaking at{" "}
          {peak.sharpe.toFixed(2)} at {formatPercent(peak.volatility)} volatility.
        </figcaption>
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
              domain={xAxis.domain}
              ticks={xAxis.ticks}
              allowDataOverflow
              tickFormatter={xAxis.format}
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
              content={<PointTooltip />}
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
              name="Tangency (max Sharpe)"
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
        </figure>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LegendDot />
          {TANGENCY_LABEL}
          {isBaseline && " · illustrative baseline"}
        </div>
      </PanelBody>
    </Panel>
  )
}
