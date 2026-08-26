"use client"

import {
  RiCloseLine,
  RiInformationLine,
  RiSearchLine,
} from "@remixicon/react"

import { Info } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  AGREEMENT_BASIS,
  BAND_BASIS,
  BAND_FILL,
  BAND_LABELS,
  MARGIN_BASIS,
  VALUATION_METHODS,
  selectedModelCount,
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
  info,
  children,
}: {
  label: string
  info?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-5 last:border-b-0">
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
        {info}
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
 * The methodology panel for one model: what it computes, and when it declines
 * to answer. A popover rather than a tooltip because it is needed to read the
 * control, and tooltip content is unreachable on touch.
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

        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Values <span className="font-mono">{coverage}</span> of the{" "}
          <span className="font-mono">{total}</span> stocks in the universe
          {total > 0 && <> ({((coverage / total) * 100).toFixed(0)}%)</>}.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** One model as its own switch, carrying its full name and its coverage. */
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

        {/* Coverage as a bar: how much of the universe this model can speak to. */}
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

/**
 * The agreement floor. Coverage is uneven, so without it a stock can clear the
 * screen on one model's opinion while the rest of the panel never saw it.
 */
function AgreementControl({
  value,
  max,
  onChange,
}: {
  value: number
  max: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          Valued by at least
          <Info title="Model agreement">{AGREEMENT_BASIS}</Info>
        </span>
        <span className="font-mono tabular-nums">
          {value} of {max}
        </span>
      </span>

      <div className="flex" role="group" aria-label="Minimum models per stock">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={n === value}
            className={cn(
              "-ml-px flex-1 border py-1 font-mono text-xs transition-colors first:ml-0",
              n === value
                ? "z-10 border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-ring hover:text-foreground"
            )}
          >
            {n}
          </button>
        ))}
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
  const modelCount = selectedModelCount(filters.methods)

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

      {/* The rail reads top to bottom as one sentence: value each stock with
          these models, then keep only these bands, at this margin. The labels
          carry the causal order so no paragraph has to explain it. */}
      <FilterGroup
        label="Value each stock with"
        info={
          <Info title="Valuation models">
            Each model prices a company off its own fundamentals and reports a
            fair value. The consensus margin of safety is the
            confidence-weighted average of the ones switched on here, so turning
            some off re-answers every margin, band and ranking on screen. The
            number beside a model is how many of the {total} stocks it can
            value.
          </Info>
        }
      >
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
                // average and empty the screen with no stated reason.
                if (next.length === 0) return
                onChange({
                  ...filters,
                  methods: next.length === VALUATION_METHODS.length ? [] : next,
                  // The floor cannot ask for more models than are selected.
                  minModels: Math.min(filters.minModels, next.length),
                })
              }}
            />
          ))}
        </div>

        <AgreementControl
          value={Math.min(filters.minModels, modelCount)}
          max={modelCount}
          onChange={(minModels) => onChange({ ...filters, minModels })}
        />
      </FilterGroup>

      <FilterGroup
        label="Then keep only"
        info={<Info title="Valuation bands">{BAND_BASIS}</Info>}
      >
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

      <FilterGroup
        label="Margin of safety"
        info={<Info title="Margin of safety">{MARGIN_BASIS}</Info>}
      >
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

      <FilterGroup
        label="Maximum beta"
        info={
          <Info title="Beta">
            Covariance with the S&amp;P 500 over the trailing 252 trading days,
            divided by the index&rsquo;s variance. How much of a stock&rsquo;s
            movement is the market moving rather than the company.
          </Info>
        }
      >
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
