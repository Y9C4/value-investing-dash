import Link from "next/link"

import { DistributionStrip } from "@/components/stock-verdict"
import type { FrontierResponse } from "@/lib/baseline-frontier"
import { DEVELOPMENT_SPAN, EVIDENCE, HOLDOUT_SPAN, evidenceFor } from "@/lib/evidence"
import { DASH, formatPct, formatPp } from "@/lib/format"
import type { Ranking } from "@/lib/screen"
import { DEFAULT_SIGNALS, formatComposite, formatScore } from "@/lib/signals"
import {
  VALUATION_METHODS,
  impliedAlpha,
  impliedAndRequired,
  requiredReturn,
  type Stock,
} from "@/lib/valuation"

/**
 * The overview's worked example: one stock (today's top composite) followed
 * through each step of the model, each step as a small figure drawn from that
 * stock's real numbers and from the index around it. Server-rendered HTML and
 * CSS only (no chart library, no client JS), so the section costs nothing to
 * hydrate. Text stays real text and marks sit on percentage scales, so
 * nothing is squashed at a narrow width.
 *
 * Colour roles follow the rest of the site: teal/magenta for cheap/dear, indigo
 * for the combined score, the accent for the one stock being traced, greys for the rest.
 */

function Swatch({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden="true" className={`inline-block size-2 shrink-0 ${className ?? ""}`} style={style} />
}

function Step({
  n,
  title,
  text,
  caption,
  href,
  link,
  children,
}: {
  n: number
  title: string
  text: string
  caption: React.ReactNode
  href: string
  link: string
  children: React.ReactNode
}) {
  return (
    <li className="flex flex-col gap-3 bg-card px-4 py-3.5">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        <span className="font-figure text-muted-foreground">{n}</span>
        {title}
      </h3>
      <p className="min-h-[4.5rem] text-sm leading-relaxed text-muted-foreground">{text}</p>
      <div className="flex min-h-44 flex-1 flex-col justify-center">{children}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{caption}</p>
      <Link href={href} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
        {link}
      </Link>
    </li>
  )
}

const T1 = "bg-muted-foreground/40"
const T2 = "bg-muted-foreground/80"

/** A rate drawn as its parts end to end, on a scale shared with its sibling. */
function Bar({ parts, total, scale, label }: { parts: [number, string][]; total: number; scale: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={label} className="flex h-4 flex-1 gap-0.5">
        {parts.map(([value, tone], i) => (
          <span key={i} className={tone} style={{ width: `${(value / scale) * 100}%` }} />
        ))}
      </div>
      <span className="w-12 shrink-0 text-right font-figure text-sm font-medium">{formatPct(total)}</span>
    </div>
  )
}

/** 1. Required return: the two discount rates, built up from their parts. */
function RequiredFigure({ stock }: { stock: Stock }) {
  const r = stock.discountRates
  const rf = r?.riskFree ?? null
  const ke = r?.costOfEquity ?? null
  const wacc = r?.wacc ?? null
  const beta = stock.beta
  if (ke === null && wacc === null) return <p className="text-xs text-muted-foreground">No discount rate could be built: no beta was measured.</p>

  const scale = Math.max(ke ?? 0, wacc ?? 0)
  const weight = r?.equityWeight ?? null
  // The equity share of WACC is exact; the debt share is what is left of it.
  const equityPart = wacc !== null && ke !== null && weight !== null ? weight * ke : null
  const debtPart = equityPart !== null && wacc !== null && wacc > equityPart ? wacc - equityPart : null
  const premium = ke !== null && rf !== null && ke >= rf ? ke - rf : null

  return (
    <div className="flex flex-col gap-4">
      {ke !== null && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Cost of equity (CAPM)</span>
          <Bar
            total={ke}
            scale={scale}
            label={`Cost of equity ${formatPct(ke)}`}
            parts={premium !== null && rf !== null ? [[rf, T1], [premium, T2]] : [[ke, T2]]}
          />
          {premium !== null && rf !== null ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Swatch className={T1} />risk-free {formatPct(rf)}</span>
              <span className="flex items-center gap-1.5">
                <Swatch className={T2} />
                β {beta === null ? DASH : beta.toFixed(2)} × market premium {formatPp(premium)}
              </span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">risk-free + β × market premium</span>
          )}
        </div>
      )}
      {wacc !== null && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">WACC</span>
          <Bar
            total={wacc}
            scale={scale}
            label={`WACC ${formatPct(wacc)}`}
            parts={equityPart !== null && debtPart !== null ? [[equityPart, T1], [debtPart, T2]] : [[wacc, T2]]}
          />
          {equityPart !== null && debtPart !== null && weight !== null ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Swatch className={T1} />equity {formatPct(equityPart)} ({Math.round(weight * 100)}% weight)</span>
              <span className="flex items-center gap-1.5"><Swatch className={T2} />after-tax debt {formatPct(debtPart)}</span>
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">equity and after-tax debt, weighted</span>
          )}
        </div>
      )}
    </div>
  )
}

