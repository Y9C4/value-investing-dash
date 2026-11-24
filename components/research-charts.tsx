"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { STRATEGIES, formatMonth, type StrategyKey } from "@/lib/evidence"

/**
 * The backtest charts on /research. Data arrives from the server already
 * shaped; these only draw. Colours are the `--cat-*` tokens (validated with the
 * dataviz skill against both card surfaces) and follow the strategy, never its
 * rank, so a strategy is the same colour in every chart.
 */

const STRATEGY_CONFIG: ChartConfig = STRATEGIES
const KEYS = Object.keys(STRATEGIES) as StrategyKey[]

/** Evenly spaced ticks from −lim to lim, in steps of `step`. */
const ticks = (lim: number, step: number) =>
  Array.from({ length: Math.round((2 * lim) / step) + 1 }, (_, i) => Math.round((-lim + i * step) * 1e6) / 1e6)

const signed = (x: number, digits: number) =>
  `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`

export function CumulativeIcChart({
  rows,
  holdoutStart,
  holdoutEnd,
}: {
  rows: ({ date: string } & Record<StrategyKey, number>)[]
  holdoutStart: string
  holdoutEnd: string
}) {
  return (
    <ChartContainer config={STRATEGY_CONFIG} className="aspect-auto h-72 w-full">
      <LineChart data={rows} margin={{ left: 4, right: 12, top: 20 }}>
        <CartesianGrid vertical={false} stroke="var(--color-grid)" />
        <ReferenceArea
          x1={holdoutStart}
          x2={holdoutEnd}
          fill="var(--color-muted)"
          fillOpacity={0.6}
          label={{ value: "Holdout", position: "insideTopLeft", fill: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <ReferenceLine y={0} stroke="var(--color-axis)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={formatMonth}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => `Through ${formatMonth(String(value))}`}
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">
                    {STRATEGIES[name as StrategyKey]?.label}
                  </span>
                  <span className="font-figure">{Number(value).toFixed(2)}</span>
                </span>
              )}
            />
          }
        />
        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => KEYS.indexOf(item.dataKey as StrategyKey)}
        />
        {(Object.keys(STRATEGIES) as StrategyKey[]).map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="linear"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

const SAMPLE_LABELS = { development: "Development", holdout: "Holdout" }

/** Mean next-month factor-adjusted return by quintile, development beside holdout. */
export function QuintileChart({
  strategy,
  rows,
  lim,
}: {
  strategy: StrategyKey
  rows: { quintile: string; development: number; holdout: number }[]
  /** Shared y-limit, so the three panels compare on one scale. */
  lim: number
}) {
  const color = STRATEGIES[strategy].color
  return (
    <ChartContainer
      config={{
        development: { label: "Development", color },
        holdout: { label: "Holdout", color },
      }}
      className="aspect-auto h-52 w-full"
    >
      <BarChart data={rows} margin={{ left: 4, right: 4, top: 8 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="var(--color-grid)" />
        <ReferenceLine y={0} stroke="var(--color-axis)" />
        <XAxis dataKey="quintile" tickLine={false} axisLine={false} tickMargin={6} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          domain={[-lim, lim]}
          ticks={ticks(lim, lim / 2)}
          tickFormatter={(v: number) => `${signed(v * 100, 1)}%`}
        />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">
                    {SAMPLE_LABELS[name as keyof typeof SAMPLE_LABELS]}
                  </span>
                  <span className="font-figure">{signed(Number(value) * 100, 2)}% / month</span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="development" fill="var(--color-development)" radius={[2, 2, 0, 0]} />
        {/* Holdout: the same hue, hollow, so the two samples differ by more than colour. */}
        <Bar dataKey="holdout" radius={[2, 2, 0, 0]}>
          {rows.map((row) => (
            <Cell
              key={row.quintile}
              fill="var(--color-holdout)"
              fillOpacity={0.25}
              stroke="var(--color-holdout)"
              strokeWidth={1.5}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/**
 * Calibration: decile mean predicted alpha against realised, with the 45°
 * line a calibrated forecast would follow.
 */
export function CalibrationChart({
  development,
  holdout,
}: {
  development: [number, number][]
  holdout: [number, number][]
}) {
  const toPoints = (rows: [number, number][]) =>
    rows.map(([predicted, realised], i) => ({ predicted, realised, decile: i + 1 }))
  const all = [...development, ...holdout].flat()
  const lim = Math.ceil(Math.max(...all.map(Math.abs)) * 20) / 20

  return (
    <ChartContainer
      config={{
        development: { label: "Development", color: "var(--cat-3)" },
        holdout: { label: "Holdout", color: "var(--cat-3)" },
      }}
      className="aspect-square max-h-80 w-full"
    >
      <ScatterChart margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
        <CartesianGrid stroke="var(--color-grid)" />
        <ReferenceLine
          segment={[
            { x: -lim, y: -lim },
            { x: lim, y: lim },
          ]}
          stroke="var(--color-muted-foreground)"
          strokeDasharray="3 3"
          label={{ value: "45°: calibrated", position: "insideTopRight", fill: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <ReferenceLine x={0} stroke="var(--color-axis)" />
        <ReferenceLine y={0} stroke="var(--color-axis)" />
        <XAxis
          type="number"
          dataKey="predicted"
          domain={[-lim, lim]}
          ticks={ticks(lim, lim > 0.15 ? 0.1 : 0.05)}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${signed(v * 100, 0)}`}
          label={{ value: "Predicted, pp a year", position: "insideBottom", offset: -4, fill: "var(--color-muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="realised"
          domain={[-lim, lim]}
          ticks={ticks(lim, lim > 0.15 ? 0.1 : 0.05)}
          tickLine={false}
          axisLine={false}
          width={36}
          tickFormatter={(v: number) => `${signed(v * 100, 0)}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(_, __, item) => {
                const p = item.payload as { predicted: number; realised: number; decile: number }
                return (
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">Decile {p.decile}</span>
                    <span className="text-muted-foreground">
                      Predicted <span className="font-figure text-foreground">{signed(p.predicted * 100, 1)} pp</span>, realised{" "}
                      <span className="font-figure text-foreground">{signed(p.realised * 100, 1)} pp</span>
                    </span>
                  </span>
                )
              }}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Scatter name="development" data={toPoints(development)} fill="var(--color-development)" shape="circle" line={{ strokeWidth: 1.5 }} />
        <Scatter
          name="holdout"
          data={toPoints(holdout)}
          fill="var(--color-holdout)"
          fillOpacity={0.2}
          stroke="var(--color-holdout)"
          strokeWidth={1.5}
          shape="triangle"
          line={{ stroke: "var(--color-holdout)", strokeWidth: 1.5, strokeDasharray: "4 3" }}
        />
      </ScatterChart>
    </ChartContainer>
  )
}
