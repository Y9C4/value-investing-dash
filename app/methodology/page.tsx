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
    "How Value Investing Dash values the S&P 500: reverse DCF, the momentum and earnings-surprise factors, the backtest behind them, and every assumption with its source.",
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
  { what: "Explicit forecast", value: "5 years, then a perpetuity", source: "Within Damodaran's 5–10 year range; checked at 3 and 10" },
  { what: "Long-run growth", value: "min(2.5%, 10Y Treasury)", source: "Terminal growth no higher than the risk-free rate (Damodaran)" },
  { what: "Starting growth", value: "Trailing revenue growth, fading to long-run", source: "Winsorised at the 1st/99th percentile; growth barely persists (Chan, Karceski & Lakonishok 2003)" },
  { what: "Beta", value: "252 daily returns, shrunk", source: "Vasicek toward the index mean, then 25% toward 0.9 (Levi & Welch 2017)" },
  { what: "Market premium", value: "Long-run mean of Fama-French Mkt−RF", source: "Ken French data library" },
  { what: "Cost of debt", value: "10Y + synthetic-rating spread", source: "Damodaran's rating table for large non-financial firms, January 2026" },
  { what: "Financial firms", value: "No WACC", source: "Debt is a bank's raw material, not its capital (Damodaran)" },
  { what: "Statement lag", value: "60 days after fiscal year end", source: "SEC 10-K deadline for large accelerated filers" },
  { what: "Momentum", value: "12-month return skipping the last month (12–1)", source: "Jegadeesh & Titman (1993)" },
  { what: "Earnings surprise", value: "(Actual − consensus EPS) ÷ price", source: "Livnat & Mendenhall (2006)" },
  { what: "Blend weights", value: "Equal", source: "Asness, Moskowitz & Pedersen (2013); equal weights hold up out of sample (DeMiguel et al. 2009)" },
  { what: "Model average", value: "Equal, over whichever solve", source: "Forecast combination (Stock & Watson 2004)" },
]

/** Choices with no canonical value, labelled as such. Each returns no reading rather than a guess. */
const JUDGEMENT_CALLS = [
  "Earnings surprise counts only if reported in the last 100 days.",
  "A beta needs at least 120 daily observations.",
  "Shares outstanding are a 90-day median, to ride over data glitches.",
  "A statement older than 440 days is treated as missing.",
  "A sector median (the margin the revenue model fades to, the ROE residual income fades to) needs at least 5 peers.",
]

/** The page's sections, for the contents list. */
const SECTIONS = [
  ["value", "Value: reverse DCF"],
  ["factors", "Momentum and earnings surprise"],
  ["evidence", "The evidence"],
  ["assumptions", "Every assumption, and its source"],
  ["build", "How it is built"],
  ["glossary", "Glossary"],
  ["about", "About"],
] as const

const GLOSSARY = [
  ["Reverse DCF", "A discounted cash flow model solved for the discount rate that makes it equal today's price, instead of discounting at an assumed rate to get a fair value."],
  ["Implied return", "That discount rate. It is what buying at today's price earns if the cash flows arrive as modelled."],
  ["Required return", "The return the stock's risk says it should earn: WACC for whole-firm models and the CAPM cost of equity for equity models."],
  ["kₑ (cost of equity)", "The 10-year Treasury yield plus beta times the market premium (CAPM)."],
  ["WACC", "The cost of equity and the after-tax cost of debt, blended by market value."],
  ["Percentile", "The share of the index at or below a stock. 100 is the top."],
  ["Rank IC", "The rank correlation between this month's ranking and next month's returns. A value of 0.05 is useful in practice, and 0 is noise."],
  ["t-stat", "How many standard errors the mean IC is from zero. About 2 is the usual bar for significance."],
  ["Implied excess return", "The implied return minus the required return, in percentage points (pp) a year. The value factor ranks on it."],
  ["pp", "Percentage points, the difference between two percentages (6.7% − 9.4% = −2.7 pp)."],
  ["Composite", "The equal-weight average of the selected factor percentiles, re-ranked 0–100 so each quintile holds an equal number of stocks."],
  ["Quintile", "One fifth of the index by a ranking. Value Q5 is the cheapest fifth, and composite Q5 is the highest-ranked fifth."],
  ["Factor-adjusted return", "A stock's excess return minus what its Fama–French five-factor betas predicted from that month's factor returns. This is the backtest's target."],
  ["Q5 − Q1", "The equal-weight factor-adjusted return of the top quintile minus the bottom quintile, per month."],
  ["Holdout", "The months kept untouched while the specification was designed and then tested once. This is the out-of-sample result."],
  ["12–1 momentum", "The return from twelve months ago to one month ago."],
] as const

