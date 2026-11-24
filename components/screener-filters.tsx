"use client"

import {
  RiCloseLine,
  RiInformationLine,
  RiSearchLine,
} from "@remixicon/react"

import { Info } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  BAND_BASIS,
  BAND_FILL,
  BAND_LABELS,
  VALUATION_METHODS,
  type MethodId,
} from "@/lib/valuation"
import type { ValuationBand } from "@/lib/valuation"
import {
  GRAHAM_NOTE,
  PRESETS,
  applyPreset,
  type ScreenerFilters,
} from "@/lib/screen"
import {
  SIGNAL_BANDS,
  SIGNAL_BAND_FILL,
  SIGNAL_BAND_LABELS,
  SIGNAL_COMPONENTS,
  SIGNAL_EVIDENCE,
  blendEvidence,
  type SignalComponent,
  type SignalId,
} from "@/lib/signals"
import { cn } from "@/lib/utils"

const BANDS: ValuationBand[] = [
  "deep-value",
  "undervalued",
  "fair",
  "overvalued",
  "expensive",
  "unrated",
]

/** Beta cap the slider starts at when switched on: the market's own beta. */
const BETA_CAP_START = 1

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
      <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
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
          <span className="text-xs text-muted-foreground">
            formula
          </span>
          <div className="text-xs leading-relaxed break-words">
            {method.formula}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-destructive font-semibold">
            fails when
          </span>
          <ul className="flex flex-col gap-1">
            {method.refusesWhen.map((reason) => (
              <li
                key={reason}
                className="flex gap-2 text-xs leading-relaxed text-destructive"
              >
                <span aria-hidden="true">-</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Solves for <span className="font-mono">{coverage}</span> of the{" "}
          <span className="font-mono">{total}</span> stocks
          {total > 0 && <> ({((coverage / total) * 100).toFixed(0)}%)</>}.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One model as its own switch, carrying its full name and its coverage.
 *
 * Exported because the portfolio page offers the same choice over the same
 * four models: which ones the implied excess return is averaged over. One control, so the
 * two pages cannot drift into disagreeing about what a model is called or
 * what switching it off looks like.
 */
export function MethodToggle({
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
                "text-xs font-semibold",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {method.label}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {coverage}/{total}
          </span>
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
 * One signal component as a switch: its name, its development IC and how much
 * of the universe it can score. The same shape as `MethodToggle`, so the two
 * kinds of switch on the rail read as one control language.
 */
function SignalToggle({
  component,
  active,
  coverage,
  total,
  onClick,
}: {
  component: SignalComponent
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
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 text-left"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-2">
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
                "text-xs font-semibold",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {component.label}
            </span>
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            IC {component.ic.toFixed(3)} · {coverage}/{total}
          </span>
        </span>

        <span className="h-0.5 w-full bg-muted" aria-hidden="true">
          <span
            className="block h-full bg-muted-foreground/50"
            style={{ width: `${(share * 100).toFixed(1)}%` }}
          />
        </span>
      </button>

      <div className="py-2.5">
        <Popover>
          <PopoverTrigger
            openOnHover
            delay={200}
            aria-label={`How ${component.full} is calculated`}
            className="size-6 shrink-0"
          >
            <RiInformationLine className="size-4" aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent side="right" className="max-w-sm gap-3">
            <div className="flex flex-col gap-1">
              <PopoverTitle>{component.label}</PopoverTitle>
              <p className="text-sm font-medium">{component.full}</p>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {component.blurb}
            </p>
            <div className="flex flex-col gap-1 border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                formula
              </span>
              <div className="text-xs leading-relaxed break-words">
                {component.formula}
              </div>
            </div>
            <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
              Development rank IC{" "}
              <span className="font-mono">{component.ic.toFixed(3)}</span> (t ={" "}
              <span className="font-mono">{component.icTStat.toFixed(2)}</span>).
              Scores <span className="font-mono">{coverage}</span> of the{" "}
              <span className="font-mono">{total}</span> stocks.
            </p>
          </PopoverContent>
        </Popover>
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
  signalCoverage,
  onChange,
  onReset,
  onClose,
}: {
  filters: ScreenerFilters
  sectors: string[]
  matches: number
  total: number
  /** How many stocks in the full universe each model could solve for. */
  methodCoverage: Record<MethodId, number>
  /** How many stocks in the full universe each signal component can score. */
  signalCoverage: Record<SignalId, number>
  onChange: (next: ScreenerFilters) => void
  onReset: () => void
  /** Closes the rail where it is an overlay; the button hides where it is docked. */
  onClose: () => void
}) {
  const evidence = blendEvidence(filters.signals)

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]
  }

  // Changing what the score is made of, or which fifths are kept, departs from
  // the chosen screen: the preset is then "custom" rather than silently wrong.
  function customise(next: Partial<ScreenerFilters>) {
    onChange({ ...filters, ...next, preset: null })
  }

  return (
    <div className="flex flex-col border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="text-sm font-semibold">Filters</span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onReset}>
            Reset all
          </Button>
          <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close filters" className="min-[1700px]:hidden">
            <RiCloseLine />
          </Button>
        </span>
      </div>

      {/* Live count: the rail's whole purpose is narrowing this number. */}
      <div className="border-b border-border px-6 py-4">
        <p className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums">{matches}</span>
          <span className="text-sm text-muted-foreground">of {total} stocks shown</span>
        </p>
      </div>

      <FilterGroup
        label="Strategy"
        info={
          <Info title="Strategy">
            A strategy sets which factors the composite averages and which
            stocks are kept. Search and sector filters apply on top. Changing a
            quintile filter or the composite&rsquo;s factors makes it custom.
          </Info>
        }
      >
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Strategy">
          {PRESETS.map((preset) => {
            const active = filters.preset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(applyPreset(filters, preset.id))}
                className={cn(
                  "flex flex-col gap-0.5 border px-3 py-2.5 text-left transition-colors",
                  active ? "border-primary bg-primary/10" : "border-border hover:border-ring"
                )}
              >
                <span className={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {preset.label}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">{preset.blurb}</span>
                <span className="text-xs leading-relaxed text-muted-foreground/80">{preset.basis}</span>
              </button>
            )
          })}
          {filters.preset === null && (
            <p className="text-xs text-muted-foreground">
              Custom: the quintile filters or composite factors differ from every strategy above.
            </p>
          )}
        </div>
        {filters.graham && (
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">{GRAHAM_NOTE}</p>
        )}
      </FilterGroup>

      <FilterGroup label="Ticker or company">
        <div className="flex items-center gap-2 border-b border-input focus-within:border-ring">
          <RiSearchLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search by ticker or company name"
            placeholder="Ticker or name"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="border-transparent"
          />
        </div>
      </FilterGroup>

      <FilterGroup label="Sector">
        <div className="flex flex-wrap gap-2">
          {sectors.map((sector) => (
            <Chip
              key={sector}
              active={filters.sectors.includes(sector)}
              onClick={() => onChange({ ...filters, sectors: toggle(filters.sectors, sector) })}
            >
              {sector}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Value quintile" info={<Info title="Value quintile">{BAND_BASIS}</Info>}>
        <div className="flex flex-wrap gap-2">
          {BANDS.map((band) => (
            <Chip
              key={band}
              active={filters.bands.includes(band)}
              swatch={BAND_FILL[band]}
              onClick={() => customise({ bands: toggle(filters.bands, band) })}
            >
              {BAND_LABELS[band]}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup
        label="Composite quintile"
        info={
          <Info title="Composite quintile">
            Quintiles of the composite percentile: Q5 is the 20% of scored
            stocks ranked highest on the factors selected below.
          </Info>
        }
      >
        <div className="flex flex-wrap gap-2">
          {SIGNAL_BANDS.map((band) => (
            <Chip
              key={band}
              active={filters.signalBands.includes(band)}
              swatch={SIGNAL_BAND_FILL[band]}
              onClick={() => customise({ signalBands: toggle(filters.signalBands, band) })}
            >
              {SIGNAL_BAND_LABELS[band]}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      <details className="group/advanced border-t border-border">
        <summary className="cursor-pointer list-none px-6 py-4 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <span className="group-open/advanced:hidden">+ Composite factors, valuation models, beta cap</span>
          <span className="hidden group-open/advanced:inline">− Composite factors, valuation models, beta cap</span>
        </summary>

        <FilterGroup label="Factors averaged into the composite" info={<Info title="Evidence">{SIGNAL_EVIDENCE}</Info>}>
          <div className="flex flex-col gap-1.5">
            {SIGNAL_COMPONENTS.map((component) => (
              <SignalToggle
                key={component.id}
                component={component}
                active={filters.signals.includes(component.id)}
                coverage={signalCoverage[component.id] ?? 0}
                total={total}
                onClick={() => {
                  const next = toggle(filters.signals, component.id)
                  // A composite of nothing would blank the column with no reason given.
                  if (next.length === 0) return
                  // Kept in registry order, so the tested-blend lookup is stable.
                  customise({
                    signals: SIGNAL_COMPONENTS.map((c) => c.id).filter((id) => next.includes(id)),
                  })
                }}
              />
            ))}
          </div>
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            {evidence ? (
              <>
                <span className="text-foreground">{evidence.label}</span> had a development IC of{" "}
                <span className="font-mono">{evidence.ic.toFixed(3)}</span> (t ={" "}
                <span className="font-mono">{evidence.icTStat.toFixed(2)}</span>).
              </>
            ) : (
              <>This combination was not tested in the backtest.</>
            )}
          </p>
        </FilterGroup>

        <FilterGroup
          label="Reverse-DCF models averaged into value"
          info={
            <Info title="Reverse-DCF models">
              Each model solves for the annual return today&rsquo;s price implies and subtracts the return the
              stock&rsquo;s risk requires. Value averages the ones switched on, so turning some off re-ranks
              every stock. The number beside a model is how many of the {total} stocks it can solve for.
            </Info>
          }
        >
          <div className="flex flex-col gap-1.5">
            {VALUATION_METHODS.map((method) => (
              <MethodToggle
                key={method.id}
                method={method}
                active={filters.methods.length === 0 || filters.methods.includes(method.id)}
                coverage={methodCoverage[method.id] ?? 0}
                total={total}
                onClick={() => {
                  // An empty selection means "all": the first click materialises
                  // it into an explicit list minus the one switched off.
                  const current =
                    filters.methods.length === 0 ? VALUATION_METHODS.map((m) => m.id) : filters.methods
                  const next = toggle(current, method.id)
                  if (next.length === 0) return
                  onChange({ ...filters, methods: next.length === VALUATION_METHODS.length ? [] : next })
                }}
              />
            ))}
          </div>
          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            Each stock averages whichever selected models solved for it, the rule the backtest used. Not valued
            means none did. The backtest&rsquo;s figures are for all four.
          </p>
        </FilterGroup>

        <FilterGroup
          label="Maximum beta"
          info={
            <Info title="Beta">
              Sensitivity to the market, from 252 days of daily returns, shrunk toward the average (Levi &amp;
              Welch 2017). A cap also drops stocks whose beta could not be measured.
            </Info>
          }
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.maxBeta !== null}
              onChange={(e) => onChange({ ...filters, maxBeta: e.target.checked ? BETA_CAP_START : null })}
              className="accent-primary"
            />
            <span className="text-muted-foreground">Cap beta</span>
            {filters.maxBeta !== null && (
              <span className="ml-auto font-mono tabular-nums">{filters.maxBeta.toFixed(2)}</span>
            )}
          </label>
          {filters.maxBeta !== null && (
            <input
              aria-label="Maximum beta"
              type="range"
              min={25}
              max={300}
              step={5}
              value={filters.maxBeta * 100}
              onChange={(e) => onChange({ ...filters, maxBeta: Number(e.target.value) / 100 })}
              className="w-full accent-primary"
            />
          )}
        </FilterGroup>
      </details>
    </div>
  )
}
