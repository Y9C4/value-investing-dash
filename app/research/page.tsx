import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import {
  CalibrationChart,
  CumulativeIcChart,
  QuintileChart,
} from "@/components/research-charts"
import { TStat } from "@/components/t-stat"
import { Details, Panel, PanelBody, PanelHeader, PanelMeta, PanelTitle } from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DEVELOPMENT_SPAN,
  EVIDENCE,
  HOLDOUT_SPAN,
  cumulativeIc,
  STRATEGIES,
  type SampleStats,
  type StrategyKey,
  formatStat,
} from "@/lib/evidence"
import evidenceNotebook from "./_data/notebook-evidence.json"
import backtestNotebook from "./_data/notebook-backtest.json"

export const metadata = {
  title: "Backtest results",
  description:
    "How well the stock ranking predicted later returns, including a test on data it had never seen, with the Jupyter notebooks behind the numbers.",
}

const KEYS = Object.keys(STRATEGIES) as StrategyKey[]

const NOTEBOOKS = [
  {
    slug: "evidence",
    data: evidenceNotebook,
    blurb:
      "Recalculates every backtest number on this site, for both the design period and the unseen test. The charts and table above come from it.",
  },
  {
    slug: "backtest",
    data: backtestNotebook,
    blurb:
      "The study used to design the model: the four reverse-DCF models against simple ratios, growth assumptions, the required-return benchmark, and the other signals we considered.",
  },
]

const signed = (x: number, digits: number) =>
  `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`

const byId = (id: string) => EVIDENCE.signals.find((s) => s.id === id)!

function SampleCells({ s }: { s: SampleStats }) {
  return (
    <>
      <TableCell className="border-l border-border text-right font-figure">{s.ic.toFixed(3)}</TableCell>
      <TableCell className="text-right"><TStat t={s.t} /></TableCell>
      <TableCell className="text-right font-figure text-muted-foreground">{Math.round(s.hit * 100)}%</TableCell>
      <TableCell className="text-right font-figure">{signed(s.spread * 100, 2)}%</TableCell>
    </>
  )
}

