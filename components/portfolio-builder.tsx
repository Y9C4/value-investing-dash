"use client"

import { useEffect, useRef, useState } from "react"
import {
  RiDownloadLine,
  RiEqualizerLine,
  RiPlayLine,
  RiRefreshLine,
} from "@remixicon/react"

import {
  FrontierChart,
  LegendDot,
  SharpeCurve,
  hasTangency,
} from "@/components/efficient-frontier"
import {
  HoldingsChart,
  HoldingsTable,
  SectorExposure,
} from "@/components/portfolio-composition"
import { PortfolioControls } from "@/components/portfolio-controls"
import { Button } from "@/components/ui/button"
import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelMeta,
  PanelTitle,
  Stat,
  StatStrip,
} from "@/components/ui/panel"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  BASELINE_FRONTIER,
  type FrontierResponse,
} from "@/lib/baseline-frontier"
import { formatPercent } from "@/lib/format"
import {
  readSolve,
  scopeKey,
  writeSolve,
  type CachedSolve,
} from "@/lib/portfolio-cache"
import { downloadPortfolioCsv } from "@/lib/portfolio-export"
import {
  DEFAULT_SETTINGS,
  effectiveHoldings,
  buildFrontierRequest,
  validateSettings,
  type PortfolioSettings,
} from "@/lib/portfolio-settings"
import { useScrollPane } from "@/lib/use-scroll-pane"
import { cn } from "@/lib/utils"

/**
 * The portfolio workspace: the constraints that shape a solve on the left,
 * everything the solve produced on the right.
 *
 * Two panes, the same shape as the screener: constraints beside results,
 * results owning the width. Every number here is downstream of a constraint
 * set, so the constraints are stated next to the result rather than buried in
 * a service. A frontier with no stated constraints is not a claim about
 * anything.
 *
 * A solve survives navigation. It is five to twenty seconds of real work, and
 * looking up a holding and coming back used to throw it away and reinstate the
 * illustrative baseline, which is both the most likely thing a reader does
 * and the worst moment to show them a curve that is not theirs. See
 * `lib/portfolio-cache.ts`.
 */

/**
 * The width at which the rail and the result panels both fit.
 *
 * Narrower than the screener's 1700, because the results here are charts that
 * reflow rather than a table with a fixed natural width. Below it the rail
 * starts collapsed and the toolbar button opens it.
 */
const RAIL_BREAKPOINT = 1280

function ConstraintRow({
  label,
  value,
  note,
}: {
  label: string
  value: string
  /** Reserved for a value the reader did not ask for and would misread. */
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-1.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </div>
      {note && (
        <span className="text-xs leading-snug text-muted-foreground">
          {note}
        </span>
      )}
    </div>
  )
}

/**
 * What the solver was actually given, beside the dials that asked for it.
 *
 * Every row here used to carry a sentence explaining itself, and the position
 * bounds were stated here rather than on the controls that set them — so the
 * reader who left "auto" in the box had to look somewhere else to find out
 * what auto had resolved to. The bounds now print as the placeholders of their
 * own fields, and what is left is a plain ledger of the solve.
 *
 * A note survives only where the service answered a different question from
 * the one asked: a capped resolution, a name dropped for short history.
 */
function ConstraintsPanel({
  data,
  tickers,
  isBaseline,
}: {
  data: FrontierResponse
  tickers: string[]
  isBaseline: boolean
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Solved with</PanelTitle>
        {isBaseline && <PanelMeta>Baseline</PanelMeta>}
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3 py-1">
        <div className="flex flex-col">
          <ConstraintRow
            label="Universe"
            value={
              typeof data.n_assets === "number"
                ? String(data.n_assets)
                : tickers.length > 0
                  ? String(tickers.length)
                  : "—"
            }
          />
          <ConstraintRow
            label="Shorting"
            value={data.short_allowed ? "Allowed" : "None"}
          />
          <ConstraintRow
            label="L2 penalty (γ)"
            value={(data.l2_gamma ?? 0).toFixed(2)}
          />
          <ConstraintRow
            label="Frontier points"
            value={String(data.n_portfolios)}
            note={
              data.resolution_capped
                ? `Cut from ${data.n_portfolios_requested}: every point is its own solve over ${data.n_assets ?? 0} stocks.`
                : undefined
            }
          />
        </div>

        {data.excluded_short_history &&
          data.excluded_short_history.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Excluded for short price history:{" "}
              <span className="font-mono">
                {data.excluded_short_history.join(", ")}
              </span>
            </p>
          )}
      </PanelBody>
    </Panel>
  )
}

