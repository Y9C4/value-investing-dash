"use client"

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

/**
 * The optimiser's constraint set, exposed.
 *
 * Not preferences: each changes the feasible set the solver searches. What each
 * one does is behind its info trigger rather than printed under the field — a
 * dial whose effect is invisible gets turned at random, but a paragraph under
 * every dial gets skipped and has the same result.
 */

function ControlGroup({
  title,
  info,
  children,
}: {
  title: string
  info: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2.5 border-border px-4 py-3 max-lg:border-b lg:border-r lg:last:border-r-0 max-lg:last:border-b-0">
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
        {info}
      </span>
      {children}
    </div>
  )
}

/**
 * Label above input rather than beside it. Labels in this app are uppercase
 * and letter-spaced, so a side-by-side row either wraps them onto two lines or
 * runs them into the field — both of which happened before this stacked.
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
      <div className="flex items-baseline gap-2">
        <Input
          id={id}
          inputMode="decimal"
          className="font-mono tabular-nums"
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

export function PortfolioControls({
  settings,
  errors,
  onChange,
  onRun,
  loading,
  universeSize,
}: {
  settings: PortfolioSettings
  errors: SettingsErrors
  onChange: (next: PortfolioSettings) => void
  onRun: () => void
  loading: boolean
  /** Screened stock count; 0 means the full index. */
  universeSize: number
}) {
  const set = <K extends keyof PortfolioSettings>(
    key: K,
    value: PortfolioSettings[K]
  ) => onChange({ ...settings, [key]: value })

  const blocked = Object.keys(errors).length > 0

  return (
    <section className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-4 py-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Optimiser settings
          </h2>
          <p className="flex items-center gap-1.5 text-sm">
            {universeSize > 0 ? (
              <>
                Solving over{" "}
                <span className="font-mono tabular-nums">{universeSize}</span>{" "}
                screened {universeSize === 1 ? "stock" : "stocks"}
              </>
            ) : (
              "Solving over the full index"
            )}
            <Info title="Scope of the solve">
              {universeSize > 0
                ? "The optimiser can only allocate within the set the screener handed over, so a stock the filters rejected cannot enter the portfolio at any weight."
                : "Nothing was handed over, so this solves across the whole index. Screen first to optimise over a filtered set — the optimiser estimates expected return from past return, so left to itself it favours whatever has already run up."}
            </Info>
          </p>
        </div>
        <Button onClick={onRun} disabled={loading || blocked}>
          {loading ? "Optimising…" : "Run optimisation"}
        </Button>
      </header>

      <div className="grid lg:grid-cols-3">
        <ControlGroup
          title="Position size"
          info={
            <Info title="Position size">
              Bounds on every weight. Leave blank to let the solver scale the
              cap to the universe &mdash; a 3% cap needs 34 names to add up to a
              whole portfolio. A negative minimum permits short positions down
              to that weight.
            </Info>
          }
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
          <label className="flex items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={settings.shortAllowed}
              onChange={(e) => set("shortAllowed", e.target.checked)}
            />
            Allow short selling
          </label>
        </ControlGroup>

        <ControlGroup
          title="Diversification"
          info={
            <Info title="Diversification">
              An L2 penalty on the weights. Without it the optimum sits on a
              corner of the feasible set, so most names come back at exactly
              zero and the rest at exactly the cap. &gamma; pushes the whole
              frontier off those corners &mdash; most visibly at its
              minimum-volatility end, where no return target is competing with
              it. Watch &ldquo;Eff. names&rdquo; in the anchor table.
            </Info>
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="gamma"
              label="L2 penalty"
              type="number"
              min={0}
              max={MAX_GAMMA}
              step="0.05"
              value={settings.gamma}
              error={errors.gamma}
              onChange={(e) => set("gamma", e.target.value)}
            />
          </div>
          <input
            type="range"
            aria-label="L2 penalty gamma"
            min={0}
            max={MAX_GAMMA}
            step={0.05}
            value={Number(settings.gamma) || 0}
            onChange={(e) => set("gamma", e.target.value)}
            className="w-full accent-primary"
          />
        </ControlGroup>

        <ControlGroup
          title="Resolution"
          info={
            <Info title="Resolution" side="left">
              How many portfolios are solved along the frontier. Each is a
              separate optimisation, so this is the setting that decides how
              long the run takes &mdash; {MIN_PORTFOLIOS} to {MAX_PORTFOLIOS}.
            </Info>
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="n-portfolios"
              label="Portfolios"
              type="number"
              min={MIN_PORTFOLIOS}
              max={MAX_PORTFOLIOS}
              value={settings.portfolios}
              error={errors.portfolios}
              onChange={(e) => set("portfolios", e.target.value)}
            />
          </div>
        </ControlGroup>
      </div>
    </section>
  )
}