export default function ResearchPage() {
  const vm = byId(STRATEGIES.vm.id)
  const passing = EVIDENCE.signals.filter((s) => s.holdout.t >= 2)
  const keptShare = vm.holdout.ic / vm.development.ic

  const bestInDevelopment = EVIDENCE.signals.every((s) => s.development.ic <= vm.development.ic)

  const quintileRows = (key: StrategyKey) => {
    const s = byId(STRATEGIES[key].id)
    return s.development.quintiles.map((d, i) => ({
      quintile: `Q${i + 1}`,
      development: d,
      holdout: s.holdout.quintiles[i],
    }))
  }

  // One y-scale for the three quintile panels, rounded up to the next 0.5% a month.
  const quintileLim =
    Math.ceil(
      Math.max(...KEYS.flatMap((k) => quintileRows(k).flatMap((r) => [Math.abs(r.development), Math.abs(r.holdout)]))) * 200
    ) / 200

  return (
    <div className="flex flex-col gap-8 px-6 py-6 lg:px-10">
      <section aria-labelledby="verdict" className="grid gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <h2 id="verdict" className="font-heading text-2xl leading-snug">
            {vm.holdout.t >= 2
              ? "On unseen data, the ranking held up."
              : vm.holdout.ic > 0
                ? "On unseen data, the ranking got weaker and could be luck."
                : "On unseen data, the ranking did not work."}
          </h2>
          <p className="text-sm leading-relaxed">
            We designed the value + momentum score on {vm.development.months}{" "}
            months of history, locked the rules, then tested it once on{" "}
            {vm.holdout.months} later months. It kept {Math.round(keptShare * 100)}%
            of its predictive strength, measured by rank IC: how closely a
            month&rsquo;s ranking matched the next month&rsquo;s returns, where 0
            is chance.
          </p>
          <dl className="grid grid-cols-3 gap-px overflow-clip rounded-lg border border-border bg-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2.5">
            <div>
              <dt className="text-xs text-muted-foreground">Design period IC</dt>
              <dd className="font-figure text-xl">{vm.development.ic.toFixed(3)}</dd>
              <dd className="font-figure text-xs text-muted-foreground">t = {vm.development.t.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Unseen test IC</dt>
              <dd className="font-figure text-xl">{vm.holdout.ic.toFixed(3)}</dd>
              <dd className="font-figure text-xs text-muted-foreground">t = {vm.holdout.t.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Months it worked</dt>
              <dd className="font-figure text-xl">{Math.round(vm.holdout.hit * 100)}%</dd>
              <dd className="font-figure text-xs text-muted-foreground">
                {Math.round(vm.holdout.hit * vm.holdout.months)} of {vm.holdout.months}, test
              </dd>
            </div>
          </dl>
          <Details summary="How the test was run">
            <p>
              Every design choice used {DEVELOPMENT_SPAN}
              {bestInDevelopment && (
                <>, where value + momentum had the highest rank IC of the {EVIDENCE.signals.length} signals tried</>
              )}. The unseen test (the holdout) covers {HOLDOUT_SPAN}. A
              three-month gap sits between them so no return is counted in both.
            </p>
            <p>
              {passing.length > 0 ? (
                <>
                  In the test, only{" "}
                  {passing.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && (i === passing.length - 1 ? " and " : ", ")}
                      {s.label.toLowerCase()} (t = {s.holdout.t.toFixed(2)})
                    </span>
                  ))}{" "}
                  reached t = 2, the usual bar for ruling out luck.
                </>
              ) : (
                <>Nothing reached t = 2 in the test, the usual bar for ruling out luck.</>
              )}{" "}
              We did not switch the default on that evidence: choosing again
              after seeing the test would leave nothing tested on unseen data.
            </p>
          </Details>
        </div>

        <Panel className="self-start">
          <PanelHeader>
            <PanelTitle>Has the ranking kept working?</PanelTitle>
            <PanelMeta>{DEVELOPMENT_SPAN.split(" - ")[0]} - {HOLDOUT_SPAN.split(" - ")[1]}</PanelMeta>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Running total of each month&rsquo;s rank IC. A steady rise means the
              ranking worked in most months. The shaded months are the unseen test.
            </p>
            <CumulativeIcChart {...cumulativeIc()} />
          </PanelBody>
        </Panel>
      </section>

      <Panel>
        <PanelHeader>
          <PanelTitle>Every signal we tried</PanelTitle>
          <PanelMeta>* t of 2 or more · ** t of 3 or more</PanelMeta>
        </PanelHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="align-bottom">Signal</TableHead>
                <TableHead colSpan={4} className="border-l border-border text-center">
                  Design period · {DEVELOPMENT_SPAN}
                </TableHead>
                <TableHead colSpan={4} className="border-l border-border text-center">
                  Unseen test · {HOLDOUT_SPAN}
                </TableHead>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                {["design", "test"].flatMap((sample) => [
                  <TableHead key={`${sample}-ic`} className="border-l border-border text-right">Rank IC</TableHead>,
                  <TableHead key={`${sample}-t`} className="text-right">t-stat</TableHead>,
                  <TableHead key={`${sample}-hit`} className="text-right">Months it worked</TableHead>,
                  <TableHead key={`${sample}-q`} className="text-right">Top − bottom / month</TableHead>,
                ])}
              </TableRow>
            </TableHeader>
            <TableBody>
              {EVIDENCE.signals.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium whitespace-nowrap">{s.label}</TableCell>
                  <SampleCells s={s.development} />
                  <SampleCells s={s.holdout} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PanelBody className="flex flex-col gap-2 border-t border-border">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Top − bottom is how much more the top fifth of stocks returned than
            the bottom fifth, per month, after removing common market factors.
          </p>
          <Details>
            <p>
              Target: {EVIDENCE.target[0].toLowerCase() + EVIDENCE.target.slice(1)}.
              Rank IC is the average monthly Spearman rank correlation. Its t-stat
              is Fama-MacBeth: the mean divided by its standard error. 2 is the
              conventional bar; Harvey, Liu and Zhu (2016) recommend 3 once many
              factors have been tried. Fifths are equal-weighted.
            </p>
          </Details>
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Did higher-ranked stocks earn more?</PanelTitle>
            <PanelMeta>average next-month return, factor-adjusted</PanelMeta>
          </PanelHeader>
          <PanelBody className="grid gap-4 md:grid-cols-3">
            {KEYS.map((key) => (
              <figure key={key} className="flex min-w-0 flex-col gap-1">
                <figcaption className="flex items-center gap-2 text-xs font-semibold">
                  <span className="size-2.5 shrink-0" style={{ background: STRATEGIES[key].color }} aria-hidden="true" />
                  {STRATEGIES[key].label}
                </figcaption>
                <QuintileChart strategy={key} rows={quintileRows(key)} lim={quintileLim} />
              </figure>
            ))}
          </PanelBody>
          <PanelBody className="border-t border-border text-sm leading-relaxed text-muted-foreground">
            Q1 is the lowest-ranked fifth of the index and Q5 the highest. Solid
            bars are the design period, hollow bars the unseen test. A ranking
            that works rises steadily from Q1 to Q5. A U shape, or one end doing
            all the work, is weaker evidence.
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Is the gap a forecast?</PanelTitle>
            <PanelMeta>
              slope {formatStat(EVIDENCE.calibration.development.slope)} / {formatStat(EVIDENCE.calibration.holdout.slope)}
            </PanelMeta>
          </PanelHeader>
          <PanelBody>
            <CalibrationChart
              development={EVIDENCE.calibration.development.deciles}
              holdout={EVIDENCE.calibration.holdout.deciles}
            />
          </PanelBody>
          <PanelBody className="flex flex-col gap-2 border-t border-border">
            <p className="text-sm leading-relaxed text-muted-foreground">
              No. If the return gap predicted returns, the points would follow the
              dashed line. They don&rsquo;t, so the site ranks stocks on the gap
              instead of presenting it as expected return.
            </p>
            <Details>
              <p>
                Stocks are split into ten groups by return gap, and each group is
                plotted against what it went on to earn, in percentage points a
                year. A perfect forecast has a slope of 1. The slope was{" "}
                {formatStat(EVIDENCE.calibration.development.slope)} in the design
                period and {formatStat(EVIDENCE.calibration.holdout.slope)} in the
                unseen test.
              </p>
            </Details>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>Jupyter notebooks</PanelTitle>
          <PanelMeta>python-api/notebooks</PanelMeta>
        </PanelHeader>
        <ul className="grid gap-px bg-border md:grid-cols-2">
          {NOTEBOOKS.map(({ slug, data, blurb }) => {
            const figures = (data.cells as { outputs?: { kind: string }[] }[])
              .flatMap((c) => c.outputs ?? [])
              .filter((o) => o.kind === "image").length
            return (
              <li key={slug} className="bg-card">
                <Link href={`/research/${slug}`} className="group flex h-full flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/50">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {data.title}
                    <RiArrowRightLine className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{blurb}</span>
                  <span className="font-figure text-xs text-muted-foreground">
                    {slug}.ipynb · {data.cells.length} cells · {figures} figures
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Panel>

      <p className="text-sm leading-relaxed text-muted-foreground">
        One caveat: the test uses today&rsquo;s S&amp;P 500 members, so companies
        that dropped out are missing (survivorship bias). Portfolios rebalance at
        month-end and company accounts are used 60 days after the period ends.
        Generated {EVIDENCE.generated}. See the{" "}
        <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
          methodology page
        </Link>{" "}
        for the full details.
      </p>
    </div>
  )
}
