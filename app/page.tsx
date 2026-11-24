import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import { SignalBar } from "@/components/signal-scale"
import {
  Panel,
  PanelHeader,
  PanelMeta,
  PanelTitle,
  Stat,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ImpliedReturnBar, ValueBar, formatSignedPercent } from "@/components/valuation-scale"
import { median } from "@/lib/rank"
import { rankUniverse } from "@/lib/screen"
import { formatRatio, sectorRows } from "@/lib/sectors"
import { DEFAULT_SIGNALS, formatScore } from "@/lib/signals"
import { loadUniverse } from "@/lib/universe"
import { impliedAndRequired } from "@/lib/valuation"

export const metadata = {
  title: { absolute: "Value Investing Dash" },
}

const STEPS = [
  { n: 1, title: "Screen", text: "Rank the index on value and trend, or start from a classic screen.", href: "/screener" },
  { n: 2, title: "Analyse", text: "Read one stock: what its price implies, and its ratios against its sector.", href: null },
  { n: 3, title: "Build", text: "Optimise a portfolio out of the screen and see its value tilt.", href: "/portfolio" },
] as const

const percent = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`)

export default async function OverviewPage() {
  const { stocks } = await loadUniverse()
  const ranking = rankUniverse(stocks, [], DEFAULT_SIGNALS)

  const pairs = stocks.flatMap((s): [number, number][] => {
    const p = impliedAndRequired(s)
    return p ? [[p.implied, p.required]] : []
  })
  const impliedMedian = median(pairs.map(([r]) => r))
  const requiredMedian = median(pairs.map(([, k]) => k))
  const gapMedian = median(pairs.map(([r, k]) => r - k))
  const above = pairs.filter(([r, k]) => r > k).length

  const top = stocks
    .filter((s) => ranking.score.has(s.ticker))
    .sort((a, b) => ranking.score.get(b.ticker)! - ranking.score.get(a.ticker)!)
    .slice(0, 10)

  const sectors = sectorRows(stocks, ranking)

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-10">
      {/* The market gauge: the one question a value investor asks first. */}
      <section aria-labelledby="gauge" className="flex flex-col gap-4">
        <h2 id="gauge" className="max-w-3xl font-heading text-2xl leading-snug">
          {impliedMedian === null || requiredMedian === null ? (
            "No stock in the index could be valued at today's prices."
          ) : (
            <>
              The median S&amp;P 500 stock&rsquo;s price implies{" "}
              {percent(impliedMedian)} a year;
              its risk requires {percent(requiredMedian)}.
            </>
          )}
        </h2>
        {pairs.length > 0 && gapMedian !== null && (
          <div className="grid max-w-3xl gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-1">
              <ImpliedReturnBar alpha={gapMedian} className="w-full" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>implies less than required</span>
                <span>more</span>
              </div>
            </div>
            <Stat
              label="Median gap"
              value={`${formatSignedPercent(gapMedian)} / yr`}
              hint={`${above} of ${pairs.length} stocks price in more than their risk requires`}
            />
          </div>
        )}
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Each figure is a reverse DCF: the return that makes a company&rsquo;s
          cash flows worth today&rsquo;s price, against WACC or the CAPM cost of
          equity. The backtest found the ranking across stocks informative and
          the size of the gap not, so the screener ranks rather than reading
          this as a forecast.{" "}
          <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
            Methodology
          </Link>
        </p>
      </section>

      {/* Screen → Analyse → Build */}
      <ol className="grid gap-px border border-border bg-border sm:grid-cols-3">
        {STEPS.map((step) => {
          const body = (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="font-mono text-muted-foreground">{step.n}</span>
                {step.title}
                {step.href && <RiArrowRightLine className="size-4 text-muted-foreground" aria-hidden="true" />}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {step.href ? step.text : <>{step.text} Search from the bar above, or pick a stock below.</>}
              </span>
            </>
          )
          return (
            <li key={step.n} className="bg-card">
              {step.href ? (
                <Link href={step.href} className="flex h-full flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50">
                  {body}
                </Link>
              ) : (
                <div className="flex h-full flex-col gap-1 px-4 py-3">{body}</div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>Top ten: value + trend</PanelTitle>
            <Link href="/screener" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Full screen
            </Link>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Stock</TableHead>
                <TableHead className="w-[30%]">Score</TableHead>
                <TableHead className="w-[30%]">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((stock) => {
                const score = ranking.score.get(stock.ticker) ?? null
                const value = ranking.value.get(stock.ticker) ?? null
                return (
                  <TableRow key={stock.ticker}>
                    <TableCell>
                      <Link href={`/stocks/${stock.ticker}`} className="flex flex-col hover:underline">
                        <span className="font-mono text-sm font-semibold">{stock.ticker}</span>
                        <span className="max-w-[16rem] truncate text-xs text-muted-foreground">{stock.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SignalBar score={score} className="flex-1" />
                        <span className="w-7 text-right font-mono text-sm">{formatScore(score)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ValueBar percentile={value} className="flex-1" />
                        <span className="w-7 text-right font-mono text-sm">{formatScore(value)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Sectors</PanelTitle>
            <PanelMeta>medians · cheapest first</PanelMeta>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Sector</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">P/E</TableHead>
                <TableHead className="text-right">EV/EBITDA</TableHead>
                <TableHead className="text-right">FCF yield</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sectors.map((row) => (
                <TableRow key={row.sector}>
                  <TableCell>
                    <Link
                      href={`/screener?sector=${encodeURIComponent(row.sector)}`}
                      className="flex items-baseline gap-2 hover:underline"
                    >
                      <span className="text-sm">{row.sector}</span>
                      <span className="font-mono text-xs text-muted-foreground">{row.count}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatScore(row.value)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatRatio(row.peRatio, "multiple")}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatRatio(row.evEbitda, "multiple")}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatRatio(row.fcfYield, "percent")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Value is the sector&rsquo;s median value rank, 0–100 across the
            index. Click a sector to screen it.
          </p>
        </Panel>
      </div>
    </div>
  )
}
