"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  RiDownloadLine,
  RiEqualizerLine,
  RiPlayLine,
  RiRefreshLine,
} from "@remixicon/react"

import {
  FrontierChart,
  SharpeCurve,
} from "@/components/efficient-frontier"
import {
  HoldingsChart,
  HoldingsTable,
  SectorExposure,
} from "@/components/portfolio-composition"
import { PortfolioControls } from "@/components/portfolio-controls"
import { PortfolioList } from "@/components/portfolio-list"
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
  BASELINE_FRONTIER,
  type FrontierResponse,
} from "@/lib/baseline-frontier"
import {
  DASH,
  formatAxisPercent,
  formatDataTimestamp,
  formatPercent,
  formatPp,
  formatSharpeDelta,
} from "@/lib/format"
import {
  methodAlpha,
  portfolioConsensus,
  VALUATION_METHODS,
  gapTextClass,
  type MethodId,
  type Valued,
} from "@/lib/valuation"
import {
  readSolve,
  scopeKey,
  writeSolve,
  type CachedSolve,
} from "@/lib/portfolio-cache"
import { downloadPortfolioCsv } from "@/lib/portfolio-export"
import {
  MAX_SHARPE,
  resolvePortfolio,
  selectionLabel,
  type SelectedPortfolio,
} from "@/lib/portfolio-selection"
import {
  DEFAULT_SETTINGS,
  MIN_FRONTIER_TICKERS,
  buildFrontierRequest,
  validateSettings,
  type PortfolioSettings,
} from "@/lib/portfolio-settings"
import { useScrollPane } from "@/lib/use-scroll-pane"
import { cn } from "@/lib/utils"

/**
 * The portfolio workspace: the constraints that shape a solve, and everything
 * the solve produced, with the frontier as the hero.
 *
 * Constraints beside the results where both fit (the screener's shape), above
 * them where they do not. Every number here is downstream of a constraint set,
 * so the constraints are stated next to the result rather than buried in a
 * service.
 *
 * A solve survives navigation. It is five to twenty seconds of real work, and
 * looking up a holding and coming back used to throw it away and reinstate the
 * illustrative baseline, which is both the most likely thing a reader does
 * and the worst moment to show them a curve that is not theirs. See
 * `lib/portfolio-cache.ts`.
 */

/**
 * The viewport width at which the rail and a wide results column both fit:
 * the screener's breakpoint. Below it the settings are a section above the
 * results, collapsed until the toolbar button opens them, so the frontier is
 * never squeezed into a sliver beside a 20rem rail.
 */
const RAIL_BREAKPOINT = 1700

/** Where the frontier on screen came from; the toolbar states it. */
type Source = "baseline" | "nightly" | "solved" | "restored"

