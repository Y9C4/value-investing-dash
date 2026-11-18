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
  BAND_BASIS,
  BAND_FILL,
  BAND_LABELS,
  VALUATION_METHODS,
  type MethodId,
  type ScreenerFilters,
} from "@/lib/valuation"
import type { ValuationBand } from "@/lib/valuation"
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
            formula
          </span>
          <div className="text-xs leading-relaxed break-words">
            {method.formula}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wider text-destructive font-semibold uppercase">
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
                "text-xs font-semibold tracking-wider uppercase",
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
                "text-xs font-semibold tracking-wider uppercase",
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
              <span className="text-xs tracking-wider text-muted-foreground uppercase">
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
}) {
  const evidence = blendEvidence(filters.signals)

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
            placeholder="Ticker or name"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="border-transparent"
          />
        </div>
      </FilterGroup>

      {/* The signal first: the backtest ranks the blend above value alone,
          and it is what the table is sorted on by default. */}
      <FilterGroup
        label="Rank each stock on"
        info={<Info title="Signal">{SIGNAL_EVIDENCE}</Info>}
      >
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
                // A score of nothing would blank the column with no reason given.
                if (next.length === 0) return
                // Kept in registry order, so the tested-blend lookup is stable.
                onChange({
                  ...filters,
                  signals: SIGNAL_COMPONENTS.map((c) => c.id).filter((id) =>
                    next.includes(id)
                  ),
                })
              }}
            />
          ))}
        </div>

        {/* What the switches add up to, and whether that blend was tested. */}
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {evidence ? (
            <>
              Score = mean percentile.{" "}
              <span className="text-foreground">{evidence.label}</span> had a
              development IC of{" "}
              <span className="font-mono">{evidence.ic.toFixed(3)}</span> (t ={" "}
              <span className="font-mono">{evidence.icTStat.toFixed(2)}</span>).
            </>
          ) : (
            <>
              Score = mean percentile. This combination was not tested in the
              backtest.
            </>
          )}
        </p>
      </FilterGroup>

      <FilterGroup label="Signal strength">
        <div className="flex flex-wrap gap-2">
          {SIGNAL_BANDS.map((band) => (
            <Chip
              key={band}
              active={filters.signalBands.includes(band)}
              swatch={SIGNAL_BAND_FILL[band]}
              onClick={() =>
                onChange({
                  ...filters,
                  signalBands: toggle(filters.signalBands, band),
                })
              }
            >
              {SIGNAL_BAND_LABELS[band]}
            </Chip>
          ))}
        </div>
      </FilterGroup>

      {/* The rail reads top to bottom as one sentence: value each stock with
          these models, then keep only these bands. */}
      <FilterGroup
        label="Value each stock with"
        info={
          <Info title="Reverse-DCF models">
            Each model solves for the annual return today&rsquo;s price implies
            and subtracts the return the stock&rsquo;s risk requires. The
            &ldquo;Price implies&rdquo; column averages the ones switched on
            here, so turning some off re-answers every reading and band on
            screen. The number beside a model is how many of the {total} stocks
            it can solve for.
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
                // Switching the last model off would leave nothing to average
                // and empty the screen with no stated reason.
                if (next.length === 0) return
                onChange({
                  ...filters,
                  methods: next.length === VALUATION_METHODS.length ? [] : next,
                })
              }}
            />
          ))}
        </div>

        {/* What the switches above add up to. */}
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          Each stock averages whichever selected models solved for it, the rule
          the backtest used. Unrated means none did.
        </p>
      </FilterGroup>

      <FilterGroup
        label="Valuation bands"
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
          <span className="text-muted-foreground">Max</span>
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
