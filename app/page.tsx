import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import { SignalBar } from "@/components/signal-scale"
import {
  Panel,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ExcessReturnHistogram } from "@/components/excess-return-histogram"
import { ValueBar } from "@/components/valuation-scale"
import { formatPct as percent, formatPp as pp } from "@/lib/format"
import { median } from "@/lib/rank"
import { rankUniverse } from "@/lib/screen"
import { formatRatio, sectorRows } from "@/lib/sectors"
import { DEFAULT_SIGNALS, formatComposite, formatScore } from "@/lib/signals"
import { loadUniverse } from "@/lib/universe"
import { impliedAndRequired } from "@/lib/valuation"

export const metadata = {
  title: "Market overview",
}

/** What each page is for, named as in the sidebar. Step 2's link is filled in per render. */
const STEPS = [
  {
    n: 1,
    title: "Stock screener",
    text: "Rank the S&P 500 by value, momentum and earnings-surprise percentiles; filter by strategy, sector or quintile.",
    href: "/screener",
  },
  {
    n: 2,
    title: "Stock analysis",
    text: "For one stock: the implied return under each reverse-DCF model, the growth its price assumes, and its multiples against sector medians. Open any row, or search above.",
    href: "top",
  },
  {
    n: 3,
    title: "Portfolio optimiser",
    text: "The mean–variance efficient frontier over the screened stocks, with shrunk means and covariance.",
    href: "/portfolio",
  },
  {
    n: 4,
    title: "Backtest evidence",
    text: "Monthly rank ICs of every factor and strategy, on development months and on a locked holdout, with the Jupyter notebooks.",
    href: "/research",
  },
] as const


