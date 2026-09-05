"use client"

import { RiCloseLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  MAX_GAMMA,
  MAX_PORTFOLIOS,
  MIN_PORTFOLIOS,
  type PortfolioSettings,
  type SettingsErrors,
} from "@/lib/portfolio-settings"
import { cn } from "@/lib/utils"

/**
 * The optimiser's constraint set, as a rail.
 *
 * This used to be a full-width card of three columns of number inputs sitting
 * above the results: a form to be filled in before anything would happen,
 * which on a laptop pushed the frontier below the fold. It is the same object
 * as the screener's filter rail, a standing set of constraints that the panels
 * beside it are a reading of, so it takes the same shape.
 *
 * These are not preferences. Each one changes the set of portfolios the solver
 * is allowed to pick from, so each one says what it does in a line underneath
 * it. That line replaced an info popover per group: a control whose effect is
 * hidden behind a click gets turned at random, and the analysis pages had
 * already settled on plain notes under the figure instead.
 *
 * There is no run button here. The action lives in the results toolbar, above
 * the chart it changes, so it stays on screen while the rail scrolls and is
 * still reachable on a viewport where the rail is collapsed.
 */

function ControlGroup({
  label,
  note,
  children,
}: {
  label: string
  /** What this group does, in one line. */
  note?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-6 py-5 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          {label}
        </span>
        {note && (
          <span className="text-xs leading-snug text-muted-foreground">
            {note}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * A dial whose current value is printed against its own label.
 *
 * The same construction the screener uses for margin and beta. A slider states
 * its range by its own geometry, which a number box cannot, and for a quantity
 * whose interesting property is the sweep rather than any particular figure
 * that is the whole control.
 */
function SliderField({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  note,
  onChange,
}: {
  id: string
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  note?: React.ReactNode
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="flex items-baseline justify-between text-sm font-normal"
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-sm tabular-nums">{display}</span>
      </Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-primary"
      />
      {note && (
        <span className="text-xs leading-snug text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  )
}

/**
 * Label above input rather than beside it. Labels in this app are uppercase
 * and letter-spaced, so a side-by-side row either wraps them onto two lines or
 * runs them into the field; both of which happened before this stacked.
 */
function NumberField({
  id,
  label,
  suffix,
  error,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string
  label: string
  suffix?: string
  error?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-baseline gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          className="h-8 font-mono tabular-nums"
          aria-invalid={Boolean(error)}
          {...props}
        />
        {suffix && (
          <span className="shrink-0 text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** A square switch, matching the filled-square "on" mark the screener uses. */
function ToggleRow({
  checked,
  onChange,
  label,
  note,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  note?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-start gap-2.5 border px-3 py-2.5 text-left transition-colors",
        checked
          ? "border-primary bg-primary/10"
          : "border-border hover:border-ring"
      )}
    >
      <span
        className={cn(
          "mt-0.5 size-2.5 shrink-0 border",
          checked
            ? "border-primary bg-primary"
            : "border-muted-foreground/50 bg-transparent"
        )}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            "text-xs font-semibold tracking-wider uppercase",
            checked ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        {note && (
          <span className="text-xs leading-snug text-muted-foreground">
            {note}
          </span>
        )}
      </span>
    </button>
  )
}

export function PortfolioControls({
  settings,
  errors,
  onChange,
  onReset,
  universeSize,
  dirty,
}: {
  settings: PortfolioSettings
  errors: SettingsErrors
  onChange: (next: PortfolioSettings) => void
  onReset: () => void
  /** Screened stock count; 0 means the full index. */
  universeSize: number
  /** These settings have not been solved yet. */
  dirty: boolean
}) {
  const set = <K extends keyof PortfolioSettings>(
    key: K,
    value: PortfolioSettings[K]
  ) => onChange({ ...settings, [key]: value })

  const gamma = Number(settings.gamma) || 0
  const portfolios = Number(settings.portfolios) || 0

  return (
    <div className="flex flex-col border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-heading text-sm font-semibold tracking-wider uppercase">
          Optimiser
        </span>
        <Button variant="ghost" size="xs" onClick={onReset}>
          <RiCloseLine />
          Reset
        </Button>
      </div>

      {/* What the solve is over. The screener's rail leads with the number its
          controls exist to move; here that number is fixed by the set handed
          over, and stating it is what keeps a scoped optimisation from looking
          like an index-wide one. */}
      <div className="flex flex-col gap-1 border-b border-border px-6 py-4">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-semibold tabular-nums">
            {universeSize > 0 ? universeSize : "All"}
          </span>
          <span className="text-sm text-muted-foreground">
            {universeSize > 0
              ? `screened ${universeSize === 1 ? "stock" : "stocks"}`
              : "stocks in the index"}
          </span>
        </p>
        <span className="text-xs leading-snug text-muted-foreground">
          {universeSize > 0
            ? "only these can be bought: a stock the filters rejected cannot enter the portfolio at any weight."
            : "screen first to narrow this: the optimiser reads expected return off past return, so left alone it favours whatever has already gone up."}
        </span>
        {dirty && (
          <span className="text-xs text-status-warning">
            Settings changed since the last run.
          </span>
        )}
      </div>

      <ControlGroup
        label="Position size"
        note="the most and least of the portfolio any one stock can be."
      >
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="min-weight"
            label="Minimum"
            suffix="%"
            type="number"
            step="0.5"
            placeholder="auto"
            value={settings.minWeight}
            error={errors.minWeight}
            onChange={(e) => set("minWeight", e.target.value)}
          />
          <NumberField
            id="max-weight"
            label="Maximum"
            suffix="%"
            type="number"
            step="0.5"
            placeholder="auto"
            value={settings.maxWeight}
            error={errors.maxWeight}
            onChange={(e) => set("maxWeight", e.target.value)}
          />
        </div>
        <span className="text-xs leading-snug text-muted-foreground">
          Left blank the solver picks a cap that fits the number of names: a 3%
          cap needs 34 of them to add up to a whole portfolio.
        </span>
        <ToggleRow
          checked={settings.shortAllowed}
          onChange={(next) => set("shortAllowed", next)}
          label="Allow short selling"
          note="lets a weight go negative, so a holding can be funded by selling a name the solver expects to do worse."
        />
      </ControlGroup>

      <ControlGroup
        label="Diversification"
        note="how hard the solver is pushed to spread money across names instead of piling it on a few."
      >
        <SliderField
          id="gamma"
          label="L2 penalty"
          value={gamma}
          display={gamma.toFixed(2)}
          min={0}
          max={MAX_GAMMA}
          step={0.05}
          onChange={(value) => set("gamma", value)}
          note={
            gamma > 0
              ? "money spread wider; watch eff. names in the anchor table climb."
              : "off: most names come back at exactly 0% or exactly the cap, with nothing in between."
          }
        />
      </ControlGroup>

      <ControlGroup
        label="Resolution"
        note="how many portfolios get solved along the curve."
      >
        <SliderField
          id="n-portfolios"
          label="Frontier points"
          value={portfolios}
          display={String(portfolios)}
          min={MIN_PORTFOLIOS}
          max={MAX_PORTFOLIOS}
          step={1}
          onChange={(value) => set("portfolios", value)}
          note={`${MIN_PORTFOLIOS} to ${MAX_PORTFOLIOS}. every point is its own solve, so this is what decides how long a run takes; past a handful the curve stops changing shape.`}
        />
        {errors.portfolios && (
          <span className="text-xs text-destructive">{errors.portfolios}</span>
        )}
      </ControlGroup>
    </div>
  )
}
