import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
} from "@/components/ui/panel"
import { formatSignedPercent } from "@/lib/format"
import {
  BAND_FILL,
  VALUATION_METHODS,
  consensusFairValue,
  consensusMarginOfSafety,
  disagreementBand,
  type Stock,
} from "@/lib/valuation"

/**
 * Where the models actually land, on one shared price axis.
 *
 * This is the project's most interesting finding and it had no UI at all: the
 * models disagree on *direction* — not on magnitude, on whether a company is
 * cheap or expensive — for a majority of the index. The valuation table states
 * every number involved and still cannot show that, because a column of dollar
 * figures is read one cell at a time and disagreement is a property of the set.
 *
 * One row per model, all sharing an axis, with the market price as a line
 * running down through every row. A bar reaching right of that line is a model
 * saying cheap. Whether the bars fall on one side or straddle it is the whole
 * reading — which is why there is no sentence here announcing the split. The
 * picture is the sentence.
 *
 * A lollipop rather than a scatter because the distance from the price is the
 * quantity of interest, and a bar that starts at the line draws exactly that.
 * Dots are coloured by their own band, on the same diverging scale the screener
 * paints, so a row means the same thing here as there.
 *
 * The consensus is the last bar, drawn by the same function as the rest. That
 * is deliberate: it is one more reading on the same axis, and giving it its own
 * treatment would make it look like a different kind of quantity.
 */

/** Axis padding, as a share of the span. Keeps end dots off the edges. */
const AXIS_PAD = 0.08

function formatPrice(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  })
}

/**
 * One reading on the axis.
 *
 * Every row on this panel goes through here — the five models and the
 * consensus — so a bar cannot come to mean two things. Module scope rather
 * than a closure over the axis, which is why the scale arrives as props.
 */
function Row({
  label,
  fairValue,
  margin,
  price,
  pricePercent,
  position,
  strong = false,
}: {
  label: string
  fairValue: number
  margin: number
  price: number
  pricePercent: number
  position: (value: number) => number
  /** The consensus, which is the answer the other rows add up to. */
  strong?: boolean
}) {
  const valuePercent = position(fairValue)
  const fill = BAND_FILL[disagreementBand(margin)]
  const tone = fairValue > price ? "text-undervalued" : "text-overvalued"
  const weight = strong ? "font-semibold" : ""

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)_4.5rem_4rem] items-center gap-2 sm:grid-cols-[4rem_minmax(0,1fr)_5rem_4.5rem] sm:gap-3">
      <span className={`text-sm ${strong ? "font-bold" : "font-medium"}`}>
        {label}
      </span>

      <div className="relative h-5" aria-hidden="true">
        <span
          className="absolute inset-y-0 w-px bg-muted-foreground/50"
          style={{ left: `${pricePercent}%` }}
        />
        {/* The gap, as a bar from the price to the value. */}
        <span
          className={strong ? "absolute inset-y-0.5" : "absolute inset-y-1.5"}
          style={{
            background: fill,
            left: `${Math.min(pricePercent, valuePercent)}%`,
            width: `${Math.abs(valuePercent - pricePercent)}%`,
          }}
        />
      </div>

      <span className={`text-right font-mono text-sm tabular-figures ${tone} ${weight}`}>
        {formatPrice(fairValue)}
      </span>
      <span className={`text-right font-mono text-sm tabular-figures ${tone} ${weight}`}>
        {formatSignedPercent(margin)}
      </span>
    </div>
  )
}

export function ModelDisagreement({ stock }: { stock: Stock }) {
  const scored = new Map(stock.verdicts.map((verdict) => [verdict.method, verdict]))
  const applied = VALUATION_METHODS.filter((method) => scored.has(method.id))

  if (applied.length === 0) {
    return (
      <Panel>
        <PanelHeader>
          <PanelTitle>Model disagreement</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <p className="text-sm text-muted-foreground">
            No model produced a fair value for {stock.ticker}, so there is
            nothing to disagree about.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  const consensusMargin = consensusMarginOfSafety(stock)
  const consensusValue = consensusFairValue(stock)

  const values = applied.map((method) => scored.get(method.id)!.fairValue)
  const low = Math.min(stock.price, consensusValue, ...values)
  const high = Math.max(stock.price, consensusValue, ...values)
  // A single point, or every value identical, would divide by zero below.
  const span = high - low || Math.max(high, 1)

  const min = low - span * AXIS_PAD
  const max = high + span * AXIS_PAD
  const position = (value: number) => ((value - min) / (max - min)) * 100

  const pricePercent = position(stock.price)

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Model disagreement</PanelTitle>
        <PanelMeta>
          Δ current price
        </PanelMeta>
      </PanelHeader>

      <PanelBody className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          {applied.map((method) => {
            const verdict = scored.get(method.id)!
            return (
              <Row
                key={method.id}
                label={method.label}
                fairValue={verdict.fairValue}
                margin={verdict.marginOfSafety}
                price={stock.price}
                pricePercent={pricePercent}
                position={position}
              />
            )
          })}
          
          <div>
            <Row
              label="CONSENSUS"
              fairValue={consensusValue}
              margin={consensusMargin}
              price={stock.price}
              pricePercent={pricePercent}
              position={position}
              strong
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-center">
            Current Price:
            <span className="font-mono text-foreground tabular-figures">
              {formatPrice(stock.price)}
            </span>
          </span>
        </div>
      </PanelBody>
    </Panel>
  )
}
