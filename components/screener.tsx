"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { RiArrowRightLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ScreenerFilterRail } from "@/components/screener-filters"
import { ScreenerTable, type SortKey } from "@/components/screener-table"
import { ValuationLegend } from "@/components/valuation-scale"
import { SAMPLE_UNIVERSE } from "@/lib/sample-universe"
import {
  BAND_FILL,
  BAND_LABELS,
  DEFAULT_FILTERS,
  applyFilters,
  consensusMarginOfSafety,
  valuationBand,
  type ScreenerFilters,
  type ValuationBand,
} from "@/lib/valuation"

const BANDS: ValuationBand[] = [
  "deep-value",
  "undervalued",
  "fair",
  "overvalued",
  "expensive",
]

/**
 * Distribution of the current result set across the five bands. It is the
 * screener's "shape of the market" readout — a stacked bar rather than five
 * numbers, so an over-tight filter is visible at a glance.
 */
function BandDistribution({
  counts,
  total,
}: {
  counts: Record<ValuationBand, number>
  total: number
}) {
  return (
    <div className="flex flex-col gap-3 border border-border bg-card px-6 py-5">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Distribution
      </span>

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

export function Screener() {
  const [filters, setFilters] = useState<ScreenerFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<SortKey>("margin")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
  const [selected, setSelected] = useState<string[]>([])

  const sectors = useMemo(
    () =>
      [...new Set(SAMPLE_UNIVERSE.map((stock) => stock.sector))].sort((a, b) =>
        a.localeCompare(b)
      ),
    []
  )

  const filtered = useMemo(
    () => applyFilters(SAMPLE_UNIVERSE, filters),
    [filters]
  )

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
        case "coverage":
          return (a.verdicts.length - b.verdicts.length) * factor
        default:
          return (
            (consensusMarginOfSafety(a) - consensusMarginOfSafety(b)) * factor
          )
      }
    })
  }, [filtered, sort, direction])

  const counts = useMemo(() => {
    const base = {
      "deep-value": 0,
      undervalued: 0,
      fair: 0,
      overvalued: 0,
      expensive: 0,
    } as Record<ValuationBand, number>

    for (const stock of filtered) {
      base[valuationBand(consensusMarginOfSafety(stock))] += 1
    }

    return base
  }, [filtered])

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
            total={SAMPLE_UNIVERSE.length}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <BandDistribution counts={counts} total={filtered.length} />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <ValuationLegend />

            {selected.length > 0 && (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href="/portfolio" />}
              >
                Optimise {selected.length} selected
                <RiArrowRightLine />
              </Button>
            )}
          </div>

          <ScreenerTable
            stocks={sorted}
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
