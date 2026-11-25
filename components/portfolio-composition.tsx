"use client"

import Link from "next/link"
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
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
 *
 * The chart and the ledger are separate panels rather than one long one. They
 * answer different questions: "where is the exposure lopsided" against "what
 * exactly is held", and keeping them apart lets the chart sit beside the
 * sector split, which is the comparison a reader actually makes.
 */

// How many names the chart plots, and how much height each one gets.
//
// Ten rather than sixteen, in about the same total height: the point of this
// chart is the gap between the paired bars, and at sixteen rows each mark was
// 9px tall, which is thin enough that a two-percentage-point difference
// between them is invisible. Measured, the pair is now ~16px each. Fewer rows
// alone would not have done it: the height has to stay and be spent on the
// remaining rows, which is why this went up as the count came down.
//
// The tail is summarised in a line below and carried in full by the ledger.
const CHART_ROWS = 10
const ROW_HEIGHT = 46

/**
 * Weight and risk share, as a validated pair per theme.
 *
 * They used to be two steps of the indigo ramp, which is the composite score's
 * colour everywhere else and too close a pair to tell apart at a glance. Blue
 * (the series identity) for weight, magenta for risk share; the pair passes the
 * dataviz validator in both themes against the card surface (light #2f6fd6 /
 * #c2477f on #fffdf8, dark #5f8be6 / #d55181 on #1c1a17: lightness band,
 * chroma, CVD ΔE ≥ 14, normal-vision ΔE ≥ 24, contrast ≥ 3:1). Risk also wears
 * a hatch, so the pair never rests on hue alone. Set on each panel, since a
 * chart config cannot follow this app's `data-theme` switch.
 */
const PAIR_COLORS =
  "[--weight-fill:#2f6fd6] [--risk-fill:#c2477f] dark:[--weight-fill:#5f8be6] dark:[--risk-fill:#d55181]"

const RISK_HATCH = "repeating-linear-gradient(-45deg, var(--risk-fill) 0 3px, var(--color-card) 3px 4.5px)"

const holdingsConfig = {
  weight: { label: "Weight", color: "var(--weight-fill)" },
  risk: { label: "Risk share", color: "var(--risk-fill)" },
} satisfies ChartConfig

// Sector exposure is magnitude by category, not identity: the axis labels name
// the sectors, so a second hue per sector would encode nothing the reader
// cannot already read. The weight colour, sorted, is the whole design.
const sectorConfig = {
  weight: { label: "Weight", color: "var(--weight-fill)" },
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

export function HoldingsChart({
  portfolio,
  sectors,
  scope,
  title = "Weight vs share of risk",
}: {
  portfolio: Portfolio
  sectors?: Record<string, string>
  /** Which portfolio these are the holdings of. Named on every panel that
      describes one, because the page solves a whole frontier and only ever
      breaks down a single point on it. */
  scope: string
  title?: string
}) {
  const rows = buildRows(portfolio, sectors)
  const hasRisk = rows.some((row) => row.risk !== null)

  const chartData = rows.slice(0, CHART_ROWS)
  const tail = rows.slice(CHART_ROWS)
  // The tail is summarised in words rather than plotted as one "Other" bar.
  // Over the full index the cap binds on every name, so that bar would be
  // ~65% against a field of 3% ones and would flatten every comparison the
  // chart exists to make. The ledger below carries every row anyway.
  const tailWeight = tail.reduce((total, row) => total + row.weight, 0)

  const axis = nicePercentAxis(
    chartData.flatMap((row) => [row.weight, row.risk ?? 0])
  )

  return (
    <Panel className={PAIR_COLORS}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        <PanelMeta>
          {scope} · top {chartData.length} of {rows.length}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <figure>
        <figcaption className="sr-only">
          Weight{hasRisk ? " and share of portfolio risk" : ""} for the{" "}
          {chartData.length} largest positions:{" "}
          {chartData
            .map(
              (row) =>
                `${row.ticker} ${formatPercent(row.weight)}${row.risk === null ? "" : ` weight, ${formatPercent(row.risk)} risk`}`
            )
            .join("; ")}
          .
        </figcaption>
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
            // 12%, not 22%. The category band is the height budget for the
            // pair, so between this and ROW_HEIGHT the two of them decide bar
            // thickness, and with ten rows there is room to spend it on the
            // marks rather than on the gaps between them.
            barCategoryGap="12%"
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
              className="font-figure text-xs"
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
                      <span className="font-figure tabular-nums">
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
                  className="fill-muted-foreground font-figure text-xs"
                  formatter={(value) => formatPercent(Number(value))}
                />
              )}
            </Bar>
            {hasRisk && (
              <Bar
                dataKey="risk"
                fill="url(#risk-hatch)"
                radius={[0, 3, 3, 0]}
                isAnimationActive={false}
              />
            )}
            {/* The texture half of the pair's encoding; see PAIR_COLORS. */}
            <defs>
              <pattern
                id="risk-hatch"
                width="4.5"
                height="4.5"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="4.5" height="4.5" fill="var(--risk-fill)" />
                <rect width="1.5" height="4.5" fill="var(--color-card)" />
              </pattern>
            </defs>
          </BarChart>
        </ChartContainer>
        </figure>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {hasRisk ? (
            <>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0"
                  style={{ background: "var(--weight-fill)" }}
                  aria-hidden="true"
                />
                Weight
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2.5 shrink-0"
                  style={{ background: RISK_HATCH }}
                  aria-hidden="true"
                />
                Risk share
              </span>
            </>
          ) : (
            <span>Run the optimisation to see risk shares.</span>
          )}
          {tail.length > 0 && (
            <span>
              {tail.length} more in the holdings table ·{" "}
              {formatPercent(tailWeight)}
            </span>
          )}
        </div>
      </PanelBody>
    </Panel>
  )
}