/** 2. Implied return: each model's implied return against what it must beat. */
function ImpliedFigure({ stock }: { stock: Stock }) {
  const rows = VALUATION_METHODS.map((m) => ({
    id: m.id,
    label: m.label,
    implied: stock.signals?.impliedReturns[m.id] ?? null,
    required: requiredReturn(stock, m.id),
  }))
  const solved = rows.flatMap((row) => (row.implied === null ? [] : [row.implied]))
  const maxRequired = Math.max(0, ...rows.map((row) => row.required ?? 0))
  const hi = Math.max(0.2, Math.ceil((maxRequired * 1.6) / 0.05) * 0.05)
  const lo = Math.min(0, Math.floor(Math.min(0, ...solved) / 0.05) * 0.05)
  const pos = (x: number) => `${((Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)) * 100}%`

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const colour =
          row.implied !== null && row.required !== null && row.implied >= row.required
            ? "var(--color-undervalued)"
            : "var(--color-overvalued)"
        const from = row.implied !== null && row.required !== null ? Math.min(row.implied, row.required) : null
        const to = row.implied !== null && row.required !== null ? Math.max(row.implied, row.required) : null
        return (
          <div
            key={row.id}
            className="flex items-center gap-2 text-xs"
            title={`${row.label}: implied ${formatPct(row.implied)}, required ${formatPct(row.required)}`}
          >
            <span className="w-[6.75rem] shrink-0 whitespace-nowrap text-muted-foreground">{row.label}</span>
            <div className="relative h-5 flex-1">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              {from !== null && to !== null && (
                <span
                  className="absolute top-1/2 h-0.5 -translate-y-1/2"
                  style={{ left: pos(from), width: `${((Math.min(Math.max(to, lo), hi) - Math.min(Math.max(from, lo), hi)) / (hi - lo)) * 100}%`, background: colour }}
                />
              )}
              {row.required !== null && (
                <span className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-foreground" style={{ left: pos(row.required) }} />
              )}
              {row.implied !== null && (
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: pos(row.implied), background: colour }}
                />
              )}
            </div>
            <span className="w-[4.25rem] shrink-0 text-right font-figure text-sm">
              {row.implied === null ? <span className="font-sans text-[11px] text-muted-foreground">can&rsquo;t solve</span> : formatPct(row.implied)}
              {row.implied !== null && row.implied > hi && <span aria-hidden="true" className="text-muted-foreground"> ▸</span>}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="w-[6.75rem] shrink-0" />
        <div className="relative h-3.5 flex-1">
          <span className="absolute left-0">{formatPct(lo, 0)}</span>
          <span className="absolute right-0">{formatPct(hi, 0)}</span>
        </div>
        <span className="w-[4.25rem] shrink-0" />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: "var(--color-undervalued)" }} />
          above required
          <span aria-hidden="true" className="ml-1 size-2 rounded-full" style={{ background: "var(--color-overvalued)" }} />
          below
        </span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0.5 bg-foreground" />required</span>
      </div>
    </div>
  )
}

