"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ScreenerFilterRail } from "@/components/screener-filters"
import { ScreenerTable, type SortKey } from "@/components/screener-table"
import { ValuationLegend } from "@/components/valuation-scale"
import {
  BAND_FILL,
  BAND_LABELS,
  DEFAULT_FILTERS,
  VALUATION_METHODS,
  applyFilters,
  consensusMarginOfSafety,
  isRated,
  valuationBand,
  type MethodId,
  type ScreenerFilters,
  type Stock,
  type ValuationBand,
} from "@/lib/valuation"

const BANDS: ValuationBand[] = [
  "deep-value",
  "undervalued",
  "fair",
  "overvalued",
  "expensive",
  "unrated",
]

/**
 * Distribution of the current result set across the five bands. It is the
 * screener's "shape of the market" readout — a stacked bar rather than five
 * numbers, so an over-tight filter is visible at a glance.
 */
function BandDistribution({
  counts,
  total,
  isBaseline,
  computedAt,
}: {
  counts: Record<ValuationBand, number>
  total: number
  isBaseline: boolean
  computedAt: string | null
}) {
  return (
    <div className="flex flex-col gap-3 border border-border bg-card px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Distribution
        </span>
        {/* Where the numbers came from. A screen built on illustrative data
            looks identical to a live one, so it has to say which it is. */}
        <span className="text-xs text-muted-foreground">
          {isBaseline
            ? "Illustrative sample — market data service unreachable"
            : computedAt
              ? `Live · valued ${new Date(computedAt).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" }
                )}`
              : "Live"}
        </span>
      </div>

      <div className="flex h-6 w-full gap-0.5" role="img" aria-hidden="true">
        {BANDS.map((band) => {
          const share = total === 0 ? 0 : counts[band] / total
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

      <dl className="flex flex-wrap gap-x-5 gap-y-2">
        {BANDS.map((band) => (
          <div key={band} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0"
              style={{ background: BAND_FILL[band] }}
              aria-hidden="true"
            />
            <dt className="text-xs text-muted-foreground">
              {BAND_LABELS[band]}
            </dt>
            <dd className="font-mono text-xs">{counts[band]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Screener({
  stocks,
  isBaseline = false,
  computedAt = null,
}: {
  stocks: Stock[]
  /** True when the live service was unreachable and the sample is standing in. */
  isBaseline?: boolean
  computedAt?: string | null
}) {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>("margin")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [selected, setSelected] = useState<string[]>([])

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
  // number beside each model answers "what can this model value" rather than
  // drifting as unrelated filters move.
  const methodCoverage = useMemo(() => {
    const base = Object.fromEntries(
      VALUATION_METHODS.map((m) => [m.id, 0])
    ) as Record<MethodId, number>

    for (const stock of stocks) {
      for (const verdict of stock.verdicts) {
        if (verdict.method in base) base[verdict.method] += 1
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
        case "beta":
          return (a.beta - b.beta) * factor
        case "peRatio":
          return (a.peRatio - b.peRatio) * factor
        case "realisedReturn":
          return (a.realisedReturn - b.realisedReturn) * factor
        case "volatility":
          return (a.volatility - b.volatility) * factor
        default: {
          // Unrated stocks have no margin to rank on, so they sink to the
          // bottom rather than sorting as though their consensus were zero.
          const aRated = isRated(a, filters.methods)
          const bRated = isRated(b, filters.methods)
          if (!aRated && !bRated) return 0
          if (!aRated) return 1
          if (!bRated) return -1
          return (
            (consensusMarginOfSafety(a, filters.methods) -
              consensusMarginOfSafety(b, filters.methods)) *
            factor
          )
        }
      }
    })
  }, [filtered, sort, direction, filters.methods])

  const counts = useMemo(() => {
    const base = {
      "deep-value": 0,
      undervalued: 0,
      fair: 0,
      overvalued: 0,
      expensive: 0,
      unrated: 0,
    } as Record<ValuationBand, number>

    for (const stock of filtered) {
      base[
        isRated(stock, filters.methods)
          ? valuationBand(consensusMarginOfSafety(stock, filters.methods))
          : "unrated"
      ] += 1
    }

    return base
  }, [filtered, filters.methods])

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

  return (
    <div className="flex flex-col gap-6 px-6 py-8 lg:px-10">
      <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <ScreenerFilterRail
            filters={filters}
            sectors={sectors}
            matches={filtered.length}
            total={stocks.length}
            methodCoverage={methodCoverage}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <BandDistribution
            counts={counts}
            total={filtered.length}
            isBaseline={isBaseline}
            computedAt={computedAt}
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <ValuationLegend />

            <div className="flex flex-wrap items-center gap-3">
              {/* Hand the whole screened set over, not just ticked rows. This
                  is the point of screening: the frontier is built from what
                  survived the filters rather than from the full index. */}
              {filtered.length > 1 && (
                <Button
                  size="sm"
                  variant={selected.length > 0 ? "outline" : "default"}
                  nativeButton={false}
                  render={
                    <Link
                      href={`/portfolio?tickers=${filtered
                        .map((stock) => stock.ticker)
                        .join(",")}`}
                    />
                  }
                >
                  Optimise all {filtered.length} matches
                  <RiArrowRightLine />
                </Button>
              )}

              {selected.length > 1 && (
                <Button
                  size="sm"
                  nativeButton={false}
                  render={
                    <Link href={`/portfolio?tickers=${selected.join(",")}`} />
                  }
                >
                  Optimise {selected.length} selected
                  <RiArrowRightLine />
                </Button>
              )}
            </div>
          </div>

          <ScreenerTable
            stocks={sorted}
            methods={filters.methods}
            sort={sort}
            direction={direction}
            onSort={handleSort}
            selected={selected}
            onToggleSelected={toggleSelected}
          />
        </div>
      </div>
    </div>
  )
}
