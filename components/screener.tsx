"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  RiArrowRightLine,
  RiDownloadLine,
  RiEqualizerLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ScreenerFilterRail } from "@/components/screener-filters"
import { ScreenerTable, type SortKey } from "@/components/screener-table"
import {
  BAND_FILL,
  BAND_LABELS,
  DEFAULT_FILTERS,
  VALUATION_METHODS,
  applyFilters,
  impliedAlpha,
  isDefaultBandSelection,
  methodAlpha,
  valuationBand,
  type MethodId,
  type ScreenerFilters,
  type Stock,
  type ValuationBand,
} from "@/lib/valuation"
import {
  DEFAULT_SIGNALS,
  SIGNAL_COMPONENTS,
  componentRank,
  signalScore,
  type SignalId,
} from "@/lib/signals"
import { portfolioHref } from "@/lib/ticker-set"
import { useScrollPane } from "@/lib/use-scroll-pane"
import { cn } from "@/lib/utils"

const BANDS: ValuationBand[] = [
  "deep-value",
  "undervalued",
  "fair",
  "overvalued",
  "expensive",
  "unrated",
]

/**
 * The width at which the filter rail and a full-width table both fit.
 *
 * Measured, not guessed: the table's natural width is a little over 1,000px,
 * the rail is 20rem, and the app chrome takes another 336px. Below this the
 * rail was silently clipping four columns off the right of the table, so it
 * starts collapsed instead and the toolbar button opens it.
 */
const RAIL_BREAKPOINT = 1700

/**
 * How many facets are away from their defaults, for the toolbar button.
 *
 * Counted against `DEFAULT_FILTERS` rather than against emptiness, because the
 * screen now opens on three ticked bands: a raw count would report the opening
 * state as two active filters and never fall to zero.
 */
function activeFilterCount(filters: ScreenerFilters): number {
  let count = 0
  if (filters.search.trim()) count += 1
  if (
    filters.signals.length !== DEFAULT_SIGNALS.length ||
    !filters.signals.every((id) => DEFAULT_SIGNALS.includes(id))
  ) {
    count += 1
  }
  if (filters.signalBands.length > 0) count += 1
  count += filters.sectors.length
  if (!isDefaultBandSelection(filters.bands)) count += 1
  if (filters.methods.length > 0) count += 1
  if (filters.maxBeta !== DEFAULT_FILTERS.maxBeta) count += 1
  return count
}

/**
 * The screen, as a file.
 *
 * Analysts export. A screener that can only be read on screen is a demo of a
 * screener, and the whole result set is already in memory — this is a `Blob`
 * and an anchor, not a feature.
 */