/** 4. The composite: every scored stock by its two percentiles, the leaders marked. */
function CompositeFigure({
  stock,
  stocks,
  ranking,
  topTen,
}: {
  stock: Stock
  stocks: Stock[]
  ranking: Ranking
  topTen: Set<string>
}) {
  const dots = stocks.flatMap((s) => {
    const v = ranking.value.get(s.ticker)
    const m = s.signals?.momentumRank
    return v !== undefined && m !== null && m !== undefined && ranking.score.has(s.ticker)
      ? [{ ticker: s.ticker, v, m }]
      : []
  })
  const place = (d: { v: number; m: number }): React.CSSProperties => ({
    left: `${2 + d.v * 96}%`,
    bottom: `${2 + d.m * 96}%`,
  })
  const mine = dots.find((d) => d.ticker === stock.ticker)

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground" aria-hidden="true">↑ momentum percentile</span>
      <div
        role="img"
        aria-label={`Value percentile against momentum percentile for ${dots.length} stocks; ${stock.ticker} and the other nine highest scores are marked.`}
        className="relative mr-12 h-28 border-b border-l border-border"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
        <span className="absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden="true" />
        <div className="[&>span]:absolute [&>span]:size-[3px] [&>span]:-translate-x-1/2 [&>span]:translate-y-1/2 [&>span]:rounded-full [&>span]:bg-muted-foreground/45">
          {dots.filter((d) => !topTen.has(d.ticker)).map((d) => (
            <span key={d.ticker} style={place(d)} />
          ))}
        </div>
        {dots.filter((d) => topTen.has(d.ticker) && d.ticker !== stock.ticker).map((d) => (
          <span
            key={d.ticker}
            title={`${d.ticker}: value ${formatScore(d.v)}, momentum ${formatScore(d.m)}, score ${formatComposite(ranking.score.get(d.ticker) ?? null)}`}
            className="absolute size-[7px] -translate-x-1/2 translate-y-1/2 rounded-full ring-1 ring-card"
            style={{ ...place(d), background: "var(--color-signal-q5)" }}
          />
        ))}
        {mine && (
          <>
            <span
              title={`${stock.ticker}: value ${formatScore(mine.v)}, momentum ${formatScore(mine.m)}`}
              className="absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-primary ring-2 ring-card"
              style={place(mine)}
            />
            <span
              aria-hidden="true"
              className="absolute left-[calc(100%+0.5rem)] translate-y-1/2 font-figure text-xs font-semibold"
              style={{ bottom: place(mine).bottom }}
            >
              {stock.ticker}
            </span>
          </>
        )}
      </div>
      <div className="mr-12 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true">
        <span>0</span>
        <span>value percentile (100 = cheapest) →</span>
        <span>100</span>
      </div>
    </div>
  )
}

/** Whole months strictly between two "YYYY-MM" labels. */
function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number)
  const [by, bm] = b.split("-").map(Number)
  return (by - ay) * 12 + (bm - am) - 1
}

