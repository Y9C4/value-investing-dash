"use client"

import {
  RiCloseLine,
  RiInformationLine,
  RiSearchLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Label } from "@/components/ui/label"
import {
  BAND_FILL,
  BAND_LABELS,
  VALUATION_METHODS,
  type MethodId,
  type ScreenerFilters,
} from "@/lib/valuation"
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

/**
 * The methodology panel for one model: what it computes, and the conditions
 * under which it declines to answer. This is a popover rather than a tooltip
 * on purpose — it is needed to read the control, and tooltip content is
 * unreachable on touch devices.
 */
function MethodInfo({
  method,
  coverage,
  total,
}: {
  method: (typeof VALUATION_METHODS)[number]
  coverage: number
  total: number
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={200}
        aria-label={`How ${method.full} is calculated`}
        className="size-6 shrink-0"
      >
        <RiInformationLine className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="right" className="max-w-sm gap-3">
        <div className="flex flex-col gap-1">
          <PopoverTitle>{method.label}</PopoverTitle>
          <p className="text-sm font-medium">{method.full}</p>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          {method.blurb}
        </p>

        <div className="flex flex-col gap-1 border border-border px-3 py-2">
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Calculation
          </span>
          <code className="font-mono text-xs leading-relaxed break-words">
            {method.formula}
          </code>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Produces no verdict when
          </span>
          <ul className="flex flex-col gap-1">
            {method.refusesWhen.map((reason) => (
              <li
                key={reason}
                className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <span aria-hidden="true">—</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* The number on the toggle, stated in words. A model that can only
            speak to a fraction of the index is a different proposition from
            one that covers all of it. */}
        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Values <span className="font-mono">{coverage}</span> of the{" "}
          <span className="font-mono">{total}</span> stocks in the universe
          {total > 0 && (
            <> ({((coverage / total) * 100).toFixed(0)}%)</>
          )}
          . The rest meet one of the conditions above.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One model, as its own switch. Unlike the sector and band chips this row
 * carries the model's full name and its coverage, because "FCFF" alone tells
 * a reader nothing about whether switching it off should matter to them.
 */
function MethodToggle({
  method,
  active,
  coverage,
  total,
  onClick,
}: {
  method: (typeof VALUATION_METHODS)[number]
  active: boolean
  coverage: number
  total: number
  onClick: () => void
}) {
  const share = total === 0 ? 0 : coverage / total

  return (
    <div
      className={cn(
        "flex items-start gap-1 border pr-1 transition-colors",
        active ? "border-primary bg-primary/10" : "border-border"
      )}
    >
      {/* Toggle and info are siblings, not nested: a button inside a button is
          invalid and breaks keyboard traversal. */}
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 text-left"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
            {/* A filled square reads as "on" without relying on colour alone. */}
            <span
              className={cn(
                "size-2 shrink-0 border",
                active
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/50 bg-transparent"
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "text-xs font-semibold tracking-wider uppercase",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {method.label}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {coverage}
          </span>
        </span>

        <span className="text-xs leading-snug text-muted-foreground">
          {method.full}
        </span>

        {/* Coverage as a bar: how much of the visible universe this model can
            actually speak to. A model that covers 40 stocks is a different
            proposition from one that covers 500. */}
        <span className="h-0.5 w-full bg-muted" aria-hidden="true">
          <span
            className="block h-full bg-muted-foreground/50"
            style={{ width: `${(share * 100).toFixed(1)}%` }}
          />
        </span>
      </button>

      <div className="py-2.5">
        <MethodInfo method={method} coverage={coverage} total={total} />
      </div>
    </div>
  )
}

export function ScreenerFilterRail({
  filters,
  sectors,
  matches,
  total,
  methodCoverage,
  onChange,
  onReset,
}: {
  filters: ScreenerFilters
  sectors: string[]
  matches: number
  total: number
  /** How many stocks in the full universe each model produced a verdict for. */
  methodCoverage: Record<MethodId, number>
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

      {/* Placed above the bands because it defines what a band means: the
          consensus, and therefore every margin on screen, is computed from
          exactly these models. */}
      <FilterGroup label="Valuation models">
        <p className="text-xs leading-relaxed text-muted-foreground">
          The consensus margin of safety is a confidence-weighted average of
          the models switched on here. Turn some off to screen on one school of
          valuation — cash flows alone, or book value alone — and every margin,
          band and ranking recomputes against that view. Hover any{" "}
          <RiInformationLine
            className="inline size-3.5 align-text-bottom"
            aria-hidden="true"
          />{" "}
          for the formula and the cases where that model declines to answer.
        </p>

        {/* Names the column of numbers on the right of each row. A bare count
            beside a model name is ambiguous — it could be a weight, a rank or
            a score — so it gets a heading rather than a tooltip. */}
        <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5">
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Model
          </span>
          <span className="text-xs tracking-wider text-muted-foreground uppercase">
            Stocks valued
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {VALUATION_METHODS.map((method) => (
            <MethodToggle
              key={method.id}
              method={method}
              active={
                filters.methods.length === 0 ||
                filters.methods.includes(method.id)
              }
              coverage={methodCoverage[method.id] ?? 0}
              total={total}
              onClick={() => {
                // An empty selection means "all". The first click has to
                // materialise that into an explicit list minus the one just
                // switched off, or nothing would appear to happen.
                const current =
                  filters.methods.length === 0
                    ? VALUATION_METHODS.map((m) => m.id)
                    : filters.methods
                const next = toggle(current, method.id)
                // Switching the last model off would leave no verdicts to
                // average and empty the screen with no stated reason. Refuse
                // the click instead.
                if (next.length === 0) return
                onChange({
                  ...filters,
                  methods: next.length === VALUATION_METHODS.length ? [] : next,
                })
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {filters.methods.length === 0
              ? `All ${VALUATION_METHODS.length} models`
              : `${filters.methods.length} of ${VALUATION_METHODS.length} models`}
          </span>
          {filters.methods.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange({ ...filters, methods: [] })}
            >
              Use all
            </Button>
          )}
        </div>

        {/* Switching every model off would leave nothing to average, so the
            screen would empty out with no explanation. */}
        {filters.methods.length === 0 ? null : filters.methods.length === 1 ? (
          <p className="border border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            A single model is a single opinion. Margins here carry that model&rsquo;s
            known bias with nothing to offset it.
          </p>
        ) : null}
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

    </div>
  )
}