/**
 * Every position, in full.
 *
 * The tickers are links. A holding is a company, and the page that says what
 * the models think it is worth is one click away; a portfolio you cannot
 * interrogate name by name is a list of symbols. The weight also carries a
 * bar: a column of percentages is read one cell at a time, and the shape of a
 * book is the first thing anyone wants from it.
 */
export function HoldingsTable({
  portfolio,
  sectors,
  scope,
  title = "Holdings",
}: {
  portfolio: Portfolio
  sectors?: Record<string, string>
  /** Which portfolio is being listed; see `HoldingsChart`. */
  scope: string
  title?: string
}) {
  const rows = buildRows(portfolio, sectors)
  const hasRisk = rows.some((row) => row.risk !== null)
  const peak = Math.max(
    ...rows.map((row) => Math.abs(row.weight)),
    Number.EPSILON
  )

  return (
    <Panel className={`@container ${PAIR_COLORS}`}>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        <PanelMeta>
          {scope} · {rows.length}{" "}
          {rows.length === 1 ? "position" : "positions"}
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="px-0 py-0">
        <Table containerClassName="overflow-auto max-h-[28rem]">
          <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-0">
            {/* An inset shadow rather than a border: a sticky row's own border
                is painted with the cell and scrolls out from under it. */}
            <TableRow className="shadow-[inset_0_-1px_0_0_var(--color-border)] hover:bg-card">
              <TableHead>Ticker</TableHead>
              {/* Dropped in a narrow panel so the risk share stays on screen. */}
              <TableHead className="hidden @md:table-cell">Sector</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              {hasRisk && (
                <TableHead className="text-right">Risk share</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.ticker} className="group">
                <TableCell>
                  <Link
                    href={`/stocks/${row.ticker}`}
                    className="font-figure font-medium group-hover:underline"
                  >
                    {row.ticker}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground @md:table-cell">
                  {row.sector ?? "—"}
                </TableCell>
                <TableCell>
                  <span className="flex items-center justify-end gap-2.5">
                    <span
                      // Only where the table has the width for it; in a
                      // half-width column it pushed the risk share off.
                      className="hidden h-1.5 w-20 shrink-0 bg-muted @5xl:block"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${((Math.abs(row.weight) / peak) * 100).toFixed(1)}%`,
                          background:
                            row.weight < 0
                              ? "var(--color-overvalued)"
                              : "var(--weight-fill)",
                        }}
                      />
                    </span>
                    <span className="font-figure tabular-nums">
                      {formatSignedPercent(row.weight)}
                    </span>
                  </span>
                </TableCell>
                {hasRisk && (
                  <TableCell className="text-right font-figure tabular-nums">
                    {row.risk === null ? "—" : formatSignedPercent(row.risk)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}

export function SectorExposure({
  portfolio,
  sectors,
  scope,
}: {
  portfolio: Portfolio
  sectors: Record<string, string>
  /** Which portfolio is being split up; see `HoldingsChart`. */
  scope: string
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
  const axis = nicePercentAxis(data.map((row) => row.weight))

  return (
    <Panel className={PAIR_COLORS}>
      <PanelHeader>
        <PanelTitle>Sector exposure</PanelTitle>
        <PanelMeta>
          {scope} · {data.length} sectors
        </PanelMeta>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <figure>
        <figcaption className="sr-only">
          Portfolio weight by sector:{" "}
          {data.map((row) => `${row.sector} ${formatPercent(row.weight)}`).join("; ")}.
        </figcaption>
        <ChartContainer
          config={sectorConfig}
          className="aspect-auto w-full"
          style={{ height: `${data.length * 32 + 40}px` }}
        >
          <BarChart
            data={data}
            layout="vertical"
            barCategoryGap="18%"
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
              // Narrow enough to leave a phone room for the bars; recharts
              // wraps "Communication Services" onto two lines within it.
              width={124}
              tickMargin={6}
              className="text-xs"
            />
            <ChartTooltip
              cursor={{ fill: "var(--color-grid)", fillOpacity: 0.4 }}
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <span className="font-figure tabular-nums">
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
                className="fill-muted-foreground font-figure text-xs"
                formatter={(value) => formatPercent(Number(value))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        </figure>

        {/* The bars already say which sector is largest and by how much, so
            the sentence that restated it is gone. What survives is the one
            thing the chart cannot show: weight that is missing from it. */}
        {covered < 0.995 && (
          <p className="text-xs text-muted-foreground">
            {formatPercent(1 - covered)} of the portfolio has no sector
            information and is not shown.
          </p>
        )}
      </PanelBody>
    </Panel>
  )
}