export function PortfolioBuilder({
  tickers = [],
  unknownTickers = [],
  staleSet = false,
  stocks = [],
  snapshot = null,
}: {
  /**
   * The scheduled full-index solve under default settings, read on the server
   * from `frontier_snapshot`. Shown for a bare `/portfolio` visit instead of
   * the illustrative baseline; null when it has not been computed yet.
   */
  snapshot?: { data: FrontierResponse; computedAt: string } | null
  /** The recognised tickers of a screened subset; empty means the full index. */
  tickers?: string[]
  /** Tickers the URL named that the index does not hold. Listed, never solved. */
  unknownTickers?: string[]
  /** The `?set=` token was built against a different index and cannot be read. */
  staleSet?: boolean
  /**
   * The scored universe, for the consensus readout. Handed down from the
   * server render rather than fetched here: it is the same snapshot the
   * screener already reads, and the portfolio page has no business asking for
   * it twice.
   */
  stocks?: (Valued & { ticker: string })[]
}) {
  // A screen was asked for, even if none of its names were recognised: a URL
  // of unknown tickers must not quietly widen to the whole index.
  const screened = tickers.length > 0 || unknownTickers.length > 0
  // Below this the service answers 422, so the page says so before asking.
  const tooFew = screened && tickers.length < MIN_FRONTIER_TICKERS

  const [settings, setSettings] = useState<PortfolioSettings>(DEFAULT_SETTINGS)
  // Seeded so the page is never blank: the nightly solve (or, failing that,
  // the baseline) renders instantly and is replaced the moment a live solve
  // returns or a cached one is restored.
  const seed = screened ? null : snapshot
  const [data, setData] = useState<FrontierResponse>(seed?.data ?? BASELINE_FRONTIER)
  const [source, setSource] = useState<Source>(seed ? "nightly" : "baseline")
  const isBaseline = source === "baseline"
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Seconds the current solve has been running, for the progress readout. */
  const [elapsed, setElapsed] = useState(0)
  /** When the displayed solve was produced. Null while it is the baseline. */
  const [solvedAt, setSolvedAt] = useState<number | null>(
    seed ? Date.parse(seed.computedAt) : null
  )
  /** The settings the displayed solve was produced under. */
  const [solvedSettings, setSolvedSettings] =
    useState<PortfolioSettings | null>(seed ? DEFAULT_SETTINGS : null)
  /**
   * Which portfolio on the curve every panel below is describing.
   *
   * The tangency to begin with, and again after every solve: envelope indices
   * are positions in one particular curve, so carrying "point 7" across a
   * re-run at a different resolution would silently rename whichever portfolio
   * happened to land there.
   */
  const [selected, setSelected] = useState<SelectedPortfolio>(MAX_SHARPE)
  /**
   * Which models the implied excess return averages. Empty means all of them, the
   * same reading the screener's rail uses.
   *
   * Not part of `PortfolioSettings`: those are solver inputs and changing one
   * makes the curve on screen stale, which is what the "settings changed"
   * warning is about. This changes nothing the solver did — it re-reads the
   * implied returns already in the payload — so it must not mark anything dirty.
   */
  const [methods, setMethods] = useState<MethodId[]>([])

  /**
   * Null while the rail's visibility is still whatever CSS chose for this
   * viewport, which is what keeps the first paint free of a layout flash on a
   * wide screen. The first toggle reads the width once and takes over.
   */
  const [railOpen, setRailOpen] = useState<boolean | null>(null)
  const { ref: railRef, maxHeight: railMaxHeight } = useScrollPane<HTMLDivElement>({
    from: RAIL_BREAKPOINT,
  })

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
   * universe it was solved for, and only if it is newer than the nightly
   * snapshot the server rendered — otherwise yesterday's tab would cover
   * today's solve.
   *
   * Failing both, arriving from the screener starts a solve straight away.
   * A screened set is a request: someone picked 32 names and pressed
   * "optimise", so answering it with a button is making them ask twice. A
   * bare `/portfolio` visit is not a request: it keeps the nightly solve and
   * must not spend solver time on someone who came to look.
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

      const newerThanSeed = !seed || cached.savedAt >= Date.parse(seed.computedAt)
      if (cached.scope === scope && !tooFew && newerThanSeed) {
        setData(cached.data)
        setSource("restored")
        setSolvedAt(cached.savedAt)
        setSolvedSettings(cached.settings)
        // Absent on entries written before the curve was selectable, and
        // `resolvePortfolio` falls back on its own for an index this solve no
        // longer has — so nothing here has to validate it.
        if (cached.selected) setSelected(cached.selected)
        return
      }
    }

    // Settings are passed explicitly rather than read from state: the setter
    // above has not landed yet, and the solve has to go out under the settings
    // the page is about to show.
    if (screened && !tooFew) {
      void runSolve(cached?.settings ?? DEFAULT_SETTINGS)
    }
    // `runSolve` is deliberately not a dependency. It closes over state that
    // changes on every keystroke in the rail, and this effect must run exactly
    // once: the ref above is the guard, and the page keys this component by
    // scope, so a new scope is a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
    if (tooFew || Object.keys(validateSettings(next)).length > 0) return

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
          "Your browser sent request headers too large for the server " +
          "(HTTP 431), so the optimiser was never reached. Clearing this " +
          "site's cookies usually fixes it.",
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
      setSource("solved")
      setSolvedAt(savedAt)
      setSolvedSettings(next)
      // A new curve is a new set of portfolios, so the page reopens on the one
      // it defaults to rather than on whichever index the last curve had
      // selected — that index means something different here, or nothing.
      setSelected(MAX_SHARPE)
      writeSolve({
        scope,
        settings: next,
        data: solved,
        savedAt,
        selected: MAX_SHARPE,
      })
    } catch (err) {
      // A previous solve for this set stays on screen under a disclaimer; with
      // none, the page shows an explicit empty state rather than the baseline.
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  /**
   * Move the page to another portfolio on the curve.
   *
   * The cache is rewritten so the choice survives looking up a holding and
   * coming back, which is the same journey the solve itself is kept for. Only
   * a real solve is worth storing: the baseline is reinstated on load anyway,
   * and writing it would overwrite a solve for a different scope.
   */
  function selectPortfolio(next: SelectedPortfolio) {
    setSelected(next)
    if (isBaseline || solvedAt === null) return
    writeSolve({
      scope,
      settings: solvedSettings ?? settings,
      data,
      savedAt: solvedAt,
      selected: next,
    })
  }

  // The portfolio every panel below this point describes. The tangency by
  // default and after every solve, but any point on the curve once the reader
  // picks one — the whole page is a reading of this one object.
  const active = resolvePortfolio(data, selected)
  const activeLabel = selectionLabel(data, selected)
  // Built once from a prop that arrives whole from the server, so this is a
  // memo against re-renders rather than against real work.
  const stocksByTicker = useMemo(
    () => new Map(stocks.map((stock) => [stock.ticker, stock])),
    [stocks]
  )

  // A weighted sum over at most a few hundred holdings — microseconds, and no
  // network call: every model's implied return is already in the payload. The
  // memo keeps it off the render path when only the rail moved.
  const consensus = useMemo(
    () => portfolioConsensus(active.weights, stocksByTicker, methods),
    [active.weights, stocksByTicker, methods]
  )

  // How many of *these* holdings each model could solve for — the screener counts
  // the same thing over the whole index, but the question here is what the
  // portfolio on screen rests on.
  const methodCoverage = useMemo(() => {
    const counts = Object.fromEntries(
      VALUATION_METHODS.map((method) => [method.id, 0])
    ) as Record<MethodId, number>

    for (const ticker of Object.keys(active.weights)) {
      const stock = stocksByTicker.get(ticker)
      if (!stock) continue
      for (const method of VALUATION_METHODS) {
        if (methodAlpha(stock, method.id) !== null) counts[method.id] += 1
      }
    }
    return counts
  }, [active.weights, stocksByTicker])

  const heldCount = Object.keys(active.weights).length
  const sectors = data.sectors ?? {}

  // Absent when the index had no usable price history for the window. Every
  // reading below that compares against it is then dropped rather than shown
  // against a zero: "+15.7 pp vs S&P 500" with no S&P behind it is a
  // fabricated comparison, and the figure itself is still worth printing.
  const market = data.market

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

  // The illustrative baseline is only ever an illustration of the bare index
  // page. Under a screen, or under an error, it would read as the reader's own
  // portfolio, so an explicit empty state takes its place.
  const showResults = !isBaseline || (!screened && !error)

  const runBlocked = tooFew
    ? `A frontier needs at least ${MIN_FRONTIER_TICKERS} recognised tickers; this set has ${tickers.length}.`
    : Object.keys(errors).length > 0
      ? "Fix the settings marked in red to run."
      : null

  const solving = `Solving ${Number(settings.portfolios) || 0} portfolios over ${tickers.length || data.n_assets || stocks.length} stocks · ${elapsed}s`
  const stamp = solvedAt === null ? "" : formatDataTimestamp(new Date(solvedAt).toISOString())
  // Live, nightly or restored is the one thing a reader cannot tell from the
  // curve itself, so it is said once, here, with the shared as-of format.
  const provenance = loading
    ? solving
    : source === "baseline"
      ? screened
        ? "not solved yet"
        : "illustrative example, not solved"
      : source === "nightly"
        ? `nightly solve · ${stamp}`
        : source === "restored"
          ? `solved ${stamp} · kept from earlier in this tab`
          : data.cached
            ? `retrieved ${stamp} · the solver's cached result`
            : `solved ${stamp}`

  return (
    <div className="flex flex-col gap-4">
      {/* The action bar, above both the settings and the results, so opening
          the settings never moves the button that opened them. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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

            {/* Fixed-zone stamps, but ICU builds can still disagree on a
                zone's abbreviation between server and browser. */}
            <span
              suppressHydrationWarning
              className="font-mono text-xs text-muted-foreground tabular-nums"
            >
              {screened
                ? `${tickers.length} screened ${tickers.length === 1 ? "stock" : "stocks"}`
                : "Full S&P 500"}
              {" · "}
              {provenance}
              {dirty && " · settings changed"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={!showResults}
              onClick={() =>
                downloadPortfolioCsv({
                  data,
                  isBaseline,
                  screenedCount: tickers.length,
                  solvedAt,
                  selected:
                    selected.kind === "envelope"
                      ? { label: activeLabel, portfolio: active }
                      : undefined,
                })
              }
            >
              <RiDownloadLine />
              Export
            </Button>

            <Button
              size="sm"
              onClick={() => runSolve(settings)}
              disabled={loading || runBlocked !== null}
              aria-describedby={runBlocked ? "run-blocked" : undefined}
            >
              {loading ? <RiRefreshLine /> : <RiPlayLine />}
              {loading ? `Optimising… ${elapsed}s` : "Run optimisation"}
            </Button>
          </div>
        </div>

        {runBlocked && (
          <p id="run-blocked" className="text-xs text-muted-foreground sm:text-right">
            {runBlocked}
          </p>
        )}
      </div>

      {/* A link the screener built against a different index. It cannot be
          decoded back to the set it promised, so the scope silently widens to
          the whole index unless that is said out loud. */}
      {staleSet && (
        <p role="status" className="border border-border bg-card px-4 py-2.5 text-sm">
          That screener link points at an older version of the index and
          can&rsquo;t be read back. Optimising over the full index; run the
          screen again for a fresh link.
        </p>
      )}

      {unknownTickers.length > 0 && (
        <p role="status" className="border border-border bg-card px-4 py-2.5 text-sm">
          Not in the S&amp;P 500 dataset, so left out:{" "}
          <span className="font-mono">{unknownTickers.join(", ")}</span>
        </p>
      )}

      <div
        className={cn(
          "grid gap-6",
          railOpen !== false && "min-[1700px]:grid-cols-[20rem_minmax(0,1fr)]",
        )}
      >
        {/* A rail beside the results where both fit; below that, a section
            above them that the Settings button opens. */}
        <div
          id="optimiser-settings"
          ref={railRef}
          style={railMaxHeight ? { maxHeight: railMaxHeight } : undefined}
          className={cn(
            // Sticky: the results are several screens tall and the rail is
            // not, so without this the controls scroll away.
            "flex-col min-[1700px]:sticky min-[1700px]:top-5 min-[1700px]:max-h-[calc(100vh-8rem)] min-[1700px]:self-start min-[1700px]:overflow-y-auto",
            railOpen === null
              ? "hidden min-[1700px]:flex"
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
            universe={{
              requested: screened ? tickers.length : stocks.length,
              indexSize: stocks.length,
              screened,
              solved: isBaseline ? null : (data.n_assets ?? null),
              excluded: isBaseline ? [] : (data.excluded_short_history ?? []),
            }}
            dirty={dirty}
            resolved={resolvedBounds}
            cappedNote={
              !isBaseline && data.resolution_capped
                ? `Cut to ${data.n_portfolios} from ${data.n_portfolios_requested}: every point is its own solve over ${data.n_assets ?? 0} stocks.`
                : undefined
            }
            methods={methods}
            onMethodsChange={setMethods}
            methodCoverage={methodCoverage}
            heldCount={heldCount}
          />
        </div>

        {/* A container, so the results lay out by their own width — which
            depends on whether the rail is open — not by the viewport's. */}
        <div className="@container flex min-w-0 flex-col gap-4">
          {error && (
            <div className="flex flex-col gap-1 border border-destructive/40 bg-destructive/5 px-4 py-3">
              <span className="text-xs font-semibold text-destructive">
                Not optimised
              </span>
              <p className="text-sm text-destructive">{error}</p>
              {/* Without this the red line sits directly above a perfectly
                  plausible curve, and the curve is the thing people believe. */}
              {showResults && (
                <p className="text-xs text-muted-foreground">
                  Everything below is the previous successful solve, not a
                  result for these settings.
                </p>
              )}
            </div>
          )}

          {showResults ? (
            // While a new solve is in flight this is still the previous one,
            // dimmed uniformly to mark it as about to be replaced.
            <div
              className={cn(
                "flex flex-col gap-4 transition-opacity",
                loading && "opacity-50",
              )}
            >
              {/* Every readout from here down describes one point on the
                  frontier, so the header names it once. One hairline-divided
                  strip of readings at one size, scanned left to right. */}
              <div className="flex flex-col">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border border-b-0 border-border bg-card px-4 py-2">
                  <h2 className="text-xs font-semibold text-muted-foreground">
                    {activeLabel}
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">
                    {heldCount} {heldCount === 1 ? "position" : "positions"}
                  </span>
                </div>

                {/* The fifth reading spans the gap a 2- or 3-column wrap would leave. */}
                <StatStrip className="border sm:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
                  <Stat
                    className={
                      market === undefined
                        ? undefined
                        : active.sharpe > market.sharpe
                          ? "text-undervalued"
                          : "text-overvalued"
                    }
                    label="Sharpe ratio"
                    value={active.sharpe.toFixed(2)}
                    hint={
                      market &&
                      `${formatSharpeDelta(active.sharpe - market.sharpe)} vs S&P 500`
                    }
                  />
                  <Stat
                    className={
                      market === undefined
                        ? undefined
                        : active.return > market.return
                          ? "text-undervalued"
                          : "text-overvalued"
                    }
                    label="Expected return"
                    value={formatPercent(active.return)}
                    hint={market && `${formatPp(active.return - market.return)} vs S&P 500`}
                  />
                  <Stat
                    className={
                      market === undefined
                        ? undefined
                        : active.volatility > market.volatility
                          ? "text-overvalued"
                          : "text-undervalued"
                    }
                    label="Expected volatility"
                    value={formatPercent(active.volatility)}
                    hint={
                      market &&
                      `${formatPp(active.volatility - market.volatility)} vs S&P 500`
                    }
                  />
                  <Stat
                    label="T-bill (3M)"
                    value={formatPercent(data.risk_free_rate)}
                    hint={isBaseline ? "illustrative, not today's rate" : "13-week T-bill, the risk-free rate"}
                  />
                  {/* The one figure here that is not a property of the solve:
                      what the reverse-DCF models say about the book it picked,
                      weighted by position size. */}
                  <Stat
                    className={
                      consensus.ratedHoldings > 0
                        ? gapTextClass(consensus.impliedAlpha)
                        : undefined
                    }
                    label="Implied excess return, weighted"
                    value={
                      consensus.ratedHoldings > 0
                        ? formatPp(consensus.impliedAlpha)
                        : DASH
                    }
                    hint={
                      consensus.ratedHoldings > 0
                        ? `implied − required, by position weight · ${formatAxisPercent(consensus.coverage)} of weight valued`
                        : undefined
                    }
                  />
                </StatStrip>
              </div>

              {/* The frontier is the hero: full width where the results are
                  narrow, two thirds beside the list of its portfolios where
                  they are wide. The list fills whatever height the chart sets. */}
              <div className="grid gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
                <FrontierChart
                  data={data}
                  isBaseline={isBaseline}
                  selected={selected}
                  onSelect={selectPortfolio}
                />

                <PortfolioList
                  data={data}
                  selected={selected}
                  onSelect={selectPortfolio}
                  isBaseline={isBaseline}
                />
              </div>

              {/* Equal-height rows, so the column edges line up rather than
                  leaving a ragged hole under the shorter panel. */}
              <div className="grid gap-4 @3xl:grid-cols-2">
                {Object.keys(sectors).length > 0 ? (
                  <SectorExposure
                    portfolio={active}
                    sectors={sectors}
                    scope={activeLabel}
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

                <HoldingsChart
                  portfolio={active}
                  sectors={sectors}
                  scope={activeLabel}
                />
              </div>

              <div className="grid gap-4 @3xl:grid-cols-2">
                <SharpeCurve data={data} isBaseline={isBaseline} />
                <HoldingsTable
                  portfolio={active}
                  sectors={sectors}
                  scope={activeLabel}
                />
              </div>
            </div>
          ) : (
            <Panel>
              <PanelHeader>
                <PanelTitle>Efficient frontier</PanelTitle>
                <PanelMeta>
                  {screened ? `${tickers.length} recognised tickers` : "Full S&P 500"}
                </PanelMeta>
              </PanelHeader>
              <PanelBody className="flex min-h-72 flex-col items-start justify-center gap-2 py-10">
                <p className="text-sm font-medium">
                  {tooFew
                    ? "Not enough stocks to optimise"
                    : loading
                      ? "Optimising…"
                      : error
                        ? "No frontier for this set"
                        : "Not solved yet"}
                </p>
                <p className="max-w-prose text-sm text-muted-foreground">
                  {tooFew
                    ? `A mean–variance frontier needs at least ${MIN_FRONTIER_TICKERS} recognised tickers; this set has ${tickers.length}. Add names in the screener or to the URL.`
                    : loading
                      ? `${solving}. A solve usually takes five to twenty seconds.`
                      : error
                        ? "The optimiser refused the request (reason above). Nothing is plotted: the illustrative baseline is not a result for this set."
                        : `Press Run optimisation to solve over these ${tickers.length} stocks.`}
                </p>
                {tooFew && (
                  <Link href="/screener" className="text-sm underline underline-offset-4">
                    Open the screener
                  </Link>
                )}
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
