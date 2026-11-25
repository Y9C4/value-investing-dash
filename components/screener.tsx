"use client"

import { Suspense, useDeferredValue, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  RiArrowRightLine,
  RiCloseLine,
  RiDownloadLine,
  RiEqualizerLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ScreenerFilterRail } from "@/components/screener-filters"
import {
  COLUMN_GROUPS,
  ScreenerTable,
  type ColumnGroup,
  type SortKey,
} from "@/components/screener-table"
import {
  VALUATION_METHODS,
  impliedAlpha,
  methodAlpha,
  type MethodId,
  type Stock,
} from "@/lib/valuation"
import { evidenceFor, holdoutClause } from "@/lib/evidence"
import { DEFAULT_SIGNALS, SIGNAL_COMPONENTS, type SignalId } from "@/lib/signals"
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  componentRank,
  rankUniverse,
  type Ranking,
  type ScreenerFilters,
} from "@/lib/screen"
import { MIN_FRONTIER_TICKERS } from "@/lib/portfolio-settings"
import { portfolioHref } from "@/lib/ticker-set"
import { useMinWidth } from "@/lib/use-min-width"
import { useScrollPane } from "@/lib/use-scroll-pane"
import { cn } from "@/lib/utils"

/**
 * The width at which the filter rail and a full-width table both fit.
 *
 * Measured, not guessed: the table's natural width is a little over 1,000px,
 * the rail is 20rem, and the app chrome takes another 336px. From here up the
 * rail is open by default; below it starts closed, and opening it docks it
 * beside the table (which then scrolls sideways, ticker column frozen) or,
 * under `lg`, stacks it above.
 */
const RAIL_BREAKPOINT = 1700

/** Ascending or descending by `factor`, with unmeasured values last either way. */
function compareNullable(a: number | null, b: number | null, factor: number): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * factor
}

/** The figure a sort key orders by. */
function sortValue(stock: Stock, key: SortKey, ranking: Ranking): number | null {
  switch (key) {
    case "score":
      return ranking.score.get(stock.ticker) ?? null
    case "value":
      return ranking.value.get(stock.ticker) ?? null
    case "momentum":
      return stock.signals?.momentum ?? null
    case "surprise":
      return stock.signals?.surprise ?? null
    case "price":
      return stock.price
    case "ticker":
      return null
    default:
      return stock[key]
  }
}

/** Cheap-first for multiples and risk, high-first for everything else. */
const ASCENDING_FIRST: SortKey[] = ["ticker", "peRatio", "pbRatio", "evEbitda", "volatility", "beta"]

/**
 * The screen, as a file. The whole result set is already in memory, so this is
 * a `Blob` and an anchor.
 */
