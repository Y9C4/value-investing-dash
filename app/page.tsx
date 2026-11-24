import Link from "next/link"

import { ExcessReturnHistogram } from "@/components/excess-return-histogram"
import { CumulativeIcChart } from "@/components/research-charts"
import { MoreLink } from "@/components/more-link"
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

const EYEBROW = "text-xs font-semibold tracking-wider text-muted-foreground uppercase"

export default async function OverviewPage() {
  const { stocks } = await loadUniverse()
  const ranking = rankUniverse(stocks, [], DEFAULT_SIGNALS)

  // The backtest: the default composite against the other candidates.
  const chosen = evidenceFor(DEFAULT_SIGNALS)!
  const dev = chosen.development
  const holdout = chosen.holdout
  const bestInDevelopment = EVIDENCE.signals.every((s) => s.development.ic <= dev.ic)
  const bestInHoldout = EVIDENCE.signals.reduce((a, b) => (b.holdout.t > a.holdout.t ? b : a))
  const clearing = EVIDENCE.signals.filter((s) => s.holdout.t >= 3)
  const kept = Math.round((holdout.ic / dev.ic) * 10) * 10
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
          <p className={EYEBROW}>Research question</p>
          <h2 id="question" className="font-heading text-2xl leading-snug sm:text-3xl">
            Can a reverse-DCF value signal, blended with 12–1 momentum, rank
            S&amp;P 500 stocks by next-month risk-adjusted return?
          </h2>
          <p className="text-base leading-relaxed">
            <span className="font-semibold">{verdict}</span>{" "}
            <span className="text-muted-foreground">
              {bestInDevelopment ? (
                <>
                  Of the {EVIDENCE.signals.length} signals tested on {dev.months}{" "}
                  development months ({DEVELOPMENT_SPAN}), the value + momentum
                  composite had the highest rank IC ({dev.ic.toFixed(3)}, t ={" "}
                  {dev.t.toFixed(2)}), so it became the default.
                </>
              ) : (
                <>
                  The default, the value + momentum composite, had a rank IC of{" "}
                  {dev.ic.toFixed(3)} (t = {dev.t.toFixed(2)}) over {dev.months}{" "}
                  development months ({DEVELOPMENT_SPAN}).
                </>
              )}{" "}
              The specification was then frozen and run once on {holdout.months}{" "}
              months it had never seen ({HOLDOUT_SPAN}), where it kept {kept}% of
              that IC ({holdout.ic.toFixed(3)}, t = {holdout.t.toFixed(2)}).{" "}
              {clearing.length === 1 && clearing[0].id !== chosen.id && (
                <>
                  {clearing[0].label} was the only signal to clear the
                  multiple-testing bar of t ≥ 3 out of sample (t ={" "}
                  {clearing[0].holdout.t.toFixed(2)}). The default is not switched
                  to it: choosing again on the holdout would leave nothing out of
                  sample.
                </>
              )}
            </span>
          </p>
        </div>
        <StatStrip className="sm:grid-cols-4 xl:grid-cols-4">
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
          <Stat
            size="lead"
            label="Best holdout t-stat"
            value={bestInHoldout.holdout.t.toFixed(2)}
            hint={`${bestInHoldout.label.toLowerCase()}, IC ${bestInHoldout.holdout.ic.toFixed(3)}`}
          />
        </StatStrip>
      </section>

      <section aria-label="Backtest evidence" className="grid items-start gap-6 2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Figure 1 · Cumulative monthly rank IC</PanelTitle>
            <PanelMeta>holdout shaded</PanelMeta>
          </PanelHeader>
          <PanelBody>
            <CumulativeIcChart {...cumulativeIc()} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Each month adds the Spearman correlation between that month&rsquo;s
              ranking and the next month&rsquo;s factor-adjusted returns. A line
              that keeps rising means the ranking kept working; a flat stretch
              means it stopped.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Rank IC · every candidate</PanelTitle>
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
                      <span className="ml-2 border border-border px-1 py-px text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
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
              Target: {EVIDENCE.target[0].toLowerCase() + EVIDENCE.target.slice(1)}. t is Fama–MacBeth over
              months; * marks |t| ≥ 2, ** marks |t| ≥ 3, the bar Harvey, Liu
              &amp; Zhu (2016) set once many factors have been tried.
            </p>
            <MoreLink href="/research">Quintile returns, calibration and the notebooks</MoreLink>
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
          <p className={EYEBROW}>Today&rsquo;s market reading · reverse DCF</p>
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
            Medians over the {pairs.length} stocks at least one model can value
            ({notValued} cannot). {above} of them ({Math.round((above / Math.max(pairs.length, 1)) * 100)}%)
            have an implied return above their required return. The backtest
            found the cross-sectional rank informative and the level not, so
            this is a reading of relative pricing, not a forecast.{" "}
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
    </div>
  )
}