export function PortfolioBuilder({
  tickers = [],
  staleSet = false,
}: {
  /** A screened subset handed over by the screener; empty means the full index. */
  tickers?: string[]
  /** The `?set=` token was built against a different index and cannot be read. */
  staleSet?: boolean
}) {
  const [settings, setSettings] = useState<PortfolioSettings>(DEFAULT_SETTINGS)
  // Seeded so the page is never blank: the baseline renders instantly and is
  // replaced the moment a live solve returns or a cached one is restored.
  const [data, setData] = useState<FrontierResponse>(BASELINE_FRONTIER)
  const [isBaseline, setIsBaseline] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Seconds the current solve has been running, for the progress readout. */
  const [elapsed, setElapsed] = useState(0)
  /** When the displayed solve was produced. Null while it is the baseline. */
  const [solvedAt, setSolvedAt] = useState<number | null>(null)
  /** The settings the displayed solve was produced under. */
  const [solvedSettings, setSolvedSettings] =
    useState<PortfolioSettings | null>(null)

  /**
   * Null while the rail's visibility is still whatever CSS chose for this
   * viewport, which is what keeps the first paint free of a layout flash on a
   * wide screen. The first toggle reads the width once and takes over.
   */
  const [railOpen, setRailOpen] = useState<boolean | null>(null)
  const { ref: railRef, maxHeight: railMaxHeight } =
    useScrollPane<HTMLDivElement>()

  const errors = validateSettings(settings)
  const scope = scopeKey(tickers)
  // Read once on mount, before the first solve can overwrite it.
  const restored = useRef(false)

  /**
   * Bring back this tab's last solve.
   *
   * An effect rather than a `useState` initialiser: `sessionStorage` does not
   * exist during the server render, and seeding state from it would make the
   * first client render disagree with the HTML that was sent.
   *
   * Settings are restored whatever the scope: they are the reader's
   * preferences and travel. The solved frontier is restored only onto the
   * universe it was solved for, because a frontier over 32 screened names is
   * not a frontier over the index and showing one under the other's heading
   * would be a false claim.
   *
   * Failing both, arriving from the screener starts a solve straight away.
   * A screened set is a request: someone picked 32 names and pressed
   * "optimise", so answering it with the shipped baseline and a button is
   * making them ask twice. A bare `/portfolio` visit is not a request, so it
   * keeps the baseline: it is the browsing entry point, and it must not spend
   * solver time on someone who came to look.
   *
   * The rule below fires on any setState in an effect body, on the grounds
   * that it cascades a render. That is exactly what is wanted once, on mount,
   * to hydrate state from a browser store that does not exist on the server,
   * and the ref guard is what keeps it to once.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (restored.current) return
    restored.current = true

    const cached: CachedSolve | null = readSolve()
    if (cached) {
      setSettings(cached.settings)

      if (cached.scope === scope) {
        setData(cached.data)
        setIsBaseline(false)
        setSolvedAt(cached.savedAt)
        setSolvedSettings(cached.settings)
        return
      }
    }

    // Settings are passed explicitly rather than read from state: the setter
    // above has not landed yet, and the solve has to go out under the settings
    // the page is about to show.
    if (tickers.length > 0) {
      void runSolve(cached?.settings ?? DEFAULT_SETTINGS)
    }
    // `runSolve` is deliberately not a dependency. It closes over state that
    // changes on every keystroke in the rail, and this effect must run exactly
    // once: the ref above is the guard, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, tickers.length])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    )
    return () => clearInterval(timer)
  }, [loading])

  /**
   * One solve, under the settings it is handed.
   *
   * Explicit rather than closed over `settings`, because the restore effect
   * runs a solve in the same tick it seeds them and would otherwise send the
   * previous render's values.
   */
  async function runSolve(next: PortfolioSettings) {
    if (Object.keys(validateSettings(next)).length > 0) return

    setLoading(true)
    setError(null)
    setElapsed(0)

    try {
      const { query, init } = buildFrontierRequest(next, tickers)
      const res = await fetch(`/api/efficient-frontier?${query}`, init)

      // 431 never reaches the optimiser, so it must not be reported as one
      // failing. It means this browser's headers are too large for the server,
      // usually cookies piled up on localhost, and it is the reader's browser
      // state rather than anything about their settings.
      if (res.status === 431) {
        throw new Error(
          "The request headers were too large for the dev server (HTTP 431). " +
            "The optimiser was never reached. This is almost always cookies " +
            "accumulated on localhost. Clear them for this site and retry.",
        )
      }

      // A framework error page is HTML, not JSON. Parsing it unguarded threw
      // an unreadable SyntaxError over whatever actually went wrong.
      const raw = await res.text()
      let body: { detail?: string } | null = null
      try {
        body = JSON.parse(raw)
      } catch {
        throw new Error(
          `The optimiser returned an unreadable response (HTTP ${res.status}).`,
        )
      }

      if (!res.ok) {
        throw new Error(
          body?.detail ?? "Failed to build the efficient frontier",
        )
      }

      const solved = body as unknown as FrontierResponse
      const savedAt = Date.now()

      setData(solved)
      setIsBaseline(false)
      setSolvedAt(savedAt)
      setSolvedSettings(next)
      writeSolve({ scope, settings: next, data: solved, savedAt })
    } catch (err) {
      // Keep the previous render on screen rather than dropping to a blank
      // frame: the error line says what happened.
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  const tangency = data.max_sharpe
  const heldCount = Object.keys(tangency.weights).length
  const effective = effectiveHoldings(tangency.weights)
  const largest = Math.max(
    0,
    ...Object.values(tangency.weights).map((weight) => Math.abs(weight)),
  )
  const sectors = data.sectors ?? {}

  /**
   * The bounds the solve on screen actually ran under, as the placeholders for
   * the fields that were left blank.
   *
   * Withheld while the curve is the shipped baseline: those are the baseline's
   * constraints, and printing them into a live control would be stating a
   * number this reader's universe never produced. The baseline response simply
   * omits both fields, so this falls through to the plain "auto".
   */
  const asPercentInput = (value: number | undefined) =>
    typeof value === "number" ? (value * 100).toFixed(2) : undefined
  const resolvedBounds = {
    minWeight: asPercentInput(data.min_stock_weight),
    maxWeight: asPercentInput(data.max_stock_weight),
  }

  // Settings that have been changed since the solve on screen was produced.
  // Without this the page silently shows a frontier that no longer matches the
  // dials beside it, which is the one way a control panel can lie.
  const dirty =
    solvedSettings !== null &&
    JSON.stringify(solvedSettings) !== JSON.stringify(settings)

  const anchors = [
    {
      key: "maxSharpe" as const,
      title: "Max Sharpe",
      portfolio: data.max_sharpe,
    },
    {
      key: "minVolatility" as const,
      title: "Min volatility",
      portfolio: data.min_volatility,
    },
  ]

  return (
    <div
      className={cn(
        "grid gap-6",
        railOpen === null
          ? "min-[1280px]:grid-cols-[20rem_minmax(0,1fr)]"
          : railOpen
            ? "lg:grid-cols-[20rem_minmax(0,1fr)]"
            : undefined,
      )}
    >
      <div
        id="optimiser-settings"
        ref={railRef}
        style={railMaxHeight ? { maxHeight: railMaxHeight } : undefined}
        className={cn(
          // Sticky and self-start: the results column is several screens tall
          // and the rail is not, so without this the controls scroll away and
          // the reader is left with a column of nothing beside the charts.
          "flex-col gap-4 overflow-y-auto lg:sticky lg:top-5 lg:max-h-[calc(100vh-8rem)] lg:self-start",
          railOpen === null
            ? "hidden min-[1280px]:flex"
            : railOpen
              ? "flex"
              : "hidden",
        )}
      >
        <PortfolioControls
          settings={settings}
          errors={errors}
          onChange={setSettings}
          onReset={() => setSettings(DEFAULT_SETTINGS)}
          universeSize={tickers.length}
          dirty={dirty}
          resolved={resolvedBounds}
        />

        <ConstraintsPanel data={data} tickers={tickers} isBaseline={isBaseline} />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* A link the screener built against a different index. It cannot be
            decoded back to the set it promised, so the scope silently widens to
            the whole index unless that is said out loud. */}
        {staleSet && (
          <p
            role="status"
            className="border border-border bg-card px-4 py-2.5 text-sm"
          >
            That screener link points at an older version of the index and
            can&rsquo;t be read back. Optimising over the full index; run the
            screen again for a fresh link.
          </p>
        )}

        {/* The action bar. It sits above the chart it changes and stays on
            screen while the rail scrolls, which is why the run button is not
            in the rail with the dials it applies. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              aria-controls="optimiser-settings"
              aria-expanded={railOpen ?? undefined}
              onClick={() =>
                setRailOpen((current) =>
                  // The first press flips whatever the viewport chose; every
                  // press after that flips the state this component owns.
                  current === null
                    ? !(window.innerWidth >= RAIL_BREAKPOINT)
                    : !current,
                )
              }
            >
              <RiEqualizerLine />
              Settings
            </Button>

            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {tickers.length > 0
                ? `${tickers.length} screened ${tickers.length === 1 ? "name" : "names"}`
                : "Full index"}
              {isBaseline
                ? " · illustrative baseline"
                : solvedAt
                  ? ` · solved ${new Date(solvedAt).toLocaleTimeString(
                      "en-GB",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}`
                  : ""}
              {dirty && " · settings changed"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadPortfolioCsv({
                  data,
                  isBaseline,
                  screenedCount: tickers.length,
                })
              }
            >
              <RiDownloadLine />
              Export
            </Button>

            <Button
              size="sm"
              onClick={() => runSolve(settings)}
              disabled={loading || Object.keys(errors).length > 0}
            >
              {loading ? <RiRefreshLine /> : <RiPlayLine />}
              {loading
                ? `Optimising… ${elapsed}s`
                : isBaseline
                  ? "Run optimisation"
                  : "Re-run"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex flex-col gap-1 border border-destructive/40 bg-destructive/5 px-4 py-3">
            <span className="text-xs font-semibold tracking-widest text-destructive uppercase">
              Not optimised
            </span>
            <p className="text-sm text-destructive">{error}</p>
            {/* Without this the red line sits directly above a perfectly
                plausible curve, and the curve is the thing people believe. */}
            <p className="text-xs text-muted-foreground">
              {isBaseline
                ? "Everything below is still the illustrative baseline, not a result for this set."
                : "Everything below is the previous successful solve, not a result for this set."}
            </p>
          </div>
        )}

        {/* Everything below is a reading of the solve on screen. While a new
            one is in flight this is still the previous solve (or the shipped
            baseline) rather than a blank page, and dimming the whole block
            uniformly is what marks it as about to be replaced — the toolbar
            above it, which says so in words and stays interactive, is
            deliberately outside this wrapper and stays at full opacity. */}
        <div
          className={cn(
            "flex flex-col gap-4 transition-opacity",
            loading && "opacity-50"
          )}
        >
        {/* Every readout from here down describes one point on the frontier
            rather than the frontier, and nothing on the page used to say
            which. The header names it once; the composition panels repeat it
            in their own meta, because a reader who scrolls past this strip
            would otherwise have no way to tell.

            One strip, hairline-divided, rather than six bordered tiles: six
            boxes is six borders saying nothing, and this is the row a reader
            scans left to right. Six readings of equal standing, so six figures
            at one size — Sharpe used to be set two steps larger, which made
            the row read as one headline with five captions rather than as an
            instrument panel. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-b-0 border-border bg-card px-4 py-2">
          <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Max Sharpe portfolio
          </h2>
          <span className="font-mono text-xs text-muted-foreground tabular-figures">
            {heldCount} {heldCount === 1 ? "position" : "positions"}
          </span>
        </div>

        <StatStrip className="border-t-0">
          <Stat
            label="Sharpe"
            value={tangency.sharpe.toFixed(2)}
            hint={hasTangency(data) ? undefined : "Negative: nothing beat cash"}
          />
          <Stat
            label="Expected return"
            value={formatPercent(tangency.return)}
            hint="Annualised"
          />
          <Stat
            label="Volatility"
            value={formatPercent(tangency.volatility)}
            hint="Annualised"
          />
          <Stat
            label="Effective holdings"
            value={effective.toFixed(1)}
            hint={`Of ${heldCount} held`}
          />
          <Stat
            label="Largest position"
            value={formatPercent(largest)}
            hint={
              typeof data.max_stock_weight === "number"
                ? `Cap ${formatPercent(data.max_stock_weight)}`
                : undefined
            }
          />
          <Stat
            label="Risk-free rate"
            value={formatPercent(data.risk_free_rate)}
            hint="13-week T-bill"
          />
        </StatStrip>

        <FrontierChart
          data={data}
          isBaseline={isBaseline}
          loading={loading}
          solving={{
            portfolios: Number(settings.portfolios) || 0,
            // The screened set when there is one; otherwise whatever the last
            // solve reported, which is the full index.
            assets: tickers.length || data.n_assets || 0,
            seconds: elapsed,
          }}
        />

        {/* Full width, not a column. Five numeric columns plus the portfolio
            name need about 470px, and a half-width panel gives them 290px at
            1280 and 450px at 1600: the table was scrolling its own last two
            columns out of sight at every width below 1920. */}
        <Panel>
          <PanelHeader>
            <PanelTitle>Anchor portfolios</PanelTitle>
            <PanelMeta>The two ends of the curve</PanelMeta>
          </PanelHeader>
          <PanelBody className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Portfolio</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right">Volatility</TableHead>
                  <TableHead className="text-right">Sharpe</TableHead>
                  <TableHead className="text-right">
                    Eff. names
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.map(({ key, title, portfolio }) => (
                  <TableRow key={key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {/* The same two marks the chart plots, so the row and
                            the point on the curve are visibly one thing. */}
                        <LegendDot hollow={key !== "maxSharpe"} />
                        {title}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(portfolio.return)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatPercent(portfolio.volatility)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {portfolio.sharpe.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {effectiveHoldings(portfolio.weights).toFixed(1)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">
                    Risk-free rate
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatPercent(data.risk_free_rate)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </PanelBody>
        </Panel>

        {/* Two columns of stacked panels rather than a grid of rows. A row
            grid aligns its cells at the top and leaves the shorter one
            trailing dead space to the next row, which is what the page did,
            with a 160px hole under every short panel. Distributing the panels
            between two columns instead lets them be balanced by height, so
            both columns end at about the same place. */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <SharpeCurve data={data} isBaseline={isBaseline} />

            {Object.keys(sectors).length > 0 ? (
              <SectorExposure
                portfolio={tangency}
                sectors={sectors}
                scope="Max Sharpe"
              />
            ) : (
              <Panel>
                <PanelHeader>
                  <PanelTitle>Sector exposure</PanelTitle>
                </PanelHeader>
                <PanelBody>
                  <p className="text-sm text-muted-foreground">
                    {isBaseline
                      ? "Run the optimisation to see the sector split."
                      : "No sector labels on file for these holdings."}
                  </p>
                </PanelBody>
              </Panel>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <HoldingsChart
              portfolio={tangency}
              sectors={sectors}
              scope="Max Sharpe"
            />
          </div>
        </div>

        <HoldingsTable
          portfolio={tangency}
          sectors={sectors}
          scope="Max Sharpe"
        />
        </div>
      </div>
    </div>
  )
}
