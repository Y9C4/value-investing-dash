"use client"

import { RiCloseLine, RiSearchLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BAND_FILL, BAND_LABELS, type ScreenerFilters } from "@/lib/valuation"
import type { ValuationBand } from "@/lib/valuation"
import { cn } from "@/lib/utils"

const BANDS: ValuationBand[] = [
  "deep-value",
  "undervalued",
  "fair",
  "overvalued",
  "expensive",
  "unrated",
]

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-5 last:border-b-0">
      <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

/** A square, no-radius toggle used for every multi-select facet. */
function Chip({
  active,
  onClick,
  children,
  swatch,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  swatch?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:border-ring hover:text-foreground"
      )}
    >
      {swatch && (
        <span
          className="size-2 shrink-0"
          style={{ background: swatch }}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}

export function ScreenerFilterRail({
  filters,
  sectors,
  matches,
  total,
  onChange,
  onReset,
}: {
  filters: ScreenerFilters
  sectors: string[]
  matches: number
  total: number
  onChange: (next: ScreenerFilters) => void
  onReset: () => void
}) {
  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]
  }

  return (
    <div className="flex flex-col border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-heading text-sm font-semibold tracking-wider uppercase">
          Filters
        </span>
        <Button variant="ghost" size="xs" onClick={onReset}>
          <RiCloseLine />
          Reset
        </Button>
      </div>

      {/* Live count — the filter rail's whole purpose is narrowing this number. */}
      <div className="border-b border-border px-6 py-4">
        <p className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold">{matches}</span>
          <span className="text-sm text-muted-foreground">
            of {total} stocks match
          </span>
        </p>
      </div>

      <FilterGroup label="Search">
        <div className="flex items-center gap-2 border-b border-input focus-within:border-ring">
          <RiSearchLine className="size-4 shrink-0 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Ticker or company"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="border-transparent"
          />
        </div>
      </FilterGroup>

      <FilterGroup label="Valuation band">
        <div className="flex flex-wrap gap-2">
          {BANDS.map((band) => (
            <Chip
              key={band}
              active={filters.bands.includes(band)}
              swatch={BAND_FILL[band]}
              onClick={() =>
                onChange({ ...filters, bands: toggle(filters.bands, band) })
              }
            >
              {BAND_LABELS[band]}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Sector">
        <div className="flex flex-wrap gap-2">
          {sectors.map((sector) => (
            <Chip
              key={sector}
              active={filters.sectors.includes(sector)}
              onClick={() =>
                onChange({
                  ...filters,
                  sectors: toggle(filters.sectors, sector),
                })
              }
            >
              {sector}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Minimum margin of safety">
        <Label
          htmlFor="min-margin"
          className="flex items-center justify-between text-sm font-normal"
        >
          <span className="text-muted-foreground">At least</span>
          <span className="font-mono tabular-nums">
            {(filters.marginRange[0] * 100).toFixed(0)}%
          </span>
        </Label>
        <input
          id="min-margin"
          type="range"
          min={-100}
          max={100}
          step={5}
          value={filters.marginRange[0] * 100}
          onChange={(e) =>
            onChange({
              ...filters,
              marginRange: [
                Number(e.target.value) / 100,
                filters.marginRange[1],
              ],
            })
          }
          className="w-full accent-primary"
        />
      </FilterGroup>

      <FilterGroup label="Maximum beta">
        <Label
          htmlFor="max-beta"
          className="flex items-center justify-between text-sm font-normal"
        >
          <span className="text-muted-foreground">No more than</span>
          <span className="font-mono tabular-nums">
            {filters.maxBeta.toFixed(2)}
          </span>
        </Label>
        <input
          id="max-beta"
          type="range"
          min={25}
          max={300}
          step={5}
          value={filters.maxBeta * 100}
          onChange={(e) =>
            onChange({ ...filters, maxBeta: Number(e.target.value) / 100 })
          }
          className="w-full accent-primary"
        />
      </FilterGroup>

      <FilterGroup label="Model coverage">
        <div className="flex flex-wrap gap-2">
          {[1, 3, 5, 7, 9].map((count) => (
            <Chip
              key={count}
              active={filters.minMethods === count}
              onClick={() => onChange({ ...filters, minMethods: count })}
            >
              {count}+ models
            </Chip>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A stock scored by more models has a consensus you can lean on. Models
          skip companies they cannot describe — no dividend model for a
          non-payer, no cash-flow model for a bank — so coverage varies.
        </p>
      </FilterGroup>
    </div>
  )
}
