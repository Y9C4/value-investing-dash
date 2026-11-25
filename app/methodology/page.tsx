import { Tex } from "@/components/tex"
import Image from "next/image"
import Link from "next/link"

import { MethodologyToc } from "@/components/methodology-toc"
import { ProfileLinks } from "@/components/profile-links"
import { TStat } from "@/components/t-stat"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DEVELOPMENT_SPAN, EVIDENCE, HOLDOUT_SPAN, evidenceFor, formatStat } from "@/lib/evidence"
import { PROFILE } from "@/lib/profile"
import { GRAHAM_NOTE } from "@/lib/screen"
import { DEFAULT_SIGNALS, SIGNAL_COMPONENTS, SIGNAL_EVIDENCE } from "@/lib/signals"
import { cn } from "@/lib/utils"

export const metadata = {
  title: "Methodology",
  description:
    "How Value Investing Dash ranks the S&P 500: reverse DCF, momentum and earnings surprise, how the ranking was tested, and the assumptions behind it.",
}

/** Every model-versus-ratio pair, from the backtest export; the last row is the four-model average against the ratio composite. */
const MODEL_VS_RATIO = EVIDENCE.modelVsRatio
const PAIRS = MODEL_VS_RATIO.filter((r) => r.t !== null)
const ic3 = (x: number) => x.toFixed(3).replace("-", "\u2212")
const pct1 = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`
const BEATS = MODEL_VS_RATIO.filter((r) => r.modelIc > r.ratioIc).length
const VALUE_LS = EVIDENCE.valueAttribution
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
const word = (n: number) => WORDS[n] ?? String(n)

/** Every constant in the value signal and where it comes from (`warehouse.spec`). */
const ASSUMPTIONS = [
  { what: "Explicit forecast", value: "5 years, then a perpetuity", source: "Within Damodaran's 5-10 year range; checked at 3 and 10" },
  { what: "Long-run growth", value: "Lower of 2.5% and the 10-year Treasury", source: "Terminal growth no higher than the risk-free rate (Damodaran)" },
  { what: "Starting growth", value: "Recent revenue growth, slowing to long-run", source: "Extremes capped at the 1st and 99th percentiles; growth rarely persists (Chan, Karceski & Lakonishok 2003)" },
  { what: "Beta", value: "252 daily returns, adjusted toward average", source: "Vasicek toward the index mean, then 25% toward 0.9 (Levi & Welch 2017)" },
  { what: "Market premium", value: "Long-run average of the Fama-French market factor", source: "Ken French data library" },
  { what: "Cost of debt", value: "10-year Treasury + synthetic-rating spread", source: "Damodaran's rating table for large non-financial firms, January 2026" },
  { what: "Financial firms", value: "No WACC", source: "Debt is a bank's raw material, not its capital (Damodaran)" },
  { what: "Reporting delay", value: "Accounts used 60 days after year end", source: "SEC 10-K deadline for large accelerated filers" },
  { what: "Momentum", value: "12-month return skipping the last month (12-1)", source: "Jegadeesh & Titman (1993)" },
  { what: "Earnings surprise", value: <Tex>{"\\frac{\\text{actual EPS} - \\text{consensus EPS}}{\\text{price}}"}</Tex>, source: "Livnat & Mendenhall (2006)" },
  { what: "Score weights", value: "Equal", source: "Asness, Moskowitz & Pedersen (2013); equal weights hold up out of sample (DeMiguel et al. 2009)" },
  { what: "Model average", value: "Equal, over the models that work", source: "Forecast combination (Stock & Watson 2004)" },
]

/** Choices with no canonical value, labelled as such. Each returns no reading rather than a guess. */
const JUDGEMENT_CALLS = [
  "Earnings surprise counts only if reported in the last 100 days.",
  "A beta needs at least 120 daily observations.",
  "Share count is the 90-day median, to smooth out data errors.",
  "Company accounts older than 440 days are treated as missing.",
  "A sector median (the margin the revenue model moves toward, the ROE residual income moves toward) needs at least 5 companies.",
]

/** The page's sections, for the contents list. */
const SECTIONS = [
  ["value", "Value: reverse DCF"],
  ["factors", "Momentum and earnings surprise"],
  ["evidence", "How it was tested"],
  ["assumptions", "Assumptions"],
  ["build", "How it is built"],
  ["glossary", "Glossary"],
  ["about", "About"],
] as const

const GLOSSARY = [
  ["Reverse DCF", "A discounted cash flow model run backwards: instead of assuming a discount rate to get a fair value, it takes today's price and solves for the rate."],
  ["Implied return", "That rate. It is what buying at today's price would earn if the forecast cash flows arrive."],
  ["Required return", "What the stock should earn for its risk: WACC for whole-firm models, CAPM cost of equity for equity models."],
  ["Return gap", "Implied return minus required return, in percentage points (pp) a year. Also called implied excess return. The value ranking uses it."],
  ["pp", <>Percentage points, the difference between two percentages (<Tex>{"6.7\\% - 9.4\\% = -2.7\\ \\text{pp}"}</Tex>).</>],
  ["kₑ (cost of equity)", "The 10-year Treasury yield plus beta times the market premium (CAPM)."],
  ["WACC", "Cost of equity and after-tax cost of debt, weighted by market value."],
  ["12-1 momentum", "The return from twelve months ago to one month ago."],
  ["Percentile", "Where a stock sits in the index on a measure, from 0 to 100. 100 is best."],
  ["Score", "The average of the selected percentiles, re-ranked 0-100 so each fifth holds the same number of stocks."],
  ["Quintile", "One fifth of the index by a ranking. Value Q5 is the cheapest fifth; score Q5 is the top-ranked fifth."],
  ["Rank IC", "Information coefficient: how closely a month's ranking matched the order of the next month's returns. 0 is chance. In stock selection, around 0.05 is considered useful."],
  ["t-stat", "How far a result is from zero compared with its noise. About 2 or more suggests it is unlikely to be luck."],
  ["Design period", "The months used to make every choice about the model. The notebooks call it development."],
  ["Unseen test (holdout)", "Later months kept aside until the rules were locked, then scored once. Also called out of sample."],
  ["Factor-adjusted return", "A stock's return after removing what common market factors (Fama-French five) would explain that month. The ranking is tested against this."],
  ["Top − bottom", "How much more the top fifth returned than the bottom fifth, per month (Q5 − Q1)."],
] as const

/** The four reverse-DCF models and the return each is measured against. */
const MODELS = [
  { name: "FCFF", against: "WACC", text: "Compares free cash flow to the firm with enterprise value." },
  { name: "Residual income", against: "Cost of equity", text: "Starts from book value, adds earnings above the cost of equity, and compares that with market cap. It works for banks." },
  { name: "Revenue", against: "WACC", text: "Starts from sales and assumes the cash margin moves toward the sector median, so it works for companies whose cash flow is negative for now." },
  { name: "Shareholder yield", against: "Cost of equity", text: "Counts dividends plus net buybacks, the cash an owner actually receives." },
]

const BUILD = [
  { name: "Database", text: "Supabase Postgres. Prices and company accounts are stored exactly as downloaded, every rate, ratio and ranking is calculated from them in SQL, and the site can only read the results." },
  { name: "Data service", text: "A Python FastAPI app on Cloud Run. It downloads data from yfinance and runs the portfolio optimiser (PyPortfolioOpt with Clarabel). Anything that writes data needs a secret token." },
  { name: "Website", text: "Next.js and React, reading one cached snapshot. Your browser only re-ranks stocks when you switch a model or measure on or off." },
]

const DEFAULT_ID = evidenceFor(DEFAULT_SIGNALS)?.id
const MAX_IC = Math.max(...MODEL_VS_RATIO.flatMap((r) => [Math.abs(r.modelIc), Math.abs(r.ratioIc)]))

/** A numbered section: a rule, the number, the title, then the prose. */
function Section({ id, n, title, children }: { id: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="mt-14 scroll-mt-20 border-t border-border pt-8 [&_h3]:mt-10 [&_h3]:mb-3 [&_h3]:font-heading [&_h3]:text-lg [&_p]:mb-4"
    >
      <h2 id={`${id}-title`} className="mb-5 flex items-baseline gap-3 font-heading text-2xl">
        <span className="font-figure text-sm font-normal text-muted-foreground">{String(n).padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A hairline box for a table or a list, so it reads as an exhibit. */
function Exhibit({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mb-4 overflow-clip rounded-lg border border-border bg-card", className)}>{children}</div>
}

function IcBar({ value, className }: { value: number; className: string }) {
  return (
    <span className="block h-1.5 bg-muted" aria-hidden="true">
      <span className={cn("block h-full", className)} style={{ width: `${Math.max(2, (Math.abs(value) / MAX_IC) * 100)}%` }} />
    </span>
  )
}

const LINK = "underline underline-offset-2 hover:text-foreground"

export default function MethodologyPage() {
  const alphaPct = (VALUE_LS.alpha * 100).toFixed(1).replace("-", "\u2212")
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 pb-32 lg:px-10 xl:grid xl:grid-cols-[12rem_minmax(0,1fr)] xl:gap-14">
      <MethodologyToc sections={SECTIONS} />

      <article className="mt-8 max-w-3xl text-[0.9375rem] leading-[1.7] xl:mt-0 [&_p]:max-w-[42rem]">
        <p className="mb-5 font-heading text-[1.75rem] leading-snug sm:text-3xl">
          For every S&amp;P 500 stock we ask: what return does today&rsquo;s price
          imply, and is that enough for the risk?
        </p>
        <p className="text-muted-foreground">
          We don&rsquo;t put a fair value on any stock. We rank stocks against each
          other on that question, then combine the ranking with momentum (has the
          market started to notice?). Earnings surprise (did the business just
          beat expectations?) can be added in the screener. Numbers are
          recalculated after each trading day.
        </p>

        <Section id="value" n={1} title="Value: reverse DCF">
          <p>
            A conventional DCF assumes a discount rate and produces a fair value.
            Small changes to that rate swing the answer widely, and one unusual
            year of cash flow can make a stock look 700% undervalued. A reverse
            DCF works the other way round. It takes the price as given and solves
            for the annual return that would make five years of forecast cash
            flow, plus a terminal value, worth exactly that price. A return is
            much easier to sanity-check.
          </p>
          <figure className="mb-6 overflow-clip rounded-lg border border-border bg-card">
            <div className="px-4 py-3 text-base">
              <Tex block>{"\\text{Price} = \\sum_{t=1}^{5} \\frac{\\text{CF}_t}{(1+r)^t} + \\frac{\\text{TV}}{(1+r)^5}"}</Tex>
              <Tex block>{"\\text{TV} = \\frac{\\text{CF}_5\\,(1+g)}{r-g}"}</Tex>
              <Tex block>{"\\text{gap} = r - \\text{required return}"}</Tex>
            </div>
            <figcaption className="border-t border-border px-4 py-2 text-xs leading-5 text-muted-foreground">
              We solve the first line for <Tex>r</Tex>. <Tex>{"\\text{CF}_t"}</Tex> is the forecast cash flow in year <Tex>t</Tex>, and <Tex>g</Tex> is
              the long-run growth rate. The value ranking uses the gap.
            </figcaption>
          </figure>
          <p>
            Four models each produce an implied return. We subtract the required
            return from each, then average the models that work for that company.
          </p>
          <ul className="mb-4 grid gap-px overflow-clip rounded-lg border border-border bg-border sm:grid-cols-2 [&>li]:bg-card [&>li]:px-4 [&>li]:py-3.5">
            {MODELS.map((m) => (
              <li key={m.name} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-heading text-base">{m.name}</span>
                  <span className="font-figure text-xs whitespace-nowrap text-muted-foreground">vs {m.against}</span>
                </div>
                <p className="!mb-0 text-sm leading-6 text-muted-foreground">{m.text}</p>
              </li>
            ))}
          </ul>
          <p>
            The screener shows value as a percentile from 0 to 100 and splits the
            index into five groups, redrawn at every refresh (Fama and French
            1992). &ldquo;Q5 · cheapest&rdquo; means the cheapest 20% compared with
            the rest of the index, not that the stock trades below what it is
            worth. Each stock page also runs the FCFF model to find the growth
            today&rsquo;s price assumes, next to the growth the company has
            actually delivered.
          </p>
        </Section>

        <Section id="factors" n={2} title="Momentum and earnings surprise">
          <p>
            Cheap stocks are often cheap for a reason, so two further measures ask
            whether anything is changing. Combining value with momentum is one of
            the most robust results in asset pricing, because the two tend to
            work at different times (Asness, Moskowitz and Pedersen 2013).
          </p>
          <ul className="mb-4 divide-y divide-border overflow-clip rounded-lg border border-border bg-card">
            {SIGNAL_COMPONENTS.map((c) => (
              <li key={c.id} className="grid gap-x-6 gap-y-1 px-4 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <span className="font-heading text-base">{c.label}</span>
                <div className="flex flex-col gap-2">
                  <p className="!mb-0 text-sm leading-6 text-muted-foreground">{c.blurb}</p>
                  <Tex block className="text-sm">{c.formula}</Tex>
                </div>
              </li>
            ))}
          </ul>
          <p>
            The default score averages the value and momentum percentiles equally,
            then re-ranks the result so each fifth holds the same number of stocks.
          </p>
        </Section>

        <Section id="evidence" n={3} title="How it was tested">
          <p>
            Every signal was backtested month by month on the S&amp;P 500, using only
            accounts that were public at the time. We measured how well each
            ranking predicted the next month&rsquo;s returns after removing the five
            Fama-French factors.
          </p>
          <h3>Design period and unseen test</h3>
          <Exhibit>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead rowSpan={2} className="align-bottom">Signal</TableHead>
                  <TableHead colSpan={2} className="border-l border-border text-center">Design period</TableHead>
                  <TableHead colSpan={2} className="border-l border-border text-center">Unseen test</TableHead>
                  <TableHead rowSpan={2} className="border-l border-border text-right align-bottom">Top − bottom / month (test)</TableHead>
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="border-l border-border text-right">IC</TableHead>
                  <TableHead className="text-right">t</TableHead>
                  <TableHead className="border-l border-border text-right">IC</TableHead>
                  <TableHead className="text-right">t</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {EVIDENCE.signals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{r.label}</span>
                      {r.id === DEFAULT_ID && (
                        <span className="ml-2 text-xs text-muted-foreground">default</span>
                      )}
                    </TableCell>
                    <TableCell className="border-l border-border text-right font-figure">{r.development.ic.toFixed(3)}</TableCell>
                    <TableCell className="text-right"><TStat t={r.development.t} /></TableCell>
                    <TableCell className="border-l border-border text-right font-figure">{r.holdout.ic.toFixed(3)}</TableCell>
                    <TableCell className="text-right"><TStat t={r.holdout.t} /></TableCell>
                    <TableCell className="border-l border-border text-right font-figure">{(r.holdout.spread * 100).toFixed(2).replace("-", "\u2212")}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
              {SIGNAL_EVIDENCE} * marks a t-stat of 2 or more, ** of 3 or more. Charts, the full table and the
              notebooks are on the{" "}
              <Link href="/research" className={LINK}>backtest results</Link> page.
            </div>
          </Exhibit>

          <h3>Does reverse DCF beat a simple ratio?</h3>
          <p>
            With flat growth a reverse DCF is just a yield, so it is only worth the
            effort if its assumptions add something. We tested each model against
            the simple ratio built from the same figures, on the same stocks.
          </p>
          <Exhibit>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Model</TableHead>
                  <TableHead>Simple ratio</TableHead>
                  <TableHead className="text-right">Model IC</TableHead>
                  <TableHead className="text-right">Ratio IC</TableHead>
                  <TableHead className="hidden w-40 sm:table-cell">Compared</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MODEL_VS_RATIO.map((r) => (
                  <TableRow key={`${r.model}-${r.ratio}`}>
                    <TableCell className="whitespace-normal font-medium">{r.model}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{r.ratio}</TableCell>
                    <TableCell className="text-right font-figure">{ic3(r.modelIc)}</TableCell>
                    <TableCell className="text-right font-figure">{ic3(r.ratioIc)}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="flex flex-col gap-1">
                        <IcBar value={r.modelIc} className="bg-[var(--series-1)]" />
                        <IcBar value={r.ratioIc} className="bg-muted-foreground/60" />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 bg-[var(--series-1)]" />Reverse-DCF model</span>
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 bg-muted-foreground/60" />Simple ratio</span>
            </div>
          </Exhibit>
          <p>
            The model had the higher average rank IC in {BEATS === MODEL_VS_RATIO.length ? "all" : `${word(BEATS)} of`}{" "}
            {word(MODEL_VS_RATIO.length)} comparisons, so the ratios appear on the
            site as background and do not drive the ranking. None of the
            differences is large enough to rule out luck (the largest t is{" "}
            {Math.max(...PAIRS.map((r) => r.t!)).toFixed(1)}), and in{" "}
            {word(PAIRS.filter((r) => r.wins! < 0.5).length)} of the {word(PAIRS.length)} pairs
            the model won in fewer than half of the months. A fifth model, based on
            sector-relative multiples, failed and was dropped.
          </p>

          <h3>What the evidence does not show</h3>
          <ul className="mb-4 divide-y divide-border overflow-clip rounded-lg border border-border bg-card text-sm leading-6 [&>li]:px-4 [&>li]:py-3">
            <li>The default ranking has not been proven. Value + momentum reached t = {EVIDENCE.signals[0].development.t.toFixed(2)} in the design period ({DEVELOPMENT_SPAN}) and t = {EVIDENCE.signals[0].holdout.t.toFixed(2)} in the unseen test ({HOLDOUT_SPAN}), where about 2 is the usual bar. It stays the default because it was chosen before the test, and choosing again afterwards would leave nothing tested on unseen data.</li>
            <li>The samples are short: {EVIDENCE.signals[0].development.months} design months and {EVIDENCE.signals[0].holdout.months} test months. Once many signals have been tried, one needs a t-stat near 3 to be convincing (Harvey, Liu and Zhu 2016).</li>
            <li>Value on its own did not make money as a simple buy-cheap, sell-expensive portfolio. In the design period the cheapest fifth minus the most expensive {VALUE_LS.longShort < 0 ? "lost" : "made"} {pct1(VALUE_LS.longShort)} a month before factor adjustment. Against the five Fama-French factors its alpha is {alphaPct}% a year (t = {formatStat(VALUE_LS.alphaT)}), with large exposure to value (HML) and profitability (RMW). Most of what it picks up is those known factors.</li>
            <li>The size of the gap is not a forecast. A stock priced to return 5 points more than required did not go on to earn 5 points more. The calibration slope (1 would be a perfect forecast) was {formatStat(EVIDENCE.calibration.development.slope)} in the design period and {formatStat(EVIDENCE.calibration.holdout.slope)} in the test, so we rank on the gap and do not forecast with it.</li>
            <li>The test uses today&rsquo;s S&amp;P 500 members, so companies that dropped out are missing. That tends to flatter the results.</li>
            <li>2023 to 2026 was led by very large growth companies, a poor stretch for value.</li>
          </ul>
        </Section>

        <Section id="assumptions" n={4} title="Assumptions">
          <p>
            Each setting below lists its source: published research, a regulatory
            rule or a backtest result. Where data is missing we show a dash, never
            a guess or a zero.
          </p>
          <Exhibit>
            <Table className="text-[0.8125rem]">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Input</TableHead>
                  <TableHead>Setting</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ASSUMPTIONS.map((a) => (
                  <TableRow key={a.what}>
                    <TableCell className="min-w-28 align-top font-medium whitespace-normal">{a.what}</TableCell>
                    <TableCell className="min-w-40 align-top whitespace-normal">{a.value}</TableCell>
                    <TableCell className="min-w-48 align-top whitespace-normal text-muted-foreground">{a.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Exhibit>

          <h3>Our own judgement calls</h3>
          <p>These have no standard setting. When one of these checks fails, the stock gets no figure.</p>
          <ul className="mb-4 divide-y divide-border overflow-clip rounded-lg border border-border bg-card text-sm leading-6 [&>li]:px-4 [&>li]:py-2.5">
            {JUDGEMENT_CALLS.map((j) => <li key={j}>{j}</li>)}
          </ul>

          <h3>Graham defensive screen</h3>
          <p>{GRAHAM_NOTE}</p>

          <h3>Portfolio optimiser</h3>
          <p>
            The efficient frontier uses three years of dividend-adjusted daily
            prices. A Ledoit-Wolf covariance matrix steadies the noisy risk
            estimates, and Bayes-Stein expected returns pull noisy historical
            averages toward the minimum-variance portfolio (Jorion 1986). No stock
            can exceed 10% (the UCITS single-issuer limit) unless fewer than ten
            stocks make that impossible. The optimiser knows nothing about value;
            the return gap shown beside it is what the reverse-DCF models say about
            the portfolio it chose.
          </p>
        </Section>

        <Section id="build" n={5} title="How it is built">
          <Image
            src="/Infrastructure-diag.svg"
            alt="How the parts connect: the Next.js website reads from a Postgres database, and a Python service downloads data from yfinance and runs the optimiser."
            width={0}
            height={0}
            sizes="100vw"
            className="mb-4 h-auto w-full rounded-lg border border-border bg-white p-4"
          />
          <ul className="mb-4 grid gap-px overflow-clip rounded-lg border border-border bg-border sm:grid-cols-3 [&>li]:bg-card [&>li]:px-4 [&>li]:py-3.5">
            {BUILD.map((b) => (
              <li key={b.name} className="flex flex-col gap-1.5">
                <span className="font-heading text-base">{b.name}</span>
                <p className="!mb-0 text-sm leading-6 text-muted-foreground">{b.text}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Data comes from yfinance, an unofficial source with gaps. This is a
            demonstration project and nothing here is investment advice.
          </p>
        </Section>

        <Section id="glossary" n={6} title="Glossary">
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {GLOSSARY.map(([term, meaning]) => (
              <div key={term} className="border-t border-border py-3">
                <dt className="text-sm font-medium">{term}</dt>
                <dd className="text-sm leading-6 text-muted-foreground">{meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="about" n={7} title="About">
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col">
              <span className="font-heading text-lg">{PROFILE.name}</span>
              <span className="text-sm text-primary">{PROFILE.university}</span>
              <span className="text-sm text-muted-foreground">{PROFILE.degree}</span>
              <span className="text-sm text-muted-foreground">{PROFILE.graduating}</span>
            </div>
            <ProfileLinks labels className="flex-wrap" />
          </div>
        </Section>
      </article>
    </div>
  )
}
