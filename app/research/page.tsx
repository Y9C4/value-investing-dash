import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import {
  CalibrationChart,
  CumulativeIcChart,
  QuintileChart,
} from "@/components/research-charts"
import { TStat } from "@/components/t-stat"
import { Panel, PanelBody, PanelHeader, PanelMeta, PanelTitle } from "@/components/ui/panel"
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
  title: "Backtest evidence",
  description:
    "Out-of-sample test of the dashboard's factors and strategies: monthly rank ICs, quintile returns and calibration on a locked holdout, with the Jupyter notebooks that produced them.",
}

const KEYS = Object.keys(STRATEGIES) as StrategyKey[]

const NOTEBOOKS = [
  {
    slug: "evidence",
    data: evidenceNotebook,
    blurb:
      "Re-derives every backtest number the site prints, on the development months and on the holdout, from the frozen export. The charts and table above are drawn from its output.",
  },
  {
    slug: "backtest",
    data: backtestNotebook,
    blurb:
      "The development study that chose the specification: the four reverse-DCF models against their plain ratios, growth assumptions, the required-return benchmark, calibration, factor attribution and twelve candidate factors.",
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
            Out of sample, the default value + momentum composite kept{" "}
            {Math.round(keptShare * 100)}% of its development rank IC
            {vm.holdout.t >= 2 ? ", and stayed significant." : ", but is no longer close to significant."}
          </h2>
          <dl className="grid grid-cols-3 gap-px border border-border bg-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2.5">
            <div>
              <dt className="text-xs text-muted-foreground">Development IC</dt>
              <dd className="font-figure text-xl">{vm.development.ic.toFixed(3)}</dd>
              <dd className="font-figure text-xs text-muted-foreground">t = {vm.development.t.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Holdout IC</dt>
              <dd className="font-figure text-xl">{vm.holdout.ic.toFixed(3)}</dd>
              <dd className="font-figure text-xs text-muted-foreground">t = {vm.holdout.t.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Positive-IC months</dt>
              <dd className="font-figure text-xl">{Math.round(vm.holdout.hit * 100)}%</dd>
              <dd className="font-figure text-xs text-muted-foreground">
                {Math.round(vm.holdout.hit * vm.holdout.months)} of {vm.holdout.months}, holdout
              </dd>
            </div>
          </dl>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every design choice was made on {vm.development.months} development
            months ({DEVELOPMENT_SPAN}){bestInDevelopment && (
              <>, and the composite is the default because it had the highest
              development IC of the {EVIDENCE.signals.length} candidates</>
            )}. We then froze the specification and ran it once on{" "}
            {vm.holdout.months} months it had never seen ({HOLDOUT_SPAN}), after
            a three-month embargo so that no return window spans both.{" "}
            {passing.length > 0 ? (
              <>
                In the holdout, only{" "}
                {passing.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && (i === passing.length - 1 ? " and " : ", ")}
                    {s.label.toLowerCase()} (t = {s.holdout.t.toFixed(2)})
                  </span>
                ))}{" "}
                cleared the conventional t = 2.
              </>
            ) : (
              <>No factor or strategy cleared the conventional t = 2 in the holdout.</>
            )}{" "}
            We did not switch the default on that evidence, because choosing
            again on the holdout would leave no out-of-sample test.
          </p>
        </div>

        <Panel className="self-start">
          <PanelHeader>
            <PanelTitle>Cumulative monthly rank IC</PanelTitle>
            <PanelMeta>{DEVELOPMENT_SPAN.split(" – ")[0]} – {HOLDOUT_SPAN.split(" – ")[1]}</PanelMeta>
          </PanelHeader>
          <PanelBody>
            <CumulativeIcChart {...cumulativeIc()} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Each month adds that month&rsquo;s rank correlation between the
              ranking and the next month&rsquo;s factor-adjusted returns to the
              running total. A steady rise means the ranking worked in most
              months, and a flat or falling stretch means it did not. The shaded
              months are the holdout.
            </p>
          </PanelBody>
        </Panel>
      </section>

      <Panel>
        <PanelHeader>
          <PanelTitle>Rank IC by strategy and factor</PanelTitle>
          <PanelMeta>target: {EVIDENCE.target[0].toLowerCase() + EVIDENCE.target.slice(1)}</PanelMeta>
        </PanelHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead rowSpan={2} className="align-bottom">Strategy or factor</TableHead>
                <TableHead colSpan={4} className="border-l border-border text-center">
                  Development · {DEVELOPMENT_SPAN}
                </TableHead>
                <TableHead colSpan={4} className="border-l border-border text-center">
                  Holdout · {HOLDOUT_SPAN}
                </TableHead>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                {["Development", "Holdout"].flatMap((sample) => [
                  <TableHead key={`${sample}-ic`} className="border-l border-border text-right">Mean IC</TableHead>,
                  <TableHead key={`${sample}-t`} className="text-right">t-stat</TableHead>,
                  <TableHead key={`${sample}-hit`} className="text-right">Months IC &gt; 0</TableHead>,
                  <TableHead key={`${sample}-q`} className="text-right">Q5 − Q1 / month</TableHead>,
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
        <PanelBody className="border-t border-border text-xs leading-relaxed text-muted-foreground">
          Mean IC is the average monthly Spearman rank correlation, and its
          t-stat is Fama–MacBeth: the mean divided by its standard error. One
          star marks |t| of 2 or more, the conventional bar, and two stars mark
          |t| of 3 or more, the stricter bar Harvey, Liu and Zhu (2016)
          recommend once many factors have been tried. Q5 − Q1 is the
          equal-weight return of the top quintile minus the bottom quintile, per
          month, on the same factor-adjusted target.
        </PanelBody>
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader>
            <PanelTitle>Mean next-month return by quintile</PanelTitle>
            <PanelMeta>% a month, factor-adjusted</PanelMeta>
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
          <PanelBody className="border-t border-border text-xs leading-relaxed text-muted-foreground">
            Q1 is each signal&rsquo;s lowest-ranked fifth of the index and Q5 is
            its highest. Solid bars are development and hollow bars are the
            holdout. The quintile chips on the screener (Q5 · highest … Q1 ·
            lowest) only mean something if returns rise from Q1 to Q5. A spread
            carried by one end, or a U shape, is weaker evidence than a steady
            rise.
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Calibration of value</PanelTitle>
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
          <PanelBody className="border-t border-border text-xs leading-relaxed text-muted-foreground">
            Stocks are grouped into deciles of implied excess return, and each
            decile is plotted against what it went on to earn, in percentage
            points a year. A forecast would follow the 45° line. The slope was{" "}
            {formatStat(EVIDENCE.calibration.development.slope)} in development and{" "}
            {formatStat(EVIDENCE.calibration.holdout.slope)} in the holdout, which
            is why the site turns implied excess return into a percentile and
            never presents it as expected alpha.
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

      <p className="text-xs leading-relaxed text-muted-foreground">
        The universe is today&rsquo;s S&amp;P 500 members, so the results are
        survivorship-biased. Portfolios rebalance at month-end, and statements
        are used 60 days after the period ends. This page was generated{" "}
        {EVIDENCE.generated} from backtest/output/model_data.parquet. The{" "}
        <Link href="/methodology" className="underline underline-offset-2 hover:text-foreground">
          methodology page
        </Link>{" "}
        has the full details.
      </p>
    </div>
  )
}
