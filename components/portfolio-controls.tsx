"use client"

import { RiCloseLine } from "@remixicon/react"

import { Info } from "@/components/info"
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
import { VALUATION_METHODS, type MethodId } from "@/lib/valuation"
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
 * Each control used to carry a sentence of its own explaining what it does,
 * on top of a sentence per group and a paragraph under the position fields.
 * Stacked up that is more prose than dial, and it pushed the resolution
 * slider off the bottom of a laptop rail. The dials state their own units,
 * ranges and resolved values now; the standing explanation of what the page
 * is for lives in "How this works".
 *
 * There is no run button here. The action lives in the results toolbar, above
 * the chart it changes, so it stays on screen while the rail scrolls and is
 * still reachable on a viewport where the rail is collapsed.
 */

function ControlGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 bg-card px-6 py-4">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

/**
 * A dial whose current value is printed against its own label, and whose ends
 * are printed under it.
 *
 * The same construction the screener uses for margin and beta. A slider states
 * its range by its own geometry, which a number box cannot, and for a quantity
 * whose interesting property is the sweep rather than any particular figure
 * that is the whole control. The end labels replace a sentence that spelled
 * the same two numbers out in words.
 */
function SliderField({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  onChange,
}: {
  id: string
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  minLabel?: string
  maxLabel?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor={id}
        className="flex items-baseline justify-between text-xs font-normal"
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-figure text-sm tabular-nums">{display}</span>
      </Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full accent-foreground"
      />
      {(minLabel ?? maxLabel) && (
        <span className="flex justify-between font-figure text-xs text-muted-foreground tabular-nums">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </span>
      )}
    </div>
  )
}

/**
 * Label above input rather than beside it. Labels in this app are uppercase
 * and letter-spaced, so a side-by-side row either wraps them onto two lines or
 * runs them into the field; both of which happened before this stacked.
 *
 * Blank means the solver picks the bound. Once a solve has resolved it, that
 * value is the placeholder and an "auto" tag on the label says where it came
 * from; before then the placeholder alone says "auto". Never both at once.
 */
