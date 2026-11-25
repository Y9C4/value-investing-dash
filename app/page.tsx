import Link from "next/link"

import { ExcessReturnHistogram } from "@/components/excess-return-histogram"
import { CumulativeIcChart } from "@/components/research-charts"
import { TStat } from "@/components/t-stat"
import {
  Details,
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
  Stat,
  StatStrip,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { buttonVariants } from "@/components/ui/button"
import { WorkedExample } from "@/components/worked-example"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import { DEVELOPMENT_SPAN, EVIDENCE, HOLDOUT_SPAN, cumulativeIc, evidenceFor } from "@/lib/evidence"
import { formatPct as percent, formatPp as pp } from "@/lib/format"
import { median } from "@/lib/rank"
import { rankUniverse } from "@/lib/screen"
import { DEFAULT_SIGNALS } from "@/lib/signals"
import { selectSnapshotRow } from "@/lib/supabase"
import { VALUATIONS_CACHE_TAG, loadUniverse } from "@/lib/universe"
import { impliedAndRequired } from "@/lib/valuation"

export const metadata = {
  title: "Overview",
}

export default async function OverviewPage() {
  const { stocks } = await loadUniverse()
  const ranking = rankUniverse(stocks, [], DEFAULT_SIGNALS)

  // The backtest: the default composite against the other candidates.
  const chosen = evidenceFor(DEFAULT_SIGNALS)!
  const dev = chosen.development
  const holdout = chosen.holdout
  const bestInDevelopment = EVIDENCE.signals.every((s) => s.development.ic <= dev.ic)
  const clearing = EVIDENCE.signals.filter((s) => s.holdout.t >= 3)
  const kept = Math.round((holdout.ic / dev.ic) * 100)
  const verdict =
    holdout.t >= 2
      ? "the ranking held up."
      : holdout.ic > 0
        ? "the ranking leaned the right way, but by too little to rule out luck."
        : "the ranking did not work."

  // The worked example: today's top stock on the default composite.
  const ranked = stocks
    .filter((s) => ranking.score.has(s.ticker))
    .sort((a, b) => ranking.score.get(b.ticker)! - ranking.score.get(a.ticker)!)
  const top = ranked[0]
  // The scheduled default solve, the same snapshot the portfolio page opens on.
  const frontierRow = await selectSnapshotRow<{ payload: FrontierResponse }>(
    "frontier_snapshot",
    "select=payload&cache_key=eq.default",
    { revalidate: process.env.NODE_ENV === "development" ? 0 : 3600, tags: [VALUATIONS_CACHE_TAG] }
  )

  // Today's market reading.
  const pairs = stocks.flatMap((s): [number, number][] => {
    const p = impliedAndRequired(s)
    return p ? [[p.implied, p.required]] : []
  })
  const impliedMedian = median(pairs.map(([r]) => r))
  const requiredMedian = median(pairs.map(([, k]) => k))
  const gapMedian = median(pairs.map(([r, k]) => r - k))
  const above = pairs.filter(([r, k]) => r > k).length
  const notValued = stocks.length - pairs.length

  return (
    <div className="flex flex-col gap-10 px-6 py-6 lg:px-10">
      {/* What the site is, and the honest answer to whether it works. */}
      <section aria-labelledby="question" className="flex flex-col gap-5">
        <div className="flex max-w-3xl flex-col gap-3">
          <h2 id="question" className="font-heading text-2xl leading-snug sm:text-3xl">
            Which S&amp;P 500 stocks look cheap for the risk you take?
          </h2>
          <p className="text-base leading-relaxed">
            This site works out the yearly return each stock&rsquo;s current price
            implies, compares it with the return its risk calls for, and ranks the
            index on that gap together with recent price momentum.
          </p>
          <p className="text-base leading-relaxed">
            <span className="font-semibold">Does it work?</span> On {holdout.months}{" "}
            months of data it had never seen, {verdict}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link href="/screener" className={buttonVariants({ size: "sm" })}>
              See the ranking
            </Link>
            <Link href="/research" className={buttonVariants({ size: "sm", variant: "outline" })}>
              See how it was tested
            </Link>
          </div>
        </div>

        <StatStrip className="sm:grid-cols-3 xl:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
          <Stat
            size="lead"
            label="Rank IC, design period"
            value={dev.ic.toFixed(3)}
            hint={`t = ${dev.t.toFixed(2)}${bestInDevelopment ? ` · best of ${EVIDENCE.signals.length} signals tried` : ""}`}
          />
          <Stat
            size="lead"
            label="Rank IC, unseen test"
            value={holdout.ic.toFixed(3)}
            hint={`t = ${holdout.t.toFixed(2)} · ${holdout.months} months`}
          />
          <Stat
            size="lead"
            label="Test months it pointed the right way"
            value={`${Math.round(holdout.hit * 100)}%`}
            hint={`${Math.round(holdout.hit * holdout.months)} of ${holdout.months} months`}
          />
        </StatStrip>
        <Details summary="What these numbers mean">
          <p>
            Rank IC measures how closely each month&rsquo;s ranking matched the
            order of the next month&rsquo;s returns. 0 means no better than chance
            and 1 would be a perfect call. A t-stat of about 2 or more suggests a
            result is unlikely to be luck.
          </p>
          <p>
            {bestInDevelopment ? (
              <>
                We tried {EVIDENCE.signals.length} signals on a design period of{" "}
                {dev.months} months ({DEVELOPMENT_SPAN}). Value plus momentum did
                best (rank IC {dev.ic.toFixed(3)}, t = {dev.t.toFixed(2)}), so it
                became the default.
              </>
            ) : (
              <>
                Over a design period of {dev.months} months ({DEVELOPMENT_SPAN}),
                the default value plus momentum signal had a rank IC of{" "}
                {dev.ic.toFixed(3)} (t = {dev.t.toFixed(2)}).
              </>
            )}{" "}
            We then locked the rules and tested them once on {holdout.months} new
            months ({HOLDOUT_SPAN}). The signal kept {kept}% of its strength (rank
            IC {holdout.ic.toFixed(3)}, t = {holdout.t.toFixed(2)}).
          </p>
          {clearing.length === 1 && clearing[0].id !== chosen.id && (
            <p>
              {clearing[0].label} on its own passed the stricter bar of t ≥ 3 in
              the test (t = {clearing[0].holdout.t.toFixed(2)}). We kept the
              original default anyway: picking a new winner after seeing the test
              would mean nothing had been tested on unseen data.
            </p>
          )}
        </Details>
      </section>

      <section aria-label="Backtest results" className="grid items-start gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Has the ranking kept working?</PanelTitle>
            <PanelMeta>unseen test shaded</PanelMeta>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Running total of each month&rsquo;s rank IC. A rising line means the
              ranking kept working; a flat or falling one means it did not.
            </p>
            <CumulativeIcChart {...cumulativeIc()} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Every signal we tried</PanelTitle>
            <PanelMeta>rank IC and t-stat</PanelMeta>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="align-bottom">Signal</TableHead>
                <TableHead colSpan={2} className="border-l border-border text-center">Design period</TableHead>
                <TableHead colSpan={2} className="border-l border-border text-center">Unseen test</TableHead>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableHead className="border-l border-border text-right">IC</TableHead>
                <TableHead className="text-right">t</TableHead>
                <TableHead className="border-l border-border text-right">IC</TableHead>
                <TableHead className="text-right">t</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EVIDENCE.signals.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{s.label}</span>
                    {s.id === chosen.id && (
                      <span className="ml-2 text-xs text-muted-foreground">default</span>
                    )}
                  </TableCell>
                  <TableCell className="border-l border-border text-right font-figure">{s.development.ic.toFixed(3)}</TableCell>
                  <TableCell className="text-right"><TStat t={s.development.t} /></TableCell>
                  <TableCell className="border-l border-border text-right font-figure">{s.holdout.ic.toFixed(3)}</TableCell>
                  <TableCell className="text-right"><TStat t={s.holdout.t} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PanelBody className="flex flex-col gap-2 border-t border-border">
            <p className="text-sm text-muted-foreground">
              * t of 2 or more · ** t of 3 or more.{" "}
              <Link href="/research" className="underline underline-offset-2 hover:text-foreground">
                Full results
              </Link>
            </p>
            <Details>
              <p>
                Each signal is scored against {EVIDENCE.target[0].toLowerCase() + EVIDENCE.target.slice(1)}.
                The t-stat asks how far the average monthly rank IC is from zero,
                given how much it varies. 2 is the conventional bar. Harvey, Liu
                and Zhu (2016) recommend 3 when many factors have been tried.
              </p>
            </Details>
          </PanelBody>
        </Panel>
      </section>

      {top && (
        <WorkedExample
          stock={top}
          stocks={stocks}
          ranked={ranked}
          ranking={ranking}
          gaps={pairs.map(([r, k]) => r - k)}
          frontier={frontierRow?.payload ?? null}
        />
      )}

      {/* Today's reading: the live output of step 3 across the whole index. */}
      <section aria-labelledby="gauge" className="grid gap-x-10 gap-y-5 xl:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5 xl:col-span-2">
          <h2 id="gauge" className="max-w-4xl font-heading text-xl leading-snug sm:text-2xl">
            {gapMedian === null ? (
              "No stock in the index could be valued at today's prices."
            ) : (
              <>
                Today the typical S&amp;P 500 stock is priced to return{" "}
                {pp(Math.abs(gapMedian)).replace(/^[+−]/, "")} a year{" "}
                {gapMedian < 0 ? "less" : "more"} than its risk calls for.
              </>
            )}
          </h2>
        </div>
        <div className="flex flex-col gap-4">
          {gapMedian !== null && (
            <dl className="grid grid-cols-3 gap-px overflow-clip rounded-lg border border-border bg-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2.5">
              <div>
                <dt className="text-xs text-muted-foreground">Median implied return</dt>
                <dd className="font-figure text-xl">{percent(impliedMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median required return</dt>
                <dd className="font-figure text-xl">{percent(requiredMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median return gap</dt>
                <dd className={`font-figure text-xl ${gapMedian < 0 ? "text-overvalued" : gapMedian > 0 ? "text-undervalued" : ""}`}>
                  {pp(gapMedian)}
                </dd>
                <dd className="text-xs leading-tight text-muted-foreground">
                  middle of each stock&rsquo;s own gap, so not {percent(impliedMedian)} − {percent(requiredMedian)}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {above} of {pairs.length} stocks ({Math.round((above / Math.max(pairs.length, 1)) * 100)}%)
            are priced to return more than their risk calls for. Read this as how
            stocks compare with each other, not as a forecast: in testing, the
            order was informative but the size of the gap was not.
          </p>
          <Details summary="What is counted">
            <p>
              The figures cover the {pairs.length} stocks that at least one model
              can value. The other {notValued} have no valuation. The{" "}
              <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
                methodology page
              </Link>{" "}
              explains how each number is built.
            </p>
          </Details>
        </div>
        {gapMedian !== null && (
          <div className="flex flex-col pt-1">
            <ExcessReturnHistogram values={pairs.map(([r, k]) => r - k)} median={gapMedian} />
          </div>
        )}
      </section>
    </div>
  )
}
