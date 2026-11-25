import { compositeQuintileLabel, missingReason, valueQuintileLabel } from "@/components/stock-readings"
import { DASH, formatMarketCap, formatPct, formatPp, formatSharePrice } from "@/lib/format"
import { histogram } from "@/lib/rank"
import { SIGNAL_BAND_FILL, formatComposite, formatScore, signalBand } from "@/lib/signals"
import { cn } from "@/lib/utils"
import {
  BAND_FILL,
  VALUATION_METHODS,
  gapTextClass,
  impliedAlpha,
  impliedAndRequired,
  methodAlpha,
  valuationBand,
  type Stock,
} from "@/lib/valuation"

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string
  value: string
  note: string
  className?: string
}) {
  return (
    <div className="flex flex-col gap-1 last:col-span-2">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-figure text-2xl leading-none font-semibold sm:text-4xl xl:text-5xl",
          value === DASH ? "text-muted-foreground" : className
        )}
      >
        {/* The unit at half size, so "pp" does not weigh as much as the number. */}
        {value.replace(/ pp$/, "")}
        {value.endsWith(" pp") && <span className="ml-1 text-[0.5em]">pp</span>}
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}

/** The arithmetic sign between two figures; decoration, the labels carry the meaning. */
function Operator({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="hidden self-center pt-1 font-figure text-3xl text-muted-foreground sm:inline"
    >
      {children}
    </span>
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
}: {
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
        Return gap across {values.length} S&amp;P 500 stocks, pp a year
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
                opacity: i === mine ? 1 : 0.35,
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
  "deep-value": "in the cheapest fifth of the S&P 500",
  undervalued: "in the second cheapest fifth of the S&P 500",
  fair: "in the middle fifth of the S&P 500",
  overvalued: "in the second most expensive fifth of the S&P 500",
  expensive: "in the most expensive fifth of the S&P 500",
  unrated: "unranked",
}

/**
 * The stock page's verdict: the two rates and their gap as the anchor, the
 * quintiles in words, where the gap sits in the index, and one sentence.
 */
export function StockVerdict({
  stock,
  stocks,
  valueRank,
  composite,
}: {
  stock: Stock
  /** The whole index, for the distribution strip. */
  stocks: Stock[]
  valueRank: number | null
  /** The value + momentum composite percentile. */
  composite: number | null
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
  const values = stocks.flatMap((s) => {
    const a = impliedAlpha(s)
    return a === null ? [] : [a]
  })
  const compositeBand = signalBand(composite)

  return (
    <header className="flex flex-col gap-4 border-b border-border px-4 py-5 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-heading text-2xl">{stock.name}</h2>
        <span className="font-figure text-sm text-muted-foreground">
          {stock.ticker} · {formatSharePrice(stock.price)}
          {stock.marketCap !== null && ` · ${formatMarketCap(stock.marketCap)}`}
        </span>
        <span className="text-sm text-muted-foreground">{stock.sector}</span>
      </div>

      {/* On a phone the two rates share a row and the gap takes the next. */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:items-start sm:gap-x-5">
          <Figure
            label="Implied return"
            value={formatPct(implied)}
            note={`a year, at ${formatSharePrice(stock.price)}`}
          />
          <Operator>−</Operator>
          <Figure
            label="Required return"
            value={formatPct(rates?.required)}
            note="a year, given its risk"
          />
          <Operator>=</Operator>
          <Figure
            label="Return gap"
            value={formatPp(alpha)}
            note="a year"
            className={gapTextClass(alpha)}
          />
        </div>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {counted.length > 0
            ? `Average of ${counted.length === 1 ? "the one model" : `${counted.length} of 4 models`} that could be calculated (${counted.map((m) => m.label).join(", ")}).${counted.length < 4 ? " The model table says why the others could not." : ""}`
            : solved.length > 0
              ? `${solved.length === 1 ? "One model solves" : `${solved.length} models solve`}, but none has a required return: ${lowerFirst(missingReason(stock, solved[0]) ?? "")}.`
              : "No reverse-DCF model can be solved at this price."}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-sm">
        <span className="flex flex-wrap items-center gap-x-2">
          <span aria-hidden="true" className="size-2.5 shrink-0" style={{ background: BAND_FILL[band] }} />
          <span className="font-medium whitespace-nowrap">{valueQuintileLabel(band)}</span>
          {valueRank !== null && (
            <span className="whitespace-nowrap text-muted-foreground">
              value percentile {formatScore(valueRank)}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0"
            style={{ background: SIGNAL_BAND_FILL[compositeBand] }}
          />
          <span className="font-medium whitespace-nowrap">{compositeQuintileLabel(compositeBand)}</span>
          {composite !== null && (
            <span className="whitespace-nowrap text-muted-foreground">
              value + momentum score {formatComposite(composite)}
            </span>
          )}
        </span>
      </div>

      {alpha !== null && <DistributionStrip values={values} alpha={alpha} ticker={stock.ticker} />}

      <p className="max-w-3xl text-base leading-relaxed">
        {rates === null ? (
          <>
            {stock.ticker} has no value rank:{" "}
            {solved.length === 0
              ? "none of the four reverse-DCF models can be solved at this price."
              : "the models that solve have no required return to compare against."}
          </>
        ) : (
          <>
            Buying {stock.ticker} at {formatSharePrice(stock.price)} implies a return of{" "}
            {formatPct(rates.implied)} a year,{" "}
            {rates.implied >= rates.required ? "more" : "less"} than the{" "}
            {formatPct(rates.required)} its risk calls for. On value that puts it{" "}
            {VALUE_PLACE[band]}.
            {composite !== null && (
              <>
                {" "}With momentum added, it scores {formatComposite(composite)} out of 100.
              </>
            )}
          </>
        )}
      </p>
    </header>
  )
}