function NumberField({
  id,
  label,
  suffix,
  error,
  resolved,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string
  label: string
  suffix?: string
  error?: string
  /** What the last solve resolved this bound to when it was left blank. */
  resolved?: string
}) {
  const showsResolved = resolved !== undefined && String(props.value ?? "").trim() === ""

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <Label
        htmlFor={id}
        className="flex items-baseline justify-between gap-2 text-muted-foreground"
      >
        {label}
        {showsResolved && (
          <span className="text-xs font-normal normal-case">
            auto
          </span>
        )}
      </Label>
      <div className="flex items-baseline gap-1.5">
        <Input
          id={id}
          inputMode="decimal"
          className="h-8 font-figure tabular-nums"
          aria-invalid={Boolean(error)}
          placeholder={resolved ?? "auto"}
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

/**
 * A square switch, matching the filled-square "on" mark the screener uses.
 *
 * Ink, not gold: gold is kept for the Run button and the current selection,
 * and a rail of gold tiles made every switch look like the primary action.
 * The info trigger is a sibling of the switch, never nested inside it.
 */
function ToggleRow({
  checked,
  onChange,
  label,
  note,
  info,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  note?: string
  info?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-start border transition-colors",
        checked ? "border-foreground/40" : "border-border hover:border-ring"
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span
          className={cn(
            "mt-0.5 size-2.5 shrink-0 border",
            checked
              ? "border-foreground bg-foreground"
              : "border-muted-foreground/50 bg-transparent"
          )}
          aria-hidden="true"
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span
            className={cn(
              "text-xs font-semibold",
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
      {info && <span className="flex py-2.5 pr-2.5">{info}</span>}
    </div>
  )
}

export function PortfolioControls({
  settings,
  errors,
  onChange,
  onReset,
  universe,
  dirty,
  resolved,
  cappedNote,
  methods,
  onMethodsChange,
  methodCoverage,
  heldCount,
}: {
  settings: PortfolioSettings
  errors: SettingsErrors
  onChange: (next: PortfolioSettings) => void
  onReset: () => void
  /**
   * What the solve is over, in one place: how many were asked for, out of how
   * many, how many the solver kept and which it dropped.
   */
  universe: {
    /** Recognised tickers asked for; the index size for a full-index solve. */
    requested: number
    /** Stocks in the index, for the "N / total" readout. */
    indexSize: number
    screened: boolean
    /** Stocks the displayed solve ran over; null while it is the baseline. */
    solved: number | null
    excluded: string[]
  }
  /** These settings have not been solved yet. */
  dirty: boolean
  /**
   * What the last solve resolved the blank position bounds to, as percentages
   * ready to print. Absent before anything has been solved.
   */
  resolved: { minWeight?: string; maxWeight?: string }
  /** Set when the service solved fewer frontier points than asked for. */
  cappedNote?: string
  /** Models the implied excess return averages. Empty means all of them. */
  methods: MethodId[]
  onMethodsChange: (next: MethodId[]) => void
  /** How many of the held names each model could value. */
  methodCoverage: Record<MethodId, number>
  /** Holdings in the portfolio on screen, the denominator for the above. */
  heldCount: number
}) {
  const set = <K extends keyof PortfolioSettings>(
    key: K,
    value: PortfolioSettings[K]
  ) => onChange({ ...settings, [key]: value })

  const gamma = Number(settings.gamma) || 0
  const portfolios = Number(settings.portfolios) || 0
  const { requested, indexSize, screened, solved, excluded } = universe

  return (
    // A container, so the same groups stack in the 20rem rail and spread into
    // columns when the settings open as a section above the results.
    <div className="@container flex flex-col border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <span className="font-heading text-sm font-semibold">
          Optimiser settings
        </span>
        <Button variant="ghost" size="xs" onClick={onReset}>
          <RiCloseLine />
          Reset
        </Button>
      </div>

      {/* What the solve is over, stated once: asked for, out of how many, and
          how many the solver actually kept. These used to be split between
          this header ("503 / 503") and a separate "Solved with" panel
          ("Universe 492") with the exclusions under it. */}
      <div className="flex flex-col gap-1.5 border-b border-border px-6 py-4">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-3xl font-semibold tabular-nums">{requested}</span>
          <span className="text-sm text-muted-foreground">
            {screened
              ? `screened of ${indexSize} stocks`
              : `/ ${indexSize} stocks · full S&P 500`}
          </span>
        </p>
        {solved !== null && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-figure text-foreground tabular-nums">
              {solved} of {requested}
            </span>{" "}
            solved
            {excluded.length > 0 && (
              <>
                {" "}
                · {excluded.length} excluded for short price history:{" "}
                <span className="font-figure">{excluded.join(", ")}</span>
              </>
            )}
          </p>
        )}
        {dirty && (
          <span className="text-xs text-status-warning">
            Settings changed since this solve · run to apply
          </span>
        )}
      </div>

      <div className="grid gap-px bg-border @2xl:grid-cols-2 @5xl:grid-cols-4">
      <ControlGroup label="Position size">
        <div className="grid grid-cols-2 gap-4">
          <NumberField
            id="min-weight"
            label="Minimum"
            suffix="%"
            type="number"
            step="0.5"
            resolved={resolved.minWeight}
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
            resolved={resolved.maxWeight}
            value={settings.maxWeight}
            error={errors.maxWeight}
            onChange={(e) => set("maxWeight", e.target.value)}
          />
        </div>
        <ToggleRow
          checked={settings.shortAllowed}
          onChange={(next) => set("shortAllowed", next)}
          label="Allow short selling"
        />
      </ControlGroup>

      <ControlGroup label="Diversification">
        <SliderField
          id="gamma"
          label="L2 penalty (γ)"
          value={gamma}
          display={gamma.toFixed(2)}
          min={0}
          max={MAX_GAMMA}
          step={0.05}
          minLabel="0"
          maxLabel={String(MAX_GAMMA)}
          onChange={(value) => set("gamma", value)}
        />
      </ControlGroup>

      <ControlGroup label="Resolution">
        <SliderField
          id="n-portfolios"
          label="Frontier points"
          value={portfolios}
          display={String(portfolios)}
          min={MIN_PORTFOLIOS}
          max={MAX_PORTFOLIOS}
          step={1}
          minLabel={String(MIN_PORTFOLIOS)}
          maxLabel={String(MAX_PORTFOLIOS)}
          onChange={(value) => set("portfolios", value)}
        />
        {errors.portfolios && (
          <span className="text-xs text-destructive">{errors.portfolios}</span>
        )}
        {cappedNote && (
          <span className="text-xs leading-snug text-muted-foreground">
            {cappedNote}
          </span>
        )}
      </ControlGroup>

      {/* The only group here that is not a solver input. Everything above
          changes which portfolios exist and needs a re-run to take effect;
          this changes what the models say about the one on screen, and lands
          immediately — which is why it sits last, apart from the dials that
          need the button. */}
      <ControlGroup label="Valuation models">
        <span className="text-xs leading-snug text-muted-foreground">
          Which reverse-DCF models the weighted implied excess return
          averages. Applies at once; no re-run needed.
        </span>
        <div className="flex flex-col gap-1.5">
          {VALUATION_METHODS.map((method) => (
            <ToggleRow
              key={method.id}
              label={method.label}
              note={`Solves for ${methodCoverage[method.id] ?? 0} of ${heldCount} holdings`}
              info={<Info title={method.full}>{method.blurb}</Info>}
              checked={methods.length === 0 || methods.includes(method.id)}
              onChange={() => {
                // An empty selection means "all", so the first click has to
                // materialise that into a real list minus the one just turned
                // off, or nothing would appear to happen.
                const current =
                  methods.length === 0
                    ? VALUATION_METHODS.map((m) => m.id)
                    : methods
                const next = current.includes(method.id)
                  ? current.filter((id) => id !== method.id)
                  : [...current, method.id]
                // Switching the last one off would leave nothing to average.
                if (next.length === 0) return
                onMethodsChange(next)
              }}
            />
          ))}
        </div>
      </ControlGroup>
      </div>
    </div>
  )
}
