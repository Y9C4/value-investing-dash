import { missingReason } from "@/components/stock-readings"
import { formatMarketCap, formatPct, formatPp, formatSharePrice } from "@/lib/format"
import { histogram } from "@/lib/rank"
import { cn } from "@/lib/utils"
import {
  VALUATION_METHODS,
  impliedAlpha,
  impliedAndRequired,
  methodAlpha,
  valuationBand,
  type Stock,
} from "@/lib/valuation"

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** One line of the stacked sum: sign, what it is, the rate. */
function Line({ sign, label, note, value }: { sign?: string; label: string; note: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2">
        {/* The labels carry the meaning; the sign is decoration. */}
        <span aria-hidden="true" className="w-3 font-figure text-sm text-muted-foreground">{sign}</span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-xs text-muted-foreground">{note}</span>
        </span>
      </dt>
      <dd className="font-figure text-3xl leading-none font-semibold">{value}</dd>
    </div>
  )
}

/**
 * Where this stock's implied excess return sits in today's index: the
 * distribution as a strip of bins (magenta below zero, teal above), this stock's
 * bin at full strength and a marker on its reading.
 */
export function DistributionStrip({
  values,
  alpha,
  ticker,
  className,
  heightClass = "h-8",
  label = "Return gap",
}: {
  /** What the plotted figure is called on the page drawing it. */
  label?: string
  values: number[]
  alpha: number
  ticker: string
  className?: string
  /** The strip's height; the stock page's is a thin one, the overview's a plot. */
  heightClass?: string
}) {
  const bins = histogram(values)
  if (bins.length < 2) return null
  const lo = bins[0].lo
  const hi = bins[bins.length - 1].hi
  const peak = Math.max(...bins.map((bin) => bin.count))
  const share = (x: number) => (Math.min(Math.max(x, lo), hi) - lo) / (hi - lo)
  const at = (x: number) => `${(share(x) * 100).toFixed(2)}%`
  const where = share(alpha)
  const below = values.filter((v) => v < alpha).length
  // The bin `histogram` counted this stock in; the edge bins hold the tails.
  const found = bins.findIndex((bin) => alpha < bin.hi)
  const mine = found === -1 ? bins.length - 1 : found
  const pp = (x: number) => formatPp(x).replace(" pp", "")

  return (
    <figure className={cn("flex w-full max-w-xl flex-col gap-1", className)}>
      <figcaption className="text-xs text-muted-foreground">
        {label} across {values.length} S&amp;P 500 stocks, pp p.a.
      </figcaption>
      <div
        role="img"
        aria-label={`${ticker}'s return gap of ${formatPp(alpha)} is higher than ${below} of ${values.length} valued stocks.`}
        className={cn("relative mt-5", heightClass)}
      >
        <div className="absolute inset-0 flex items-end gap-0.5">
          {bins.map((bin, i) => (
            <div
              key={bin.lo}
              className="flex-1"
              style={{
                height: `${Math.max((bin.count / peak) * 100, 4)}%`,
                background: bin.hi <= 0 ? "var(--color-overvalued)" : "var(--color-undervalued)",
                opacity: i === mine ? 1 : 0.45,
              }}
            />
          ))}
        </div>
        {/* Zero: implied equals required. */}
        <span
          aria-hidden="true"
          className="absolute -inset-y-1 w-px bg-muted-foreground"
          style={{ left: at(0) }}
        />
        <span
          aria-hidden="true"
          className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: at(alpha) }}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute -top-6 font-figure text-xs font-semibold whitespace-nowrap",
            where < 0.15 ? "" : where > 0.85 ? "-translate-x-full" : "-translate-x-1/2"
          )}
          style={{ left: at(alpha) }}
        >
          {alpha < lo && "◂ "}
          {ticker} {formatPp(alpha)}
          {alpha > hi && " ▸"}
        </span>
      </div>
      <div className="relative h-4 font-figure text-xs text-muted-foreground" aria-hidden="true">
        <span className="absolute left-0">{pp(lo)}</span>
        {share(0) > 0.1 && share(0) < 0.9 && (
          <span className="absolute -translate-x-1/2" style={{ left: at(0) }}>
            0
          </span>
        )}
        <span className="absolute right-0">{pp(hi)}</span>
      </div>
    </figure>
  )
}

const VALUE_PLACE: Record<ReturnType<typeof valuationBand>, string> = {
  "deep-value": "in the cheapest quintile (Q5) of the S&P 500 on value",
  undervalued: "in the second cheapest quintile (Q4) of the S&P 500 on value",
  fair: "in the middle quintile (Q3) of the S&P 500 on value",
  overvalued: "in the second most expensive quintile (Q2) of the S&P 500 on value",
  expensive: "in the most expensive quintile (Q1) of the S&P 500 on value",
  unrated: "not ranked on value",
}

