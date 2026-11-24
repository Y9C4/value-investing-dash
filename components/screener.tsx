"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
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
import { SIGNAL_COMPONENTS, type SignalId } from "@/lib/signals"
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  componentRank,
  rankUniverse,
  type Ranking,
  type ScreenerFilters,
} from "@/lib/screen"
import { portfolioHref } from "@/lib/ticker-set"
import { useScrollPane } from "@/lib/use-scroll-pane"
import { cn } from "@/lib/utils"

/**
 * The width at which the filter rail and a full-width table both fit.
 *
 * Measured, not guessed: the table's natural width is a little over 1,000px,
 * the rail is 20rem, and the app chrome takes another 336px. Below this the
 * rail starts collapsed and the toolbar button opens it.
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
    `score_${signals.join("_")}`,
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
  URL.revokeObjectURL(url)
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
      text: "The return today's price implies, against the return the stock's risk requires (reverse DCF). Ranked 0–100 across the index: 100 is the cheapest.",
    },
    {
      term: "Trend",
      text: "The last twelve months' price move, skipping the latest month: has the market started to agree?",
    },
    {
      term: "Score",
      text: "The average of the selected ranks, re-ranked 0–100. Value + trend ranked best in the backtest, though not yet significantly.",
    },
  ]

  return (
    <section
      aria-label="How to read the screener"
      className="relative grid gap-x-6 gap-y-2 border border-border bg-card px-4 py-3 pr-10 md:grid-cols-3"
    >
      {items.map((item) => (
        <p key={item.term} className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{item.term}. </span>
          {item.text}
        </p>
      ))}
      <Link
        href="/methodology"
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground md:col-span-3"
      >
        How the models work, and what the backtest found
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide this guide"
        className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground"
      >
        <RiCloseLine className="size-4" />
      </button>
    </section>
  )
}

export function Screener({
  stocks,
  initialSectors = [],
}: {
  stocks: Stock[]
  /** Opens the screen filtered to these sectors (from the overview's links). */
  initialSectors?: string[]
}) {
  const [filters, setFilters] = useState<ScreenerFilters>({
    ...DEFAULT_FILTERS,
    sectors: initialSectors,
  })
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

  const { ref: railRef, maxHeight: railMaxHeight } = useScrollPane<HTMLDivElement>()

  const sectors = useMemo(
    () => [...new Set(stocks.map((stock) => stock.sector))].sort((a, b) => a.localeCompare(b)),
    [stocks]
  )

  const ranking = useMemo(
    () => rankUniverse(stocks, filters.methods, filters.signals),
    [stocks, filters.methods, filters.signals]
  )

  const filtered = useMemo(
    () => applyFilters(stocks, filters, ranking),
    [stocks, filters, ranking]
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

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 lg:px-10">
      <ScreenerGuide />

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
            railOpen === null ? "hidden min-[1700px]:flex" : railOpen ? "flex" : "hidden"
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
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                aria-controls="screener-filters"
                aria-expanded={railOpen ?? undefined}
                onClick={() =>
                  setRailOpen((current) =>
                    // The first press flips whatever the viewport chose.
                    current === null ? !(window.innerWidth >= RAIL_BREAKPOINT) : !current
                  )
                }
              >
                <RiEqualizerLine />
                Filters
                {activeFilters > 0 && (
                  <span className="ml-1 font-mono text-xs text-muted-foreground">{activeFilters}</span>
                )}
              </Button>

              {/* Column groups beyond the defaults: what a reader adds, not hunts for. */}
              <div role="group" aria-label="Show columns" className="flex flex-wrap items-center gap-1">
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
                        "border px-2.5 py-1.5 text-xs transition-colors",
                        on
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {on ? "− " : "+ "}
                      {group.label}
                    </button>
                  )
                })}
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => downloadCsv(sorted, ranking, filters.methods, filters.signals)}
              >
                <RiDownloadLine />
                Export {sorted.length}
              </Button>

              <span className="font-mono text-xs text-muted-foreground">
                {filtered.length} of {stocks.length} stocks
                {selected.length > 0 && ` · ${selected.length} selected`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Hand the whole screened set over, not just ticked rows: the
                  frontier is built from what survived the filters. */}
              {filtered.length > 1 && !allVisibleSelected && (
                <Button
                  size="sm"
                  variant={selected.length > 1 ? "outline" : "default"}
                  nativeButton={false}
                  render={<Link href={portfolioHref(filtered.map((stock) => stock.ticker))} />}
                >
                  Optimise all {filtered.length}
                  <RiArrowRightLine />
                </Button>
              )}

              {selected.length > 1 && (
                <Button size="sm" nativeButton={false} render={<Link href={portfolioHref(selected)} />}>
                  Optimise {selected.length} selected
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
            selected={selected}
            onToggleSelected={toggleSelected}
            onToggleAll={toggleAllVisible}
            onReset={reset}
          />
        </div>
      </div>
    </div>
  )
}
