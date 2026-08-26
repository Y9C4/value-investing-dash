"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts"

import { Info } from "@/components/info"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Portfolio } from "@/lib/baseline-frontier"
import {
  formatPercent,
  formatSignedPercent,
  nicePercentAxis,
  percentTickFormatter,
} from "@/lib/format"

/**
 * What the portfolio is made of, from two angles that routinely disagree.
 *
 * A weight table alone cannot show that a 3% position in a volatile,
 * everything-correlated name carries several times the risk of a 3% position
 * in a defensive one. Plotting weight against its risk contribution puts that
 * gap on screen: the two bars are the difference between what the portfolio
 * owns and what it is actually exposed to.
 */

// How many names the chart plots. Past this the rows are thinner than their
// labels and the chart stops being read; the tail is summarised in a line of
// text and carried in full by the table.
const CHART_ROWS = 16
const ROW_HEIGHT = 26

const holdingsConfig = {
  weight: { label: "Weight", color: "var(--color-series-1)" },
  risk: { label: "Risk contribution", color: "var(--color-series-2)" },
} satisfies ChartConfig

// Sector exposure is magnitude by category, not identity: the axis labels name
// the sectors, so a second hue per sector would encode nothing the reader
// cannot already read. One sequential hue, sorted, is the whole design.
const sectorConfig = {
  weight: { label: "Weight", color: "var(--color-seq-3)" },
} satisfies ChartConfig

type Row = {
  ticker: string
  weight: number
  risk: number | null
  sector?: string
}