/** Where the stock's return gap falls across the index. Sits with the ranking. */
export function StockStanding({ stock, stocks }: { stock: Stock; stocks: Stock[] }) {
  const alpha = impliedAlpha(stock)
  if (alpha === null) return null
  const values = stocks.flatMap((s) => {
    const a = impliedAlpha(s)
    return a === null ? [] : [a]
  })
  return <DistributionStrip values={values} alpha={alpha} ticker={stock.ticker} className="max-w-none" label="Implied alpha distribution" />
}

/**
 * The stock page's verdict: the price to the left, and beside it the two rates
 * as a sum, tinted by its sign, with one sentence saying what it means.
 */
export function StockVerdict({
  stock,
  valueRank,
  chart,
}: {
  stock: Stock
  valueRank: number | null
  /** The price chart, top left where there is room for it. */
  chart: React.ReactNode
}) {
  const rates = impliedAndRequired(stock)
  const alpha = impliedAlpha(stock)
  const band = valuationBand(valueRank)
  const counted = VALUATION_METHODS.filter((method) => methodAlpha(stock, method.id) !== null)
  const solved = VALUATION_METHODS.filter(
    (method) => stock.signals?.impliedReturns[method.id] != null
  )
  // With no required return to set against it, the implied return still says something.
  const implied =
    rates?.implied ??
    (solved.length > 0
      ? solved.reduce((sum, method) => sum + stock.signals!.impliedReturns[method.id]!, 0) / solved.length
      : null)

  // Green when the price offers more than the risk requires, red when less.
  const tone = alpha === null || alpha === 0 ? null : alpha > 0 ? "var(--primary)" : "var(--destructive)"

  return (
    <header className="grid gap-4 px-6 pt-6 lg:px-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* Before the chart in the document, so a phone reads the verdict first. */}
      <div
        className="flex min-w-0 flex-col gap-4 border border-border bg-card px-5 py-4"
        style={
          tone
            ? {
                background: `color-mix(in oklab, ${tone} 10%, var(--card))`,
                borderColor: `color-mix(in oklab, ${tone} 45%, transparent)`,
              }
            : undefined
        }
      >
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-2xl">{stock.name}</h2>
          <span className="font-figure text-sm text-muted-foreground">
            {stock.exchange ? `${stock.exchange}: ` : ""}
            {stock.ticker} · {formatSharePrice(stock.price)}
            {stock.marketCap !== null && ` · ${formatMarketCap(stock.marketCap)}`} · {stock.sector}
          </span>
        </div>

        <dl className="flex flex-col gap-3">
          <Line label="Implied return" note={`p.a. at ${formatSharePrice(stock.price)}`} value={formatPct(implied)} />
          <Line sign="−" label="Required return" note="p.a., mean WACC, kₑ" value={formatPct(rates?.required)} />
          <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
            <dt className="flex items-center gap-2">
              <span aria-hidden="true" className="w-3 font-figure text-sm text-muted-foreground">=</span>
              <span className="text-sm font-semibold">Implied alpha</span>
            </dt>
            <dd className="flex items-center font-figure text-4xl leading-none font-semibold" style={tone ? { color: tone } : undefined}>
              {formatPp(alpha).replace(/ pp$/, "")}
              {alpha !== null && <span className="ml-1 text-2xl leading-none">pp</span>}
            </dd>
          </div>
        </dl>

      <p className="text-sm leading-relaxed">
        {rates === null ? (
          <>
            {stock.ticker} has no value rank:{" "}
            {solved.length === 0
              ? "none of the four reverse-DCF models can be solved at this price."
              : "the models that solve have no required return to compare against."}
          </>
        ) : (
          <>
            At {formatSharePrice(stock.price)}, {stock.ticker} has an implied return of{" "}
            {formatPct(rates.implied)} p.a., with an alpha of {formatPp(alpha)} compared with its
            required return. It&rsquo;s {VALUE_PLACE[band]}.
          </>
        )}
      </p>
        <p className="text-xs text-muted-foreground">
          {counted.length > 0
            ? `Mean of ${counted.length} of 4 models: ${counted.map((m) => m.label).join(", ")}.`
            : solved.length > 0
              ? `${solved.length === 1 ? "One model solves" : `${solved.length} models solve`}, but none has a required return: ${lowerFirst(missingReason(stock, solved[0]) ?? "")}.`
              : "No reverse-DCF model can be solved at this price."}
        </p>
      </div>
      <div className="min-w-0 xl:order-first">{chart}</div>
    </header>
  )
}