/** 5. The out-of-sample test: the months on a line, to scale, with what each sample measured. */
function ValidationFigure() {
  const chosen = evidenceFor(DEFAULT_SIGNALS)
  if (!chosen) return null
  const { development: dev, holdout } = chosen
  const embargo = Math.max(monthsBetween(EVIDENCE.samples.Development.last, EVIDENCE.samples.Holdout.first), 0)
  const grow = (months: number): React.CSSProperties => ({ flex: `${months} 1 0%` })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-0.5 text-[11px] text-muted-foreground" aria-hidden="true">
        <span style={grow(dev.months)} className="min-w-0">design period</span>
        <span style={grow(embargo)} className="flex min-w-0 justify-center overflow-visible whitespace-nowrap">gap</span>
        <span style={grow(holdout.months)} className="min-w-0 text-right text-foreground">unseen test</span>
      </div>
      <div
        role="img"
        aria-label={`${dev.months} design months, a ${embargo}-month gap, then ${holdout.months} unseen test months, drawn to scale.`}
        className="flex h-5 gap-0.5"
      >
        <span style={grow(dev.months)} className="bg-muted-foreground/40" />
        <span
          style={{ ...grow(embargo), backgroundImage: "repeating-linear-gradient(135deg, var(--color-border) 0 2px, transparent 2px 5px)" }}
        />
        <span style={grow(holdout.months)} className="bg-muted-foreground/85" />
      </div>
      <div className="flex gap-0.5 pt-1">
        {[
          { months: dev.months, ic: dev.ic, t: dev.t, span: DEVELOPMENT_SPAN, name: "Design" },
          { months: embargo, ic: null, t: 0, span: "", name: "" },
          { months: holdout.months, ic: holdout.ic, t: holdout.t, span: HOLDOUT_SPAN, name: "Test" },
        ].map((cell, i) => (
          <div key={i} style={grow(cell.months)} className="min-w-0">
            {cell.ic !== null && (
              <>
                <div className="font-figure text-lg leading-tight font-semibold">{cell.ic.toFixed(3)}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {cell.name} rank IC, t = {cell.t.toFixed(2)}
                  <br />
                  {cell.months} months, {cell.span}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 6. The portfolio: the real optimised frontier, with the tangency point and the index. */
function FrontierFigure({ frontier }: { frontier: FrontierResponse | null }) {
  const env = frontier?.envelope ?? []
  if (!frontier || env.length < 3) {
    return (
      <dl className="grid grid-cols-2 gap-px overflow-clip rounded-lg border border-border bg-border [&>div]:bg-card [&>div]:px-3 [&>div]:py-2">
        <div>
          <dt className="text-[11px] text-muted-foreground">Estimation window</dt>
          <dd className="font-figure text-sm font-medium">3 years, daily</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Position cap</dt>
          <dd className="font-figure text-sm font-medium">10% (UCITS)</dd>
        </div>
      </dl>
    )
  }
  const market = frontier.market
  const xs = [...env.map((p) => p.volatility), ...(market ? [market.volatility] : [])]
  const ys = [...env.map((p) => p.return), ...(market ? [market.return] : [])]
  const span = (v: number[]) => {
    const lo = Math.min(...v)
    const hi = Math.max(...v)
    const pad = (hi - lo) * 0.1 || 0.01
    return [lo - pad, hi + pad] as const
  }
  const [x0, x1] = span(xs)
  const [y0, y1] = span(ys)
  const px = (v: number) => ((v - x0) / (x1 - x0)) * 100
  const py = (r: number) => 100 - ((r - y0) / (y1 - y0)) * 100
  const tan = frontier.max_sharpe
  const label = (x: number) => (x > 62 ? "-translate-x-[calc(100%+0.6rem)]" : "translate-x-[0.6rem]")

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground" aria-hidden="true">↑ expected return</span>
      <div
        role="img"
        aria-label={`The efficient frontier of ${frontier.n_assets ?? "the index's"} stocks; the maximum-Sharpe portfolio returns ${formatPct(tan.return)} at ${formatPct(tan.volatility)} volatility${market ? `, against ${formatPct(market.return)} at ${formatPct(market.volatility)} for the S&P 500` : ""}.`}
        className="relative h-32 border-b border-l border-border"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <polyline
            points={env.map((p) => `${px(p.volatility).toFixed(2)},${py(p.return).toFixed(2)}`).join(" ")}
            fill="none"
            stroke="var(--color-foreground)"
            strokeOpacity="0.7"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className="absolute top-0 left-1.5 font-figure text-[11px] text-muted-foreground" aria-hidden="true">{formatPct(y1, 0)}</span>
        <span className="absolute bottom-0 left-1.5 font-figure text-[11px] text-muted-foreground" aria-hidden="true">{formatPct(y0, 0)}</span>
        {market && (
          <>
            <span
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-foreground bg-card"
              style={{ left: `${px(market.volatility)}%`, top: `${py(market.return)}%` }}
              aria-hidden="true"
            />
            <span
              className={`absolute -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground ${label(px(market.volatility))}`}
              style={{ left: `${px(market.volatility)}%`, top: `${py(market.return)}%` }}
              aria-hidden="true"
            >
              S&amp;P 500
            </span>
          </>
        )}
        <span
          className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: `${px(tan.volatility)}%`, top: `${py(tan.return)}%` }}
          aria-hidden="true"
        />
        <span
          className={`absolute -translate-y-1/2 text-[11px] font-semibold whitespace-nowrap ${label(px(tan.volatility))}`}
          style={{ left: `${px(tan.volatility)}%`, top: `${py(tan.return)}%` }}
          aria-hidden="true"
        >
          max Sharpe
        </span>
      </div>
      <div className="flex justify-between font-figure text-[11px] text-muted-foreground" aria-hidden="true">
        <span>{formatPct(x0, 0)}</span>
        <span className="font-sans">volatility →</span>
        <span>{formatPct(x1, 0)}</span>
      </div>
    </div>
  )
}

export function WorkedExample({
  stock,
  stocks,
  ranked,
  ranking,
  gaps,
  frontier,
}: {
  stock: Stock
  /** The whole index. */
  stocks: Stock[]
  /** Stocks with a composite, best first. */
  ranked: Stock[]
  ranking: Ranking
  /** Implied − required for every stock a model could value. */
  gaps: number[]
  frontier: FrontierResponse | null
}) {
  const ticker = stock.ticker
  const chosen = evidenceFor(DEFAULT_SIGNALS)
  const topTen = new Set(ranked.slice(0, 10).map((s) => s.ticker))
  const alpha = impliedAlpha(stock)
  const pair = impliedAndRequired(stock)
  const solved = VALUATION_METHODS.filter((m) => stock.signals?.impliedReturns[m.id] != null && requiredReturn(stock, m.id) !== null).length
  const below = alpha === null ? 0 : gaps.filter((g) => g < alpha).length
  const betaRaw = stock.discountRates?.betaRaw
  const kept = chosen ? Math.round((chosen.holdout.ic / chosen.development.ic) * 100) : null
  const tan = frontier?.max_sharpe
  const positions = tan ? Object.keys(tan.weights).length : 0

  return (
    <section aria-labelledby="steps" className="flex flex-col gap-4">
      <div className="flex max-w-4xl flex-col gap-1.5">
        <h2 id="steps" className="font-heading text-xl leading-snug sm:text-2xl">
          How the ranking works, using today&rsquo;s top stock: {ticker}
        </h2>
        <p className="text-sm text-muted-foreground">
          Six steps, with live numbers for {stock.name}.
        </p>
      </div>

      <ol className="grid gap-px overflow-clip rounded-lg border border-border bg-border md:grid-cols-2 xl:grid-cols-3">
        <Step
          n={1}
          title="What return should it earn?"
          text="Riskier stocks should pay more. We estimate the required return two ways: cost of equity (CAPM) and WACC, with the cost of debt taken from a synthetic credit rating."
          caption={
            <>
              {betaRaw != null && stock.beta !== null ? (
                <>Beta is {stock.beta.toFixed(2)}, adjusted from a measured {betaRaw.toFixed(2)} toward the market average (Levi and Welch 2017). </>
              ) : null}
              {stock.discountRates?.syntheticRating ? <>Synthetic credit rating: {stock.discountRates.syntheticRating}.</> : null}
            </>
          }
          href="/methodology#assumptions"
          link="Every assumption and its source"
        >
          <RequiredFigure stock={stock} />
        </Step>

        <Step
          n={2}
          title="What return does the price imply?"
          text="A reverse DCF works backwards from today’s price to the return a buyer would earn if the forecast cash flows arrive. Four models each give an answer."
          caption={
            pair ? (
              <>
                {solved} of {VALUATION_METHODS.length} models work for this stock. They average {formatPct(pair.implied)}, against a required {formatPct(pair.required)}.
              </>
            ) : (
              <>No model can be solved at today&rsquo;s price.</>
            )
          }
          href={`/stocks/${ticker}`}
          link={`${ticker}’s full analysis`}
        >
          <ImpliedFigure stock={stock} />
        </Step>

        <Step
          n={3}
          title="How big is the gap?"
          text="Implied return minus required return gives the return gap. We rank every stock on it. The order has been useful; the size of the gap has not been a reliable forecast."
          caption={
            alpha === null ? (
              <>No value reading.</>
            ) : (
              <>
                A gap of {formatPp(alpha)} beats {below} of {gaps.length} stocks: value percentile {formatScore(ranking.value.get(ticker) ?? null)}.
              </>
            )
          }
          href="/methodology#value"
          link="How value is measured"
        >
          {alpha === null ? (
            <p className="text-sm text-muted-foreground">No model could value {ticker}.</p>
          ) : (
            <DistributionStrip values={gaps} alpha={alpha} ticker={ticker} className="max-w-none" heightClass="h-24" />
          )}
        </Step>

        <Step
          n={4}
          title="Is the market noticing?"
          text="Momentum is the past year’s price change, skipping the latest month. We average the value and momentum percentiles into one score from 0 to 100."
          caption={
            <>
              {ticker} scores {formatComposite(ranking.score.get(ticker) ?? null)}, the highest of {ranked.length} stocks. Next:{" "}
              {ranked.slice(1, 4).map((s, i, next) => (
                <span key={s.ticker}>
                  {i > 0 && (i === next.length - 1 ? " and " : ", ")}
                  <Link href={`/stocks/${s.ticker}`} className="underline underline-offset-2 hover:text-foreground">{s.ticker}</Link>{" "}
                  ({formatComposite(ranking.score.get(s.ticker) ?? null)})
                </span>
              ))}
              .
            </>
          }
          href="/screener"
          link={`All ${stocks.length} in the screener`}
        >
          <CompositeFigure stock={stock} stocks={stocks} ranking={ranking} topTen={topTen} />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-primary" />{ticker}</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full" style={{ background: "var(--color-signal-q5)" }} />top ten scores</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/60" />the rest</span>
          </p>
        </Step>

        <Step
          n={5}
          title="Was it tested fairly?"
          text="We made every choice on the earlier months, locked the rules, then scored them once on later months the model had never seen."
          caption={
            chosen && kept !== null ? (
              <>
                On unseen data the score kept {kept}% of its rank IC, and the t-stat fell from {chosen.development.t.toFixed(2)} to {chosen.holdout.t.toFixed(2)}.
              </>
            ) : null
          }
          href="/research"
          link="Backtest results and notebooks"
        >
          <ValidationFigure />
        </Step>

        <Step
          n={6}
          title="Build a portfolio"
          text="The optimiser takes the stocks you pick and finds the mix with the most expected return for its risk, using Bayes–Stein returns and Ledoit–Wolf covariance."
          caption={
            tan ? (
              <>
                The best mix has a Sharpe ratio of {tan.sharpe.toFixed(2)}
                {frontier?.market ? <> (S&amp;P 500: {frontier.market.sharpe.toFixed(2)})</> : null} across {positions} stocks. These figures are fitted to the last three years of prices, so they are not a forecast.
              </>
            ) : (
              <>Runs on the stocks you tick, using three years of daily prices and a 10% cap per stock.</>
            )
          }
          href="/portfolio"
          link="Portfolio optimiser"
        >
          <FrontierFigure frontier={frontier} />
        </Step>
      </ol>
    </section>
  )
}
