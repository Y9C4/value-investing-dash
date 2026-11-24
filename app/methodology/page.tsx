import Image from "next/image"
import { RiGithubFill, RiLinkedinBoxFill, RiMailLine } from "@remixicon/react"

import { SIGNAL_COMPONENTS, SIGNAL_EVIDENCE } from "@/lib/signals"
import { GRAHAM_NOTE } from "@/lib/screen"

export const metadata = {
  title: "Methodology",
  description:
    "How Value Investing Dash values the S&P 500: reverse DCF, the trend and earnings confirmations, the backtest behind them, and every assumption with its source.",
}

/** Development-period results, backtests.md §13 (run of 2026-11-23). */
const SIGNAL_RESULTS = [
  { signal: "Value + trend", ic: "0.054", t: "1.92", spread: "0.8%", coverage: "96%" },
  { signal: "Trend + earnings", ic: "0.035", t: "1.47", spread: "0.8%", coverage: "97%" },
  { signal: "Value", ic: "0.032", t: "1.18", spread: "0.3%", coverage: "96%" },
  { signal: "Trend (12-1 momentum)", ic: "0.029", t: "1.18", spread: "0.5%", coverage: "99%" },
  { signal: "Earnings surprise", ic: "0.024", t: "1.45", spread: "0.2%", coverage: "97%" },
]

/** Test 2: each reverse-DCF model against the plain ratio built on the same figures. */
const MODEL_VS_RATIO = [
  { model: "FCFF", ratio: "FCF yield", modelIc: "0.034", ratioIc: "0.015" },
  { model: "Residual income", ratio: "Earnings yield", modelIc: "0.021", ratioIc: "−0.002" },
  { model: "Residual income", ratio: "Book-to-price", modelIc: "0.021", ratioIc: "0.005" },
  { model: "Revenue", ratio: "Sales-to-EV", modelIc: "0.029", ratioIc: "0.024" },
  { model: "Shareholder yield", ratio: "Payout ÷ market cap", modelIc: "0.043", ratioIc: "0.024" },
  { model: "All four, averaged", ratio: "Plain-ratio composite", modelIc: "0.032", ratioIc: "0.012" },
]

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
  { what: "Trend", value: "12-month return skipping the last month", source: "Jegadeesh & Titman (1993)" },
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

const GLOSSARY = [
  ["Reverse DCF", "Solving a discounted cash flow model for the discount rate that makes it equal today's price, rather than discounting at an assumed rate to get a fair value."],
  ["Implied return", "That discount rate: what buying at today's price earns if the cash flows arrive as modelled."],
  ["Required return", "What the stock's risk says it should earn: WACC for whole-firm models, the CAPM cost of equity for equity models."],
  ["kₑ (cost of equity)", "10Y Treasury + beta × market premium (CAPM)."],
  ["WACC", "The blended cost of equity and after-tax debt, weighted by market value."],
  ["Percentile", "The share of the index at or below a stock. 100 is the top."],
  ["Rank IC", "The correlation between this month's ranking and next month's returns, by rank. 0.05 is useful in practice; 0 is noise."],
  ["t-stat", "How many standard errors the mean IC is from zero. About 2 is the usual bar for significance."],
  ["Q5 − Q1", "The monthly return of the top fifth minus the bottom fifth."],
  ["12-1 momentum", "The return from twelve months ago to one month ago."],
] as const

const LINKS = [
  { label: "GitHub", href: "https://github.com/Y9C4", icon: RiGithubFill },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/yajat-charpe-05a372318/", icon: RiLinkedinBoxFill },
  { label: "Email", href: "mailto:yajatcharpe@gmail.com", icon: RiMailLine },
]

