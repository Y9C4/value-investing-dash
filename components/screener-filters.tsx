"use client"

import { Tex } from "@/components/tex"
import {
  RiCloseLine,
  RiInformationLine,
  RiSearchLine,
} from "@remixicon/react"

import Link from "next/link"
import { useRef } from "react"

import { Info } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  describeEvidence,
  type SignalComponent,
  type SignalId,
} from "@/lib/signals"
import { evidenceFor } from "@/lib/evidence"
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

/** The toggle used for every multi-select facet. */
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
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        // Foreground tones, not gold: gold is kept for primary actions and the strategy.
        active
          ? "border-foreground/60 bg-foreground/10 text-foreground"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
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

/** What each strategy finds and where its rule comes from: the detail the compact radios leave out. */
function StrategyInfo() {
  return (
    <Popover>
      <PopoverTrigger openOnHover delay={200} aria-label="About Strategy" className="size-4 shrink-0">
        <RiInformationLine className="size-3.5" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent side="right" className="max-h-(--available-height) max-w-sm gap-3 overflow-y-auto">
        <PopoverTitle>Strategy</PopoverTitle>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A strategy sets what the score is made of and which stocks are kept. Search and sector filters apply
          on top. Changing a quintile filter or the score&rsquo;s ingredients makes it custom.
        </p>
        <dl className="flex flex-col gap-2.5 border-t border-border pt-2.5">
          {PRESETS.map((preset) => (
            <div key={preset.id} className="flex flex-col gap-0.5">
              <dt className="text-xs font-semibold">{preset.label}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">
                {preset.blurb} {preset.basis}
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
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

        <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Formula
          </span>
          <div className="text-xs"><Tex block>{method.formula}</Tex></div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">
            Can&rsquo;t be calculated when
          </span>
          <ul className="flex flex-col gap-1">
            {method.refusesWhen.map((reason) => (
              <li
                key={reason}
                className="flex gap-2 text-xs leading-relaxed text-muted-foreground"
              >
                <span aria-hidden="true">-</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          Works for {coverage} of {total} stocks
          {total > 0 && <> ({((coverage / total) * 100).toFixed(0)}%)</>}.
        </p>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One model as its own switch, carrying its full name and its coverage.
 *
 * The portfolio page offers the same choice over the same four models with
 * its own `ToggleRow`; both read the labels from `VALUATION_METHODS`, so the
 * two pages agree on what a model is called.
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
        "flex items-start gap-1 rounded-md border pr-1 transition-colors",
        active ? "border-foreground/40" : "border-border"
      )}
    >
      {/* Toggle and info are siblings, not nested: a button inside a button is
          invalid and breaks keyboard traversal. */}
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
      >
        <span className="flex items-baseline gap-2">
          {/* A filled square reads as "on" without relying on colour alone. */}
          <span
            className={cn(
              "size-2 shrink-0 border",
              active
                ? "border-foreground bg-foreground"
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
        <span className="text-xs text-muted-foreground tabular-nums">
          covers {coverage} of {total}
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
 * One signal component as a switch: its name, its holdout IC and how much
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
  const evidence = evidenceFor([component.id])

  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-md border pr-1 transition-colors",
        active ? "border-foreground/40" : "border-border"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground"
      >
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "size-2 shrink-0 border",
              active
                ? "border-foreground bg-foreground"
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
        <span className="text-xs text-muted-foreground tabular-nums">
          {evidence && <>test rank IC {evidence.holdout.ic.toFixed(3)} · </>}covers {coverage} of {total}
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
            <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Formula
              </span>
              <div className="text-xs"><Tex block>{component.formula}</Tex></div>
            </div>
            <p className="border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
              {evidence && describeEvidence(evidence)} Covers <span className="font-figure">{coverage}</span> of{" "}
              <span className="font-figure">{total}</span> stocks.
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
  /**
   * Closes the rail. Shown only under `lg`, where the open rail stacks above the
   * table and the Filters toggle is below it; from `lg` up the toggle sits beside it.
   */
  onClose: () => void
}) {
  const evidence = evidenceFor(filters.signals)
  const radios = useRef<(HTMLButtonElement | null)[]>([])

  // WAI-ARIA radio group: arrows move focus and check the next radio, wrapping.
  function moveStrategy(event: React.KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = (radios.current.indexOf(event.target as HTMLButtonElement) + step + PRESETS.length) % PRESETS.length
    radios.current[next]?.focus()
    onChange(applyPreset(filters, PRESETS[next].id))
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value]
  }

  // Changing what the score is made of, or which fifths are kept, departs from
  // the chosen screen: the preset is then "custom" rather than silently wrong.
  function customise(next: Partial<ScreenerFilters>) {
    // Graham is a strategy, not a custom filter: it has no control here, so it
    // must not keep filtering invisibly once the strategy is left.
    onChange({ ...filters, ...next, preset: null, graham: false })
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card">
      {/* Sticky inside the rail's own scroll, so Reset and Close never scroll away. */}
      <div className="sticky top-0 z-10 flex flex-col gap-1 border-b border-border bg-card px-6 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Filters</span>
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="xs" onClick={onReset}>
              Reset all
            </Button>
            <Button variant="ghost" size="xs" onClick={onClose} aria-label="Close filters" className="lg:hidden">
              <RiCloseLine />
            </Button>
          </span>
        </div>
        {/* Live count: the rail's whole purpose is narrowing this number. */}
        <p className="flex items-baseline gap-2" aria-live="polite">
          <span className="font-figure text-2xl font-semibold tabular-nums">{matches}</span>
          <span className="text-sm text-muted-foreground">of {total} stocks shown</span>
        </p>
      </div>

      <FilterGroup label="Strategy" info={<StrategyInfo />}>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Strategy" onKeyDown={moveStrategy}>
          {PRESETS.map((preset, index) => {
            const active = filters.preset === preset.id
            return (
              <button
                key={preset.id}
                ref={(el) => {
                  radios.current[index] = el
                }}
                type="button"
                role="radio"
                aria-checked={active}
                // Roving tab stop: the checked radio, or the first while the screen is custom.
                tabIndex={active || (filters.preset === null && index === 0) ? 0 : -1}
                onClick={() => onChange(applyPreset(filters, preset.id))}
                className={cn(
                  "flex flex-col rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                  active ? "border-primary bg-primary/10" : "border-border hover:border-foreground/40"
                )}
              >
                <span className={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {preset.label}
                </span>
                <span className="text-xs text-muted-foreground">{preset.short}</span>
              </button>
            )
          })}
          {filters.preset === null && (
            <p className="text-xs text-muted-foreground">
              Custom: your filters no longer match any strategy above.
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
        label="Score quintile"
        info={
          <Info title="Score quintile">
            Scored stocks split into five equal groups. Q5 is the top 20% on the
            score.
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
        <summary className="cursor-pointer list-none px-6 py-4 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground">
          <span className="group-open/advanced:hidden">+ More: score ingredients, models, beta limit</span>
          <span className="hidden group-open/advanced:inline">− More: score ingredients, models, beta limit</span>
        </summary>

        <FilterGroup label="What the score averages" info={<Info title="How it was tested">{SIGNAL_EVIDENCE}</Info>}>
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
                <span className="text-foreground">{evidence.label}</span>: {describeEvidence(evidence)}{" "}
                <Link href="/research" className="underline underline-offset-2 hover:text-foreground">Backtest results</Link>
              </>
            ) : (
              <>This combination has not been backtested.</>
            )}
          </p>
        </FilterGroup>

        <FilterGroup
          label="Models used for value"
          info={
            <Info title="Reverse-DCF models">
              Each reverse-DCF model finds the yearly return today&rsquo;s price implies and subtracts the return
              the stock&rsquo;s risk requires. Value averages the ones switched on, so turning one off re-ranks
              every stock. Each shows how many of the {total} stocks it works for.
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
            Each stock averages whichever selected models work for it, as in the backtest. &ldquo;Not
            valued&rdquo; means none did. Backtest figures use all four.
          </p>
        </FilterGroup>

        <FilterGroup
          label="Beta limit"
          info={
            <Info title="Beta">
              Sensitivity to the market, from 252 days of daily returns, adjusted toward the average (Levi &amp;
              Welch 2017). A limit also drops stocks whose beta could not be measured.
            </Info>
          }
        >
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id="beta-cap"
              checked={filters.maxBeta !== null}
              onChange={(e) => onChange({ ...filters, maxBeta: e.target.checked ? BETA_CAP_START : null })}
            />
            <label htmlFor="beta-cap" className="cursor-pointer text-muted-foreground">Limit beta</label>
            {filters.maxBeta !== null && (
              <span className="ml-auto font-figure tabular-nums">{filters.maxBeta.toFixed(2)}</span>
            )}
          </div>
          {filters.maxBeta !== null && (
            <input
              aria-label="Beta limit"
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