function buildRows(
  portfolio: Portfolio,
  sectors: Record<string, string> | undefined
): Row[] {
  const contributions = portfolio.risk_contributions
  return Object.entries(portfolio.weights)
    .map(([ticker, weight]) => ({
      ticker,
      weight,
      risk: contributions ? (contributions[ticker] ?? 0) : null,
      sector: sectors?.[ticker],
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
}

export function HoldingsBreakdown({
  portfolio,
  sectors,
  title,
}: {
  portfolio: Portfolio
  sectors?: Record<string, string>
  title: string
}) {
  const rows = buildRows(portfolio, sectors)
  const hasRisk = rows.some((row) => row.risk !== null)

  const chartData = rows.slice(0, CHART_ROWS)
  const tail = rows.slice(CHART_ROWS)
  // The tail is summarised in words rather than plotted as one "Other" bar.
  // Over the full index the cap binds on every name, so that bar would be
  // ~65% against a field of 3% ones and would flatten every comparison the
  // chart exists to make. The table below carries every row anyway.
  const tailWeight = tail.reduce((total, row) => total + row.weight, 0)

  const axis = nicePercentAxis(
    chartData.flatMap((row) => [row.weight, row.risk ?? 0])
  )

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {rows.length} {rows.length === 1 ? "holding" : "holdings"}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ChartContainer
          config={holdingsConfig}
          className="aspect-auto w-full"
          style={{ height: `${chartData.length * ROW_HEIGHT + 48}px` }}
        >
          <BarChart
            data={chartData}
            layout="vertical"
            // 2px of surface between the paired bars, per the mark spec.
            barGap={2}
            barCategoryGap="22%"
            margin={{ left: 4, right: 56, top: 4, bottom: 12 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--color-grid)" />
            <XAxis
              type="number"
              domain={axis.domain}
              ticks={axis.ticks}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickFormatter={percentTickFormatter(
                axis.domain[1] - axis.domain[0]
              )}
            />
            <YAxis
              type="category"
              dataKey="ticker"
              tickLine={false}
              axisLine={false}
              width={72}
              tickMargin={6}
              className="font-mono text-xs"
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-grid)", fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full justify-between gap-4">
                      <span className="text-muted-foreground">
                        {holdingsConfig[name as keyof typeof holdingsConfig]
                          ?.label ?? name}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatSignedPercent(Number(value))}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <Bar
              dataKey="weight"
              fill="var(--color-weight)"
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            >
              {/* Only the weight bar is labelled. A number on every mark of a
                  paired chart doubles the ink and halves the legibility. */}
              {!hasRisk && (
                <LabelList
                  dataKey="weight"
                  position="right"
                  offset={8}
                  className="fill-muted-foreground font-mono text-xs"
                  formatter={(value) => formatPercent(Number(value))}
                />
              )}
            </Bar>
            {hasRisk && (
              <Bar
                dataKey="risk"
                fill="var(--color-risk)"
                radius={[0, 3, 3, 0]}
                isAnimationActive={false}
              />
            )}
          </BarChart>
        </ChartContainer>

        {tail.length > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Showing the {CHART_ROWS} largest positions. The remaining{" "}
            <span className="font-mono tabular-nums">{tail.length}</span>{" "}
            {tail.length === 1 ? "holding accounts" : "holdings account"} for{" "}
            <span className="font-mono tabular-nums">
              {formatPercent(tailWeight)}
            </span>{" "}
            of the portfolio and are listed in full below.
          </p>
        )}

        {hasRisk ? (
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span
                className="size-3 shrink-0"
                style={{ background: "var(--color-series-1)" }}
                aria-hidden="true"
              />
              Weight — the share of capital in the name
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="size-3 shrink-0"
                style={{ background: "var(--color-series-2)" }}
                aria-hidden="true"
              />
              Risk contribution — its share of portfolio variance
            </span>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Risk contributions are measured from the covariance matrix, so they
            arrive with a live solve rather than with the shipped baseline.
          </p>
        )}

        <div className="max-h-96 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticker</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                {hasRisk && (
                  <TableHead className="text-right">Risk share</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.ticker}>
                  <TableCell className="font-mono">{row.ticker}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.sector ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatSignedPercent(row.weight)}
                  </TableCell>
                  {hasRisk && (
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.risk === null
                        ? "—"
                        : formatSignedPercent(row.risk)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

export function SectorExposure({
  portfolio,
  sectors,
}: {
  portfolio: Portfolio
  sectors: Record<string, string>
}) {
  const totals = new Map<string, number>()
  for (const [ticker, weight] of Object.entries(portfolio.weights)) {
    const sector = sectors[ticker]
    if (!sector) continue
    totals.set(sector, (totals.get(sector) ?? 0) + weight)
  }

  const data = [...totals.entries()]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight)

  if (data.length === 0) return null

  const covered = data.reduce((total, row) => total + row.weight, 0)
  const top = data[0]
  const axis = nicePercentAxis(data.map((row) => row.weight))

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <CardTitle>Sector exposure</CardTitle>
          <Info title="Sector exposure" side="bottom">
            Mean-variance optimisation has no notion of a sector &mdash; it will
            happily concentrate one if the covariance matrix says those names
            diversify each other. This chart is the check on that, not a
            constraint the solver was given.
          </Info>
        </span>
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {data.length} sectors
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ChartContainer
          config={sectorConfig}
          className="aspect-auto w-full"
          style={{ height: `${data.length * 30 + 40}px` }}
        >
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 4, right: 60, top: 4, bottom: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="var(--color-grid)" />
            <XAxis
              type="number"
              domain={axis.domain}
              ticks={axis.ticks}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickFormatter={percentTickFormatter(
                axis.domain[1] - axis.domain[0]
              )}
            />
            <YAxis
              type="category"
              dataKey="sector"
              tickLine={false}
              axisLine={false}
              // Wide enough for "Communication Services", the longest GICS
              // label the profile table emits.
              width={170}
              tickMargin={6}
              className="text-xs"
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-grid)", fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <span className="font-mono tabular-nums">
                      {formatSignedPercent(Number(value))}
                    </span>
                  )}
                />
              }
            />
            {/* One hue for every bar: magnitude is carried by length, and the
                sectors are already sorted. Giving the largest its own step
                would be colour following rank rather than the entity, and it
                inverts in dark mode, where the ramp runs the other way. */}
            <Bar
              dataKey="weight"
              fill="var(--color-weight)"
              radius={[0, 3, 3, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="weight"
                position="right"
                offset={8}
                className="fill-muted-foreground font-mono text-xs"
                formatter={(value) => formatPercent(Number(value))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {top.sector} is the largest exposure at{" "}
          <span className="font-mono tabular-nums">
            {formatPercent(top.weight)}
          </span>
          .
          {covered < 0.995 && (
            <>
              {" "}
              <span className="font-mono tabular-nums">
                {formatPercent(1 - covered)}
              </span>{" "}
              of the portfolio has no sector on file and is not shown.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