export default function MethodologyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-10 text-sm leading-relaxed lg:px-10 [&_h2]:mt-12 [&_h2]:mb-3 [&_h2]:font-heading [&_h2]:text-xl [&_h3]:mt-6 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:mb-1.5 [&_p]:mb-4 [&_table]:mb-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">
      <p className="font-heading text-2xl leading-snug">
        Value Investing Dash asks one question of every S&amp;P 500 stock: what
        return does today&rsquo;s price imply, and is that more or less than
        the stock&rsquo;s risk requires?
      </p>
      <p className="text-muted-foreground">
        It answers by ranking, not by naming a fair value, and checks the
        answer against two confirmations: whether the market has started to
        agree (trend), and whether the business just beat expectations
        (earnings). Every number is recomputed after each trading day.
      </p>

      <h2>Value: reverse DCF</h2>
      <p>
        A conventional DCF assumes a discount rate and produces a fair value.
        Small changes to that rate swing the answer wildly: a lumpy cash flow
        year or a low cost of equity can make a stock look 700% undervalued.
        A reverse DCF runs the model the other way. It takes the price as given
        and solves for the annual return that makes five years of cash flow,
        then a perpetuity, worth exactly that price. A return is a number you
        can sanity-check: the median is a few percent a year.
      </p>
      <p>
        Four models solve independently, and value is the average of whichever
        solve, each minus the return it must beat:
      </p>
      <ul>
        <li><strong>FCFF</strong>: free cash flow to the firm against enterprise value, measured against WACC.</li>
        <li><strong>Residual income</strong>: book value plus earnings above the cost of equity, against market cap. The one model that works for banks.</li>
        <li><strong>Revenue</strong>: revenue with a cash margin fading to the sector median, so it can speak for firms whose cash flow is temporarily negative. Against WACC.</li>
        <li><strong>Shareholder yield</strong>: dividends plus net buybacks, the cash an owner actually receives. Against the cost of equity.</li>
      </ul>
      <p>
        The screener shows value as a percentile, 0–100 across the index, and
        cuts it into fifths recomputed with every refresh (Fama &amp; French
        sorts). &ldquo;Cheapest fifth&rdquo; means exactly that: cheap against
        the rest of the index, not below some intrinsic worth. The stock page
        also solves the same FCFF model for growth, holding the return at
        WACC: the growth today&rsquo;s price assumes, shown beside the growth
        the company has actually delivered.
      </p>

      <h2>Trend and earnings: confirmation</h2>
      <p>
        Cheap stocks are often cheap for a reason. The two confirmations ask
        whether anything is changing. Combining value with momentum is one of
        the most robust results in asset pricing (Asness, Moskowitz &amp;
        Pedersen 2013), because the two tend to work at different times.
      </p>
      <table>
        <thead>
          <tr><th>Component</th><th>What it measures</th></tr>
        </thead>
        <tbody>
          {SIGNAL_COMPONENTS.map((c) => (
            <tr key={c.id}>
              <td className="font-semibold">{c.label}</td>
              <td>{c.blurb}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The default score averages the value and trend percentiles equally and
        re-ranks the result, so its fifths hold equal numbers of stocks.
      </p>

      <h2>The evidence</h2>
      <p>
        Every signal was backtested month by month on the S&amp;P 500, using
        only statements that were public at the time, against next-month
        returns adjusted for the five Fama-French factors.
      </p>
      <h3>Signal quality, development period</h3>
      <table>
        <thead>
          <tr><th>Signal</th><th className="text-right">Rank IC</th><th className="text-right">t-stat</th><th className="text-right">Q5 − Q1 / month</th><th className="text-right">Coverage</th></tr>
        </thead>
        <tbody>
          {SIGNAL_RESULTS.map((r) => (
            <tr key={r.signal}>
              <td>{r.signal}</td>
              <td className="text-right font-mono">{r.ic}</td>
              <td className="text-right font-mono">{r.t}</td>
              <td className="text-right font-mono">{r.spread}</td>
              <td className="text-right font-mono">{r.coverage}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">{SIGNAL_EVIDENCE}</p>

      <h3>Does the model beat the plain ratio?</h3>
      <p>
        A reverse DCF with flat growth is just a yield, so the model earns its
        place only if its assumptions add something. Each was tested against
        the ratio built on the same figures, on the same stocks:
      </p>
      <table>
        <thead>
          <tr><th>Model</th><th>Plain ratio</th><th className="text-right">Model IC</th><th className="text-right">Ratio IC</th></tr>
        </thead>
        <tbody>
          {MODEL_VS_RATIO.map((r) => (
            <tr key={`${r.model}-${r.ratio}`}>
              <td>{r.model}</td>
              <td>{r.ratio}</td>
              <td className="text-right font-mono">{r.modelIc}</td>
              <td className="text-right font-mono">{r.ratioIc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Every model beat its ratio, which is why the ratios appear on the site
        as context rather than as the ranking. A fifth model, sector-relative
        multiples, failed and was dropped.
      </p>

      <h3>What the evidence does not show</h3>
      <ul>
        <li><strong>Nothing is statistically significant yet.</strong> The best t-stat is 1.92 on 23 months; about 2 is the usual bar.</li>
        <li><strong>The holdout has not been run.</strong> 18 months (May 2025 – Oct 2026) are locked for a single, final test after the specification is frozen.</li>
        <li><strong>The size of the gap is not a forecast.</strong> A stock whose price implies 5 points more than required did not go on to earn 5 points more; the calibration slope is 0.17. Rank, don&rsquo;t read.</li>
        <li><strong>Survivorship bias.</strong> The universe is today&rsquo;s S&amp;P 500, so stocks that left the index are missing.</li>
        <li><strong>One regime.</strong> 2023–2026 was led by mega-cap growth, a poor stretch for value.</li>
      </ul>

      <h2>Every assumption, and its source</h2>
      <p>
        A constant needs a published method, a regulatory fact, or a backtest
        result behind it. Missing data produces no reading, never a guess: an
        unmeasured figure shows as a dash, not a zero.
      </p>
      <table>
        <thead>
          <tr><th>Input</th><th>Setting</th><th>Source</th></tr>
        </thead>
        <tbody>
          {ASSUMPTIONS.map((a) => (
            <tr key={a.what}>
              <td className="font-semibold">{a.what}</td>
              <td>{a.value}</td>
              <td className="text-muted-foreground">{a.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Judgement calls</h3>
      <p>No canonical value exists for these; each is labelled in the warehouse and returns no reading when it fails.</p>
      <ul>
        {JUDGEMENT_CALLS.map((j) => <li key={j}>{j}</li>)}
      </ul>

      <h3>Graham defensive screen</h3>
      <p>{GRAHAM_NOTE}</p>

      <h3>Portfolio optimiser</h3>
      <p>
        The efficient frontier uses three years of dividend-adjusted daily
        prices, a Ledoit-Wolf shrunk covariance matrix, and Bayes-Stein
        expected returns (Jorion 1986), which pull noisy historical means
        toward the minimum-variance portfolio. The default position cap is the
        UCITS 10% single-issuer limit, lifted when fewer than ten stocks make
        it impossible. The optimiser knows nothing about value: the value
        tilt shown beside it is what the reverse-DCF models say about the
        portfolio it picked.
      </p>

      <h2>How it is built</h2>
      <Image
        src="/Infrastructure-diag.svg"
        alt="Architecture: a Next.js site reads Postgres views; a Python service fetches data from yfinance and runs the optimiser."
        width={0}
        height={0}
        sizes="100vw"
        className="my-4 h-auto w-full"
      />
      <ul>
        <li><strong>Database</strong>: Supabase Postgres. A raw schema holds prices and statements exactly as fetched; a warehouse schema computes every signal, rate and ratio in SQL after each fetch; read-only views serve the site.</li>
        <li><strong>Data service</strong>: Python (FastAPI) on Cloud Run. Fetches from yfinance and runs the optimiser (PyPortfolioOpt, Clarabel). Write paths are closed behind a token.</li>
        <li><strong>Site</strong>: Next.js and React, reading one cached view. The browser only re-ranks when a model or signal is toggled.</li>
      </ul>
      <p className="text-muted-foreground">
        Data comes from yfinance, an unofficial source with gaps. Nothing here
        is investment advice; this is a demonstration project.
      </p>

      <h2>Glossary</h2>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        {GLOSSARY.map(([term, meaning]) => (
          <div key={term} className="contents">
            <dt className="font-semibold">{term}</dt>
            <dd className="mb-2 text-muted-foreground sm:mb-0">{meaning}</dd>
          </div>
        ))}
      </dl>

      <h2 id="about">About</h2>
      <p>
        Built by Yajat Charpe, Bachelor of Commerce and Computer Science at
        Monash University (graduating November 2027).
      </p>
      <div className="flex items-center gap-4">
        {LINKS.map(({ label, href, icon: Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </a>
        ))}
      </div>
    </article>
  )
}