/** The four reverse-DCF models and the return each is measured against. */
const MODELS = [
  { name: "FCFF", against: "WACC", text: "Compares free cash flow to the firm with enterprise value." },
  { name: "Residual income", against: "Cost of equity", text: "Starts from book value plus the earnings above the cost of equity and compares that with market cap. It is the only one of the four that works for banks." },
  { name: "Revenue", against: "WACC", text: "Starts from sales and assumes the cash margin drifts toward the sector median, so it can value companies whose cash flow is negative for now." },
  { name: "Shareholder yield", against: "Cost of equity", text: "Counts dividends plus net buybacks, the cash an owner actually receives." },
]

const BUILD = [
  { name: "Database", text: "Supabase Postgres. A raw schema holds prices and statements exactly as fetched, a warehouse schema computes every signal, rate and ratio in SQL after each fetch, and read-only views serve the site." },
  { name: "Data service", text: "A Python FastAPI app on Cloud Run. It fetches from yfinance and runs the optimiser (PyPortfolioOpt with Clarabel), and its write paths are closed behind a token." },
  { name: "Site", text: "Next.js and React, reading one cached view. The browser only re-ranks when a model or signal is toggled." },
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
  return <div className={cn("mb-4 border border-border bg-card", className)}>{children}</div>
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
          Value Investing Dash asks one question of every S&amp;P 500 stock: what
          return does today&rsquo;s price imply, and is that more or less than
          the stock&rsquo;s risk requires?
        </p>
        <p className="text-muted-foreground">
          Instead of naming a fair value, it ranks stocks against each other. That
          value rank is combined with two other factors: 12–1 month price
          momentum, which shows whether the market has started to re-rate the
          stock, and the latest earnings surprise, which shows whether the
          business just beat expectations. Every number is recomputed after each
          trading day.
        </p>

        <Section id="value" n={1} title="Value: reverse DCF">
          <p>
            A conventional DCF assumes a discount rate and produces a fair value.
            Small changes to that rate swing the answer wildly, and a lumpy year of
            cash flow or a low cost of equity can make a stock look 700%
            undervalued. A reverse DCF runs the model the other way. It takes the
            price as given and solves for the annual return that would make five
            years of forecast cash flow, followed by a perpetuity, worth exactly
            that price. A return is easy to sanity-check, and the median stock&rsquo;s
            is a few percent a year.
          </p>
          <figure className="mb-6 border border-border bg-card">
            <div className="overflow-x-auto px-4 py-4 font-mono text-[0.8125rem] leading-8 whitespace-nowrap">
              <p className="!mb-0">
                Price = Σ CF<sub>t</sub> ÷ (1 + r)<sup>t</sup> + TV ÷ (1 + r)<sup>5</sup>
              </p>
              <p className="!mb-0">TV = CF<sub>5</sub> × (1 + g) ÷ (r − g)</p>
              <p className="!mb-0">α = r − required return</p>
            </div>
            <figcaption className="border-t border-border px-4 py-2 text-xs leading-5 text-muted-foreground">
              We solve the first line for r, summing over years 1 to 5. CF<sub>t</sub> is the forecast cash flow in year t, and g is
              the long-run growth rate. The gap α is what the value factor ranks on.
            </figcaption>
          </figure>
          <p>
            Four models each solve for an implied return on their own. Value is the
            average of the ones that solve, after subtracting the return each one
            has to beat.
          </p>
          <ul className="mb-4 grid gap-px border border-border bg-border sm:grid-cols-2 [&>li]:bg-card [&>li]:px-4 [&>li]:py-3.5">
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
            The screener shows value as a percentile from 0 to 100 across the index
            and sorts it into quintiles, with the breakpoints recomputed at every
            refresh (Fama and French 1992). &ldquo;Value Q5 · cheapest&rdquo; means
            the cheapest 20% of the index relative to the rest, not that the stock
            trades below some intrinsic worth. The stock page also solves the FCFF
            model for growth, holding the return at WACC. This shows the growth
            today&rsquo;s price assumes next to the growth the company has actually
            delivered.
          </p>
        </Section>

        <Section id="factors" n={2} title="Momentum and earnings surprise">
          <p>
            Cheap stocks are often cheap for a reason, so the two further factors
            ask whether anything is changing. Combining value with momentum is one
            of the most robust results in asset pricing, because the two tend to
            work at different times (Asness, Moskowitz and Pedersen 2013).
          </p>
          <ul className="mb-4 divide-y divide-border border border-border bg-card">
            {SIGNAL_COMPONENTS.map((c) => (
              <li key={c.id} className="grid gap-x-6 gap-y-1 px-4 py-3.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <span className="font-heading text-base">{c.label}</span>
                <div className="flex flex-col gap-2">
                  <p className="!mb-0 text-sm leading-6 text-muted-foreground">{c.blurb}</p>
                  <code className="font-mono text-xs leading-5 break-words">{c.formula}</code>
                </div>
              </li>
            ))}
          </ul>
          <p>
            The default composite averages the value and momentum percentiles with
            equal weights, then re-ranks the result to a percentile so that each
            quintile holds an equal number of stocks.
          </p>
        </Section>

        <Section id="evidence" n={3} title="The evidence">
          <p>
            Every signal was backtested month by month on the S&amp;P 500, using
            only statements that were public at the time. The target was
            next-month returns adjusted for the five Fama–French factors.
          </p>
          <h3>Signal quality: development and holdout</h3>
          <Exhibit>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead rowSpan={2} className="align-bottom">Strategy or factor</TableHead>
                  <TableHead colSpan={2} className="border-l border-border text-center">Development</TableHead>
                  <TableHead colSpan={2} className="border-l border-border text-center">Holdout</TableHead>
                  <TableHead rowSpan={2} className="border-l border-border text-right align-bottom">Q5 − Q1 / month</TableHead>
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
                        <span className="ml-2 border border-border px-1 py-px text-xs font-semibold tracking-wider text-muted-foreground uppercase">default</span>
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
              {SIGNAL_EVIDENCE} One star marks |t| of 2 or more and two stars mark |t| of 3 or more. The charts, the
              full table and the notebooks are on the{" "}
              <Link href="/research" className={LINK}>backtest evidence</Link> page.
            </div>
          </Exhibit>

          <h3>Does the model beat the plain ratio?</h3>
          <p>
            A reverse DCF with flat growth is just a yield, so the model earns its
            place only if its assumptions add something. We tested each model
            against the plain ratio built from the same figures, on the same
            stocks.
          </p>
          <Exhibit>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Model</TableHead>
                  <TableHead>Plain ratio</TableHead>
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
              <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 bg-muted-foreground/60" />Plain ratio</span>
            </div>
          </Exhibit>
          <p>
            The model had the higher mean IC in {BEATS === MODEL_VS_RATIO.length ? "all" : `${word(BEATS)} of`}{" "}
            {word(MODEL_VS_RATIO.length)} comparisons, so the ratios appear on the
            site as context rather than as the ranking. Still, none of the
            differences is statistically significant (the largest t is{" "}
            {Math.max(...PAIRS.map((r) => r.t!)).toFixed(1)}), and in{" "}
            {word(PAIRS.filter((r) => r.wins! < 0.5).length)} of the {word(PAIRS.length)} model–ratio pairs
            the model won in fewer than half of the months. A fifth model,
            sector-relative multiples, was also tested, failed and was dropped.
          </p>

          <h3>What the evidence does not show</h3>
          <ul className="mb-4 divide-y divide-border border border-border bg-card text-sm leading-6 [&>li]:px-4 [&>li]:py-3">
            <li>The default strategy is not statistically significant. Value + momentum reached t = {EVIDENCE.signals[0].development.t.toFixed(2)} in development ({DEVELOPMENT_SPAN}) and t = {EVIDENCE.signals[0].holdout.t.toFixed(2)} in the holdout ({HOLDOUT_SPAN}), where about 2 is the usual bar. It stays the default because it was chosen before the holdout, and choosing again on the holdout would leave no out-of-sample test.</li>
            <li>The samples are short, with {EVIDENCE.signals[0].development.months} development months and {EVIDENCE.signals[0].holdout.months} holdout months. Once many factors have been tried, a single factor needs a t-stat near 3 to be convincing (Harvey, Liu and Zhu 2016).</li>
            <li>Value on its own did not make money as a raw long–short portfolio. In development, the top value quintile minus the bottom {VALUE_LS.longShort < 0 ? "lost" : "made"} {pct1(VALUE_LS.longShort)} a month before factor adjustment. After regressing on the five Fama–French factors, its alpha is {alphaPct}% a year (t = {formatStat(VALUE_LS.alphaT)}), with large loadings on value (HML) and profitability (RMW). In other words, its ranking information is mostly exposure to known factors.</li>
            <li>The size of the gap is not a forecast. A stock whose price implies 5 percentage points more than required did not go on to earn 5 more. The calibration slope was {formatStat(EVIDENCE.calibration.development.slope)} in development and {formatStat(EVIDENCE.calibration.holdout.slope)} in the holdout, so the site ranks on the gap but does not forecast with it.</li>
            <li>The test uses today&rsquo;s S&amp;P 500 members, so companies that dropped out of the index are missing. That tends to flatter the results.</li>
            <li>The period from 2023 to 2026 was led by mega-cap growth stocks, which was a poor stretch for value.</li>
          </ul>
        </Section>

        <Section id="assumptions" n={4} title="Every assumption, and its source">
          <p>
            Every constant in the model has a published method, a regulatory fact
            or a backtest result behind it. Missing data produces no reading
            instead of a guess, so an unmeasured figure shows as a dash, not a
            zero.
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

          <h3>Judgement calls</h3>
          <p>These choices have no standard value. Each one is labelled in the warehouse, and when a check fails the stock gets no reading.</p>
          <ul className="mb-4 divide-y divide-border border border-border bg-card text-sm leading-6 [&>li]:px-4 [&>li]:py-2.5">
            {JUDGEMENT_CALLS.map((j) => <li key={j}>{j}</li>)}
          </ul>

          <h3>Graham defensive screen</h3>
          <p>{GRAHAM_NOTE}</p>

          <h3>Portfolio optimiser</h3>
          <p>
            The efficient frontier uses three years of dividend-adjusted daily
            prices, a Ledoit–Wolf covariance matrix that shrinks noisy estimates
            toward a stable target, and Bayes–Stein expected returns, which pull
            noisy historical averages toward the minimum-variance portfolio
            (Jorion 1986). The default position cap is the UCITS 10% single-issuer
            limit, which is lifted when fewer than ten stocks make it impossible.
            The optimiser knows nothing about value. The weighted implied excess
            return shown beside it is what the reverse-DCF models say about the
            portfolio it picked.
          </p>
        </Section>

        <Section id="build" n={5} title="How it is built">
          <Image
            src="/Infrastructure-diag.svg"
            alt="Architecture: a Next.js site reads Postgres views; a Python service fetches data from yfinance and runs the optimiser."
            width={0}
            height={0}
            sizes="100vw"
            className="mb-4 h-auto w-full border border-border bg-white p-4"
          />
          <ul className="mb-4 grid gap-px border border-border bg-border sm:grid-cols-3 [&>li]:bg-card [&>li]:px-4 [&>li]:py-3.5">
            {BUILD.map((b) => (
              <li key={b.name} className="flex flex-col gap-1.5">
                <span className="font-heading text-base">{b.name}</span>
                <p className="!mb-0 text-sm leading-6 text-muted-foreground">{b.text}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Data comes from yfinance, an unofficial source with gaps. Nothing here
            is investment advice; this is a demonstration project.
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
          <div className="flex flex-col gap-4 border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
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
