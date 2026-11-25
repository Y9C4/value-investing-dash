import Link from "next/link"

import { ExcessReturnHistogram } from "@/components/excess-return-histogram"
import { CumulativeIcChart } from "@/components/research-charts"
import { TStat } from "@/components/t-stat"
import {
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
      ? "Yes, and it held up out of sample."
      : holdout.ic > 0
        ? "Weakly: positive out of sample, but not significant."
        : "Not out of sample."

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
      {/* The question and its answer, the way a paper's abstract gives them. */}
      <section aria-labelledby="question" className="flex flex-col gap-5">
        <div className="flex max-w-4xl flex-col gap-3">
          <h2 id="question" className="font-heading text-2xl leading-snug sm:text-3xl">
            Can a reverse-DCF value signal, blended with 12–1 momentum, rank
            S&amp;P 500 stocks by next-month risk-adjusted return?
          </h2>
          <p className="text-base leading-relaxed">
            <span className="font-semibold">{verdict}</span>{" "}
            Rank IC measures how closely each month&rsquo;s ranking matched the
            next month&rsquo;s returns, where 0 means no information.{" "}
            {bestInDevelopment ? (
              <>
                We tested {EVIDENCE.signals.length} signals on {dev.months}{" "}
                development months ({DEVELOPMENT_SPAN}). The value + momentum
                composite had the highest rank IC ({dev.ic.toFixed(3)}, t ={" "}
                {dev.t.toFixed(2)}), so it became the default.
              </>
            ) : (
              <>
                Over {dev.months} development months ({DEVELOPMENT_SPAN}), the
                default value + momentum composite had a rank IC of{" "}
                {dev.ic.toFixed(3)} (t = {dev.t.toFixed(2)}).
              </>
            )}{" "}
            We then froze the specification and ran it once on {holdout.months}{" "}
            months it had never seen ({HOLDOUT_SPAN}), where it kept {kept}% of
            that IC ({holdout.ic.toFixed(3)}, t = {holdout.t.toFixed(2)}).{" "}
            {clearing.length === 1 && clearing[0].id !== chosen.id && (
              <>
                Only {clearing[0].label.toLowerCase()} cleared the stricter bar of
                t ≥ 3 out of sample (t = {clearing[0].holdout.t.toFixed(2)}). We did
                not switch the default to it, because choosing again on the
                holdout would leave nothing out of sample.
              </>
            )}
          </p>
        </div>
        <StatStrip className="sm:grid-cols-3 xl:grid-cols-3">
          <Stat
            size="lead"
            label="Development IC · default"
            value={dev.ic.toFixed(3)}
            hint={`t = ${dev.t.toFixed(2)}${bestInDevelopment ? `, best of ${EVIDENCE.signals.length}` : ""}`}
          />
          <Stat
            size="lead"
            label="Holdout IC · default"
            value={holdout.ic.toFixed(3)}
            hint={`t = ${holdout.t.toFixed(2)}, ${holdout.months} months`}
          />
          <Stat
            size="lead"
            label="Holdout months with IC > 0"
            value={`${Math.round(holdout.hit * 100)}%`}
            hint={`${Math.round(holdout.hit * holdout.months)} of ${holdout.months}`}
          />
        </StatStrip>
      </section>

      <section aria-label="Backtest evidence" className="grid items-start gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Cumulative monthly rank IC</PanelTitle>
            <PanelMeta>holdout shaded</PanelMeta>
          </PanelHeader>
          <PanelBody>
            <CumulativeIcChart {...cumulativeIc()} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Each month adds that month&rsquo;s IC to the running total. A line
              that keeps rising means the ranking kept working, and a flat
              stretch means it stopped.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Rank IC for every candidate</PanelTitle>
          </PanelHeader>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="align-bottom">Signal</TableHead>
                <TableHead colSpan={2} className="border-l border-border text-center">Development</TableHead>
                <TableHead colSpan={2} className="border-l border-border text-center">Holdout</TableHead>
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
                      <span className="ml-2 border border-border px-1 py-px text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        default
                      </span>
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
          <PanelBody className="flex flex-col gap-2 border-t border-border text-xs leading-relaxed text-muted-foreground">
            <p>
              Each signal is scored against {EVIDENCE.target[0].toLowerCase() + EVIDENCE.target.slice(1)}.
              The t-statistic asks how far the average monthly IC is from zero,
              given how much it varies. One star marks |t| of 2 or more, and two
              stars mark |t| of 3 or more, the stricter bar Harvey, Liu and Zhu
              (2016) recommend when many factors have been tried.
            </p>
            <p>
              <Link href="/research" className="underline underline-offset-2 hover:text-foreground">
                Backtest evidence
              </Link>{" "}
              has the quintile returns, the calibration and the notebooks.
            </p>
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
                <dd className="font-figure text-xl">{percent(impliedMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median required return</dt>
                <dd className="font-figure text-xl">{percent(requiredMedian)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Median stock&rsquo;s implied − required</dt>
                <dd className={`font-figure text-xl ${gapMedian < 0 ? "text-overvalued" : gapMedian > 0 ? "text-undervalued" : ""}`}>
                  {pp(gapMedian)}
                </dd>
                <dd className="text-xs leading-tight text-muted-foreground">
                  median of per-stock gaps, not {percent(impliedMedian)} − {percent(requiredMedian)}
                </dd>
              </div>
            </dl>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            These figures cover the {pairs.length} stocks that at least one model
            can value. The other {notValued} have no valuation. Of the{" "}
            {pairs.length}, {above} ({Math.round((above / Math.max(pairs.length, 1)) * 100)}%)
            have an implied return above their required return. The backtest
            found that the ranking is informative but the size of the gap is
            not, so treat this as a reading of relative pricing rather than a
            forecast. The{" "}
            <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
              methodology page
            </Link>{" "}
            explains how each number is built.
          </p>
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