/** Yahoo gives no sector for a handful of names; they are not a sector to rank. */
const NO_SECTOR = "Unclassified"

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

  const allSectors = sectorRows(stocks, ranking)
  const sectors = allSectors.filter((row) => row.sector !== NO_SECTOR)
  const unclassified = stocks.filter((s) => s.sector === NO_SECTOR).map((s) => s.ticker)
  const notValued = stocks.length - pairs.length

  return (
    <div className="flex flex-col gap-8 px-6 py-6 lg:px-10">
      {/* The market gauge: the one question a value investor asks first. */}
      <section aria-labelledby="gauge" className="grid gap-x-10 gap-y-5 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 xl:col-span-2">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Market valuation · reverse DCF
          </p>
          <h2 id="gauge" className="max-w-4xl font-heading text-2xl leading-snug sm:text-3xl">
            {gapMedian === null ? (
              "No stock in the index could be valued at today's prices."
            ) : (
              <>
                The median S&amp;P 500 stock is priced to return{" "}
                {pp(Math.abs(gapMedian)).replace(/^[+−]/, "")} a year{" "}
                {gapMedian < 0 ? "less" : "more"} than its risk requires.
              </>
            )}
          </h2>
        </div>
        <div className="flex flex-col gap-4">
          {gapMedian !== null && (
            <dl className="grid grid-cols-3 gap-px border border-border bg-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2.5">
              <div>
                <dt className="text-xs text-muted-foreground">Median implied return</dt>
                <dd className="font-mono text-xl">{percent(impliedMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median required return</dt>
                <dd className="font-mono text-xl">{percent(requiredMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median stock&rsquo;s implied − required</dt>
                <dd className={`font-mono text-xl ${gapMedian < 0 ? "text-overvalued" : gapMedian > 0 ? "text-undervalued" : ""}`}>
                  {pp(gapMedian)}
                </dd>
                <dd className="text-xs leading-tight text-muted-foreground">
                  median of per-stock gaps, not {percent(impliedMedian)} − {percent(requiredMedian)}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            Medians over the {pairs.length} stocks at least one model can value
            ({notValued} cannot). {above} of them ({Math.round((above / Math.max(pairs.length, 1)) * 100)}%)
            have an implied return above their required return. Implied return
            is the discount rate that equates forecast cash flows with today&rsquo;s
            price; required return is WACC or the CAPM cost of equity. The
            backtest found the cross-sectional rank informative and the level
            not, so this is a reading of relative pricing, not a forecast.{" "}
            <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
              Methodology
            </Link>
          </p>
        </div>
        {gapMedian !== null && (
          <div className="flex flex-col pt-1">
            <ExcessReturnHistogram values={pairs.map(([r, k]) => r - k)} median={gapMedian} />
          </div>
        )}
      </section>

      {/* What each page is for, named as it is in the sidebar. */}
      <ol className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step) => {
          const body = (
            <>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="font-mono text-muted-foreground">{step.n}</span>
                {step.title}
                <RiArrowRightLine className="size-4 text-muted-foreground" aria-hidden="true" />
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{step.text}</span>
            </>
          )
          const href = step.href === "top" ? (top[0] ? `/stocks/${top[0].ticker}` : "/screener") : step.href
          return (
            <li key={step.n} className="bg-card">
              <Link href={href} className="flex h-full flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50">
                {body}
                {step.href === "top" && top[0] && (
                  <span className="text-xs text-muted-foreground">
                    Example: <span className="font-mono text-foreground">{top[0].ticker}</span>, today&rsquo;s top composite.
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>

      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>Top 10 · value + momentum composite</PanelTitle>
            <Link href="/screener" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              All {stocks.length} in the screener
            </Link>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8">#</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead className="w-[30%]">Composite</TableHead>
                <TableHead className="text-right">Value <span className="hidden sm:inline">percentile</span></TableHead>
                <TableHead className="text-right">Momentum <span className="hidden sm:inline">(12–1)</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((stock, i) => {
                const score = ranking.score.get(stock.ticker) ?? null
                const value = ranking.value.get(stock.ticker) ?? null
                const momentum = stock.signals?.momentumRank ?? null
                return (
                  <TableRow key={stock.ticker}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <Link href={`/stocks/${stock.ticker}`} className="flex flex-col hover:underline">
                        <span className="font-mono text-sm font-semibold">{stock.ticker}</span>
                        <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground sm:block">{stock.name}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <SignalBar score={score} className="w-20 sm:w-40" />
                        <span className="w-10 text-right font-mono text-sm">{formatComposite(score)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatScore(value)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatScore(momentum)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Percentiles are 0–100 across the index (100 = cheapest on value,
            strongest on 12–1 momentum). The composite averages the two and
            re-ranks, so a composite of 100 is the index&rsquo;s top stock on the blend.
          </p>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Sector valuation · medians</PanelTitle>
            <PanelMeta>cheapest first</PanelMeta>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Sector (stocks)</TableHead>
                <TableHead className="w-[30%]">Median value <span className="hidden sm:inline">percentile</span></TableHead>
                <TableHead className="text-right">P/E</TableHead>
                <TableHead className="hidden text-right sm:table-cell">EV/EBITDA</TableHead>
                <TableHead className="hidden text-right sm:table-cell">FCF yield</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sectors.map((row) => (
                <TableRow key={row.sector}>
                  <TableCell>
                    <Link
                      href={`/screener?sector=${encodeURIComponent(row.sector)}`}
                      className="flex items-baseline gap-2 whitespace-normal hover:underline"
                    >
                      <span className="text-sm">{row.sector}</span>
                      <span className="font-mono text-xs text-muted-foreground">{row.count}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <ValueBar percentile={row.value} className="w-12 sm:w-auto sm:flex-1" />
                      <span className="w-7 text-right font-mono text-sm">{formatScore(row.value)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatRatio(row.peRatio, "multiple")}</TableCell>
                  <TableCell className="hidden text-right font-mono text-sm sm:table-cell">{formatRatio(row.evEbitda, "multiple")}</TableCell>
                  <TableCell className="hidden text-right font-mono text-sm sm:table-cell">{formatRatio(row.fcfYield, "percent")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Sectors are ordered by the median value percentile of their
            stocks. Click a sector to open it in the screener.
            {unclassified.length > 0 && (
              <> Not shown: {unclassified.join(", ")} ({unclassified.length === 1 ? "no sector" : "no sectors"} in the source data).</>
            )}
          </p>
        </Panel>
      </div>
    </div>
  )
}