function downloadCsv(stocks: Stock[], methods: MethodId[], signals: SignalId[]) {
  const header = [
    "ticker",
    "name",
    "sector",
    "price",
    "market_cap_usd_bn",
    `signal_score_${signals.join("_")}`,
    "value_expected_alpha",
    "momentum_12_1",
    "earnings_surprise",
    "implied_excess_return",
    ...VALUATION_METHODS.map((m) => `implied_excess_${m.id}`),
    "realised_return_1y",
    "volatility_1y",
    "beta",
    "pe_ratio",
  ]

  const rows = stocks.map((stock) => {
    const score = signalScore(stock, signals)
    // Blank, not 0, for anything not measured: a zero is a reading.
    const figure = (value: number | null | undefined) =>
      value === null || value === undefined ? "" : value.toFixed(4)
    return [
      stock.ticker,
      // Company names carry commas. Quote everything free-text and double any
      // quote inside it, which is the whole of RFC 4180 that matters here.
      `"${stock.name.replace(/"/g, '""')}"`,
      `"${stock.sector.replace(/"/g, '""')}"`,
      stock.price.toFixed(2),
      stock.marketCap === null ? "" : stock.marketCap.toFixed(2),
      figure(score),
      figure(stock.signals?.value),
      figure(stock.signals?.momentum),
      figure(stock.signals?.surprise),
      figure(impliedAlpha(stock, methods)),
      ...VALUATION_METHODS.map((m) => figure(methodAlpha(stock, m.id))),
      figure(stock.realisedReturn),
      figure(stock.volatility),
      stock.beta === null ? "" : stock.beta.toFixed(3),
      stock.peRatio !== null && stock.peRatio > 0 ? stock.peRatio.toFixed(2) : "",
    ].join(",")
  })

  const blob = new Blob([[header.join(","), ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `value-investing-dash-screen-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Ascending or descending by `factor`, with unmeasured values last either way. */
function compareNullable(a: number | null, b: number | null, factor: number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * factor
}

/** How many stocks fall in each band, under the current model selection. */
function countBands(
  stocks: Stock[],
  methods: MethodId[]
): Record<ValuationBand, number> {
  const base = {
    "deep-value": 0,
    undervalued: 0,
    fair: 0,
    overvalued: 0,
    expensive: 0,
    unrated: 0,
  } as Record<ValuationBand, number>

  for (const stock of stocks) {
    base[valuationBand(impliedAlpha(stock, methods))] += 1
  }

  return base
}

/**
 * The shape of the index across the five bands.
 *
 * THE BAR IS THE WHOLE UNIVERSE, NOT THE RESULT SET, and that is the fix for a
 * real misreading. It used to be sized by the filtered rows, so a default that
 * keeps the cheap two bands drew a bar with three bands missing — which says
 * "this data does not exist" far more loudly than it says "you filtered it
 * out". The market's shape does not change when a checkbox moves, so the bar
 * does not either.
 *
 * No counts. The legend names the colours and the bar carries the proportions,
 * which is the whole of what a distribution readout owes a reader; the exact
 * figures live in the toolbar's own "N of M stocks" and in the rail's match
 * count, and repeating them here made a strip of numbers out of a picture.
 *
 * One strip rather than the card this used to be. It sits directly above a
 * table whose useful height is whatever the window has left, so every pixel it
 * takes is a row that cannot be read without scrolling.
 */
function BandDistribution({
  universeCounts,
}: {
  /** Every stock in the universe, by band. Sizes the bar. */
  universeCounts: Record<ValuationBand, number>
}) {
  const universeTotal = BANDS.reduce(
    (sum, band) => sum + universeCounts[band],
    0
  )

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-border bg-card px-4 py-2">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Distribution
      </span>

      <div
        className="flex h-2.5 min-w-48 flex-1 gap-px"
        role="img"
        aria-label={`Valuation bands across all ${universeTotal} stocks in the index`}
      >
        {BANDS.map((band) => {
          const share =
            universeTotal === 0 ? 0 : universeCounts[band] / universeTotal
          if (share === 0) return null

          return (
            <span
              key={band}
              className="h-full"
              style={{
                width: `${(share * 100).toFixed(2)}%`,
                background: BAND_FILL[band],
              }}
            />
          )
        })}
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {BANDS.map((band) => (
          <li key={band} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0"
              style={{ background: BAND_FILL[band] }}
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              {BAND_LABELS[band]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Screener({ stocks }: { stocks: Stock[] }) {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS)
  // The signal is the default ordering: the backtest ranks the blend above
  // value alone (backtests.md §13, §16).
  const [sort, setSort] = useState<SortKey>("signal")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [selected, setSelected] = useState<string[]>([])

  /**
   * Null while the rail's visibility is still whatever CSS chose for this
   * viewport, which is what keeps the first paint free of a layout flash on a
   * wide screen. The first toggle reads the width once and takes over.
   */
  const [railOpen, setRailOpen] = useState<boolean | null>(null)

  // The rail is a pane in its own right: taller than the window on a laptop,
  // and the page behind it no longer scrolls now that the table owns the
  // vertical space. Without this the sector facets are simply unreachable.
  const { ref: railRef, maxHeight: railMaxHeight } =
    useScrollPane<HTMLDivElement>()

  const sectors = useMemo(
    () =>
      [...new Set(stocks.map((stock) => stock.sector))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [stocks]
  )

  const filtered = useMemo(
    () => applyFilters(stocks, filters),
    [stocks, filters]
  )

  // Coverage is counted over the whole universe, not the filtered set, so the
  // number beside each model answers "what can this model solve for" rather
  // than drifting as unrelated filters move.
  const methodCoverage = useMemo(() => {
    const base = Object.fromEntries(
      VALUATION_METHODS.map((m) => [m.id, 0])
    ) as Record<MethodId, number>

    for (const stock of stocks) {
      for (const method of VALUATION_METHODS) {
        if (methodAlpha(stock, method.id) !== null) base[method.id] += 1
      }
    }

    return base
  }, [stocks])

  // Same basis as the model coverage above: the whole universe.
  const signalCoverage = useMemo(() => {
    const base = Object.fromEntries(
      SIGNAL_COMPONENTS.map((c) => [c.id, 0])
    ) as Record<SignalId, number>

    for (const stock of stocks) {
      for (const component of SIGNAL_COMPONENTS) {
        if (componentRank(stock, component.id) !== null) base[component.id] += 1
      }
    }

    return base
  }, [stocks])

  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "ticker":
          return a.ticker.localeCompare(b.ticker) * factor
        case "price":
          return (a.price - b.price) * factor
        case "marketCap":
          return compareNullable(a.marketCap, b.marketCap, factor)
        case "beta":
          return compareNullable(a.beta, b.beta, factor)
        case "peRatio":
          return compareNullable(a.peRatio, b.peRatio, factor)
        case "realisedReturn":
          return compareNullable(a.realisedReturn, b.realisedReturn, factor)
        case "volatility":
          return compareNullable(a.volatility, b.volatility, factor)
        case "signal": {
          // Unscored stocks sink in either direction, like unrated ones below.
          const aScore = signalScore(a, filters.signals)
          const bScore = signalScore(b, filters.signals)
          if (aScore === null && bScore === null) return 0
          if (aScore === null) return 1
          if (bScore === null) return -1
          return (aScore - bScore) * factor
        }
        default: {
          // Unrated stocks have no reading to rank on, so they sink to the
          // bottom rather than sorting as though it were zero.
          const aAlpha = impliedAlpha(a, filters.methods)
          const bAlpha = impliedAlpha(b, filters.methods)
          if (aAlpha === null && bAlpha === null) return 0
          if (aAlpha === null) return 1
          if (bAlpha === null) return -1
          return (aAlpha - bAlpha) * factor
        }
      }
    })
  }, [filtered, sort, direction, filters.methods, filters.signals])

  // Over the whole universe, not the filtered rows: this sizes the bar, and
  // the bar describes the index. Still keyed on the model selection, since
  // narrowing the models re-answers every stock's band.
  const universeCounts = useMemo(
    () => countBands(stocks, filters.methods),
    [stocks, filters.methods]
  )

  function handleSort(key: SortKey) {
    if (key === sort) {
      setDirection(direction === "asc" ? "desc" : "asc")
      return
    }
    setSort(key)
    setDirection(key === "ticker" ? "asc" : "desc")
  }

  function toggleSelected(ticker: string) {
    setSelected((current) =>
      current.includes(ticker)
        ? current.filter((item) => item !== ticker)
        : [...current, ticker]
    )
  }

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((stock) => selected.includes(stock.ticker))

  // Acts on the rows currently on screen only. Anything ticked under an
  // earlier filter survives a clear here rather than vanishing silently.
  function toggleAllVisible() {
    const visible = sorted.map((stock) => stock.ticker)
    setSelected((current) => {
      const allOn =
        visible.length > 0 && visible.every((t) => current.includes(t))
      return allOn
        ? current.filter((t) => !visible.includes(t))
        : [...new Set([...current, ...visible])]
    })
  }

  const activeFilters = activeFilterCount(filters)

  return (
    <div className="flex flex-col gap-4 px-6 py-5 lg:px-10">
      <div
        className={cn(
          "grid gap-6",
          railOpen === null
            ? "min-[1700px]:grid-cols-[20rem_minmax(0,1fr)]"
            : railOpen
              ? "lg:grid-cols-[20rem_minmax(0,1fr)]"
              : undefined
        )}
      >
        <div
          id="screener-filters"
          ref={railRef}
          style={railMaxHeight ? { maxHeight: railMaxHeight } : undefined}
          className={cn(
            "flex-col gap-6 overflow-y-auto lg:max-h-[calc(100vh-14rem)]",
            railOpen === null
              ? "hidden min-[1700px]:flex"
              : railOpen
                ? "flex"
                : "hidden"
          )}
        >
          <ScreenerFilterRail
            filters={filters}
            sectors={sectors}
            matches={filtered.length}
            total={stocks.length}
            methodCoverage={methodCoverage}
            signalCoverage={signalCoverage}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <BandDistribution universeCounts={universeCounts} />

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                aria-controls="screener-filters"
                aria-expanded={railOpen ?? undefined}
                onClick={() =>
                  setRailOpen((current) =>
                    // The first press flips whatever the viewport chose; every
                    // press after that flips the state this component owns.
                    current === null
                      ? !(window.innerWidth >= RAIL_BREAKPOINT)
                      : !current
                  )
                }
              >
                <RiEqualizerLine />
                Filters
                {activeFilters > 0 && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">
                    {activeFilters}
                  </span>
                )}
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(sorted, filters.methods, filters.signals)
                }
              >
                <RiDownloadLine />
                Export {sorted.length} rows
              </Button>

              <span className="font-mono text-xs text-muted-foreground">
                {filtered.length} of {stocks.length} stocks
                {selected.length > 0 && ` · ${selected.length} selected`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Hand the whole screened set over, not just ticked rows. This
                  is the point of screening: the frontier is built from what
                  survived the filters rather than from the full index. Hidden
                  once the selection already covers every match, where it would
                  be the button beside it under a different name. */}
              {filtered.length > 1 && !allVisibleSelected && (
                <Button className={"bg-transparent text-primary hover:bg-primary/20 border-border"}
                  size="sm"
                  variant={selected.length > 0 ? "outline" : "default"}
                  nativeButton={false}
                  render={
                    <Link
                      href={portfolioHref(
                        filtered.map((stock) => stock.ticker)
                      )}
                    />
                  }
                >
                  Optimise all {filtered.length} into a portfolio
                  <RiArrowRightLine />
                </Button>
              )}

              {selected.length > 1 && (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link href={portfolioHref(selected)} />}
                >
                  Optimise {selected.length} selected into a portfolio
                  <RiArrowRightLine />
                </Button>
              )}
            </div>
          </div>

          <ScreenerTable
            stocks={sorted}
            methods={filters.methods}
            signals={filters.signals}
            sort={sort}
            direction={direction}
            onSort={handleSort}
            selected={selected}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
          />
        </div>
      </div>
    </div>
  )
}