function downloadCsv(
  stocks: Stock[],
  ranking: Ranking,
  methods: MethodId[],
  signals: SignalId[]
) {
  const header = [
    "ticker",
    "name",
    "sector",
    "price",
    "market_cap_usd_bn",
    `composite_${signals.join("_")}`,
    "value_percentile",
    "implied_excess_return",
    ...VALUATION_METHODS.map((m) => `implied_excess_${m.id}`),
    "momentum_12_1",
    "earnings_surprise",
    "pe_ratio",
    "pb_ratio",
    "ev_ebitda",
    "fcf_yield",
    "shareholder_yield",
    "roe",
    "revenue_growth",
    "realised_return_1y",
    "volatility_1y",
    "beta",
  ]

  // Blank, not 0, for anything not measured: a zero is a reading.
  const figure = (value: number | null | undefined, digits = 4) =>
    value === null || value === undefined ? "" : value.toFixed(digits)
  const quote = (text: string) => `"${text.replace(/"/g, '""')}"`

  const rows = stocks.map((stock) =>
    [
      stock.ticker,
      quote(stock.name),
      quote(stock.sector),
      stock.price.toFixed(2),
      figure(stock.marketCap, 2),
      figure(ranking.score.get(stock.ticker)),
      figure(ranking.value.get(stock.ticker)),
      figure(impliedAlpha(stock, methods)),
      ...VALUATION_METHODS.map((m) => figure(methodAlpha(stock, m.id))),
      figure(stock.signals?.momentum),
      figure(stock.signals?.surprise),
      stock.peRatio !== null && stock.peRatio > 0 ? stock.peRatio.toFixed(2) : "",
      figure(stock.pbRatio, 2),
      figure(stock.evEbitda, 2),
      figure(stock.fcfYield),
      figure(stock.shareholderYield),
      figure(stock.roe),
      figure(stock.revenueGrowth),
      figure(stock.realisedReturn),
      figure(stock.volatility),
      figure(stock.beta, 3),
    ].join(",")
  )

  const blob = new Blob([[header.join(","), ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `value-investing-dash-screen-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  // Revoked after the click has been handled: Safari cancels a download whose URL dies first.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const GUIDE_KEY = "vid:screener-guide-dismissed"

// Browser storage can be empty or throw (private windows, blocked site data);
// the guide then simply shows.
function readGuideDismissed(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1"
  } catch {
    return false
  }
}

const guideListeners = new Set<() => void>()
let guideDismissedThisPage = false

/**
 * Three definitions above the table, the thirty-second version of the
 * methodology page. Dismissible, and remembered per browser.
 */
function ScreenerGuide() {
  const dismissed = useSyncExternalStore(
    (listener) => {
      guideListeners.add(listener)
      return () => guideListeners.delete(listener)
    },
    () => guideDismissedThisPage || readGuideDismissed(),
    // On the server, render the guide; a dismissed browser hides it on hydration.
    () => false
  )

  if (dismissed) return null

  function dismiss() {
    guideDismissedThisPage = true
    try {
      window.localStorage.setItem(GUIDE_KEY, "1")
    } catch {
      // Not remembered across visits; still hidden for this one.
    }
    guideListeners.forEach((listener) => listener())
  }

  const items = [
    {
      term: "Value",
      text: "Is the price low for the risk? We compare the return today's price implies (reverse DCF) with the return the stock's risk requires. 100 is the cheapest stock in the index.",
    },
    {
      term: "Momentum",
      text: "Has the price been rising? The return over the past year, leaving out the latest month. 100 rose the most.",
    },
    {
      term: "Score",
      text: `The average of the two, re-ranked 0-100. We use this mix by default because it did best in the design period, ${holdoutClause(evidenceFor(DEFAULT_SIGNALS)!)}.`,
    },
  ]

  return (
    <section
      aria-label="How to read the screener"
      className="relative grid gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 pr-10 md:grid-cols-3"
    >
      <dl className="grid gap-x-6 gap-y-2 md:col-span-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="text-sm font-semibold">{item.term}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{item.text}</dd>
          </div>
        ))}
      </dl>
      <Link
        href="/methodology"
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground md:col-span-3"
      >
        How each measure is calculated and tested
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide this guide"
        className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        <RiCloseLine className="size-4" />
      </button>
    </section>
  )
}

/**
 * `?sector=` (repeatable) opens the screen filtered: how the overview's sector
 * rows link here. Read on the client, inside Suspense, so the page itself can
 * be prerendered rather than rendered per request.
 */
function SectorsFromUrl({ known, onSectors }: { known: Set<string>; onSectors: (sectors: string[]) => void }) {
  const params = useSearchParams()
  const key = params.getAll("sector").join("|")
  useEffect(() => {
    const sectors = key ? key.split("|").filter((name) => known.has(name)) : []
    if (sectors.length > 0) onSectors(sectors)
    // Keyed on the query string alone: `known` and `onSectors` are stable for the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

export function Screener({ stocks }: { stocks: Stock[] }) {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS)
  // Typing in the search box stays responsive; the 500-row filter catches up.
  const deferredFilters = useDeferredValue(filters)
  const [sort, setSort] = useState<SortKey>("score")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [selected, setSelected] = useState<string[]>([])
  const [groups, setGroups] = useState<ColumnGroup[]>([])

  /**
   * Null while the rail's visibility is still whatever CSS chose for this
   * viewport, which keeps the first paint free of a layout flash. The first
   * toggle reads the width once and takes over.
   */
  const [railOpen, setRailOpen] = useState<boolean | null>(null)
  const railWide = useMinWidth(RAIL_BREAKPOINT)

  function toggleRail() {
    // The first press flips whatever the viewport chose.
    setRailOpen((current) => (current === null ? window.innerWidth < RAIL_BREAKPOINT : !current))
  }

  const { ref: railRef, maxHeight: railMaxHeight } = useScrollPane<HTMLDivElement>()

  const sectors = useMemo(
    () => [...new Set(stocks.map((stock) => stock.sector))].sort((a, b) => a.localeCompare(b)),
    [stocks]
  )

  const ranking = useMemo(
    () => rankUniverse(stocks, deferredFilters.methods, deferredFilters.signals),
    [stocks, deferredFilters.methods, deferredFilters.signals]
  )

  const knownSectors = useMemo(() => new Set(stocks.map((stock) => stock.sector)), [stocks])

  // The sector filter lives in the URL too, so a reload or a shared link keeps it.
  useEffect(() => {
    const query = filters.sectors.map((name) => `sector=${encodeURIComponent(name)}`).join("&")
    if (window.location.search.replace(/^\?/, "") === query) return
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname)
  }, [filters.sectors])

  const filtered = useMemo(
    () => applyFilters(stocks, deferredFilters, ranking),
    [stocks, deferredFilters, ranking]
  )

  // Coverage is counted over the whole universe, so the number beside each
  // model answers "what can this model solve for".
  const methodCoverage = useMemo(() => {
    const base = Object.fromEntries(VALUATION_METHODS.map((m) => [m.id, 0])) as Record<MethodId, number>
    for (const stock of stocks) {
      for (const method of VALUATION_METHODS) {
        if (methodAlpha(stock, method.id) !== null) base[method.id] += 1
      }
    }
    return base
  }, [stocks])

  const signalCoverage = useMemo(() => {
    const base = Object.fromEntries(SIGNAL_COMPONENTS.map((c) => [c.id, 0])) as Record<SignalId, number>
    for (const stock of stocks) {
      for (const component of SIGNAL_COMPONENTS) {
        if (componentRank(stock, component.id, ranking) !== null) base[component.id] += 1
      }
    }
    return base
  }, [stocks, ranking])

  const sorted = useMemo(() => {
    const factor = direction === "asc" ? 1 : -1
    return [...filtered].sort((a, b) =>
      sort === "ticker"
        ? a.ticker.localeCompare(b.ticker) * factor
        : compareNullable(
            sortValue(a, sort, ranking),
            sortValue(b, sort, ranking),
            factor
          )
    )
  }, [filtered, sort, direction, ranking])

  function handleSort(key: SortKey) {
    if (key === sort) {
      setDirection(direction === "asc" ? "desc" : "asc")
      return
    }
    setSort(key)
    setDirection(ASCENDING_FIRST.includes(key) ? "asc" : "desc")
  }

  const selectedSet = useMemo(() => new Set(selected), [selected])

  function toggleSelected(ticker: string) {
    setSelected((current) =>
      current.includes(ticker) ? current.filter((item) => item !== ticker) : [...current, ticker]
    )
  }

  const allVisibleSelected =
    sorted.length > 0 && sorted.every((stock) => selected.includes(stock.ticker))

  // Acts on the rows currently on screen only. Anything ticked under an
  // earlier filter survives a clear here rather than vanishing silently.
  function toggleAllVisible() {
    const visible = sorted.map((stock) => stock.ticker)
    setSelected((current) => {
      const allOn = visible.length > 0 && visible.every((t) => current.includes(t))
      return allOn
        ? current.filter((t) => !visible.includes(t))
        : [...new Set([...current, ...visible])]
    })
  }

  function reset() {
    setFilters(DEFAULT_FILTERS)
    setSort("score")
    setDirection("desc")
  }

  const activeFilters = activeFilterCount(filters)

  // The optimiser solves over MIN_FRONTIER_TICKERS or more, so a smaller set is
  // never offered: below it the slot says what is missing instead.
  const canOptimiseAll = filtered.length >= MIN_FRONTIER_TICKERS && !allVisibleSelected
  const canOptimiseTicked = selected.length >= MIN_FRONTIER_TICKERS
  const optimiseHint =
    selected.length > 0 && !canOptimiseTicked
      ? `Tick at least ${MIN_FRONTIER_TICKERS} to optimise them`
      : !canOptimiseAll && !canOptimiseTicked && filtered.length > 0
        ? `The optimiser needs at least ${MIN_FRONTIER_TICKERS} stocks`
        : null

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 lg:px-10">
      <Suspense fallback={null}>
        <SectorsFromUrl known={knownSectors} onSectors={(sectors) => setFilters((f) => ({ ...f, sectors }))} />
      </Suspense>
      <ScreenerGuide />

      <div
        className={cn(
          "grid gap-6",
          railOpen === null && "min-[1700px]:grid-cols-[20rem_minmax(0,1fr)]",
          railOpen === true && "lg:grid-cols-[20rem_minmax(0,1fr)]"
        )}
      >
        <div
          id="screener-filters"
          ref={railRef}
          style={railMaxHeight ? { maxHeight: railMaxHeight } : undefined}
          className={cn(
            "flex-col gap-6 overflow-y-auto lg:max-h-[calc(100vh-14rem)]",
            railOpen === null && "hidden min-[1700px]:flex",
            railOpen === false && "hidden",
            railOpen === true && "flex"
          )}
        >
          <ScreenerFilterRail
            filters={filters}
            sectors={sectors}
            matches={filtered.length}
            total={stocks.length}
            methodCoverage={methodCoverage}
            signalCoverage={signalCoverage}
            onChange={(next) => {
              setFilters(next)
              // A preset changes what the score means, so lead with the score.
              if (next.preset !== filters.preset && next.preset !== null) {
                setSort("score")
                setDirection("desc")
              }
            }}
            onReset={reset}
            onClose={() => setRailOpen(false)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="px-3"
              aria-controls="screener-filters"
              aria-expanded={railOpen ?? railWide}
              onClick={toggleRail}
            >
              <RiEqualizerLine />
              Filters
              {activeFilters > 0 && (
                <span className="ml-1 font-figure text-xs text-muted-foreground">{activeFilters}</span>
              )}
            </Button>

            {/* Beside Filters, so on a phone the two share the first row. */}
            <Button
              size="sm"
              variant="ghost"
              className="px-3"
              onClick={() => downloadCsv(sorted, ranking, filters.methods, filters.signals)}
            >
              <RiDownloadLine />
              CSV
            </Button>

            {/* Column groups beyond the defaults: what a reader adds, not hunts for. */}
            <div role="group" aria-label="Extra columns" className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-xs text-muted-foreground">Columns</span>
              {COLUMN_GROUPS.map((group) => {
                const on = groups.includes(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setGroups((current) =>
                        on ? current.filter((g) => g !== group.id) : [...current, group.id]
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-xs whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                      on
                        ? "border-foreground/60 bg-foreground/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                    )}
                  >
                    {on ? "− " : "+ "}
                    {group.label}
                    <span className="sr-only"> (columns: {group.columns})</span>
                  </button>
                )
              })}
            </div>

            {/* A fixed width from sm, sized to its widest state, so ticking a
                row never re-wraps the toolbar and shifts the table. */}
            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:ml-auto sm:w-96 sm:flex-nowrap sm:justify-end">
              <span className="flex flex-col font-figure text-xs leading-4 whitespace-nowrap text-muted-foreground sm:text-right">
                <span>
                  {filtered.length} of {stocks.length}
                </span>
                {selected.length > 0 && <span>{selected.length} ticked</span>}
              </span>

              {optimiseHint && (
                <span className="text-xs leading-4 text-muted-foreground sm:max-w-[8rem]">{optimiseHint}</span>
              )}

              {/* Hand the whole screened set over, not just ticked rows: the
                  frontier is built from what survived the filters. */}
              {canOptimiseAll && (
                <Button
                  size="sm"
                  variant={canOptimiseTicked ? "outline" : "default"}
                  className="px-3"
                  nativeButton={false}
                  render={<Link href={portfolioHref(filtered.map((stock) => stock.ticker), stocks.map((stock) => stock.ticker))} />}
                >
                  Optimise these {filtered.length}
                  {!canOptimiseTicked && <RiArrowRightLine />}
                </Button>
              )}

              {canOptimiseTicked && (
                <Button size="sm" className="px-3" nativeButton={false} render={<Link href={portfolioHref(selected, stocks.map((stock) => stock.ticker))} />}>
                  Optimise {selected.length} ticked
                  <RiArrowRightLine />
                </Button>
              )}
            </div>
          </div>

          <ScreenerTable
            stocks={sorted}
            ranking={ranking}
            methods={filters.methods}
            groups={groups}
            sort={sort}
            direction={direction}
            onSort={handleSort}
            selected={selectedSet}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
            onReset={reset}
          />
        </div>
      </div>
    </div>
  )
}
