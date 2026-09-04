"use client"

import { useEffect, useState } from "react"

import {
  FrontierChart,
  SharpeCurve,
  hasTangency,
} from "@/components/efficient-frontier"
import {
  HoldingsBreakdown,
  SectorExposure,
} from "@/components/portfolio-composition"
import { PortfolioControls } from "@/components/portfolio-controls"
import { Info } from "@/components/info"
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
import { BASELINE_FRONTIER, type FrontierResponse } from "@/lib/baseline-frontier"
import { formatPercent, formatSignedPercent } from "@/lib/format"
import {
  DEFAULT_SETTINGS,
  effectiveHoldings,
  buildFrontierRequest,
  validateSettings,
  type PortfolioSettings,
} from "@/lib/portfolio-settings"

/**
 * The portfolio workspace: the constraints that shape a solve, and everything
 * the solve produced.
 *
 * Every number here is downstream of a constraint set, so the constraints are
 * stated next to the result rather than buried in a service. A frontier with
 * no stated constraints is not a claim about anything.
 */

const STAR_POINTS = "5,0 6.2,3.6 10,3.6 6.9,5.9 8.1,9.5 5,7.3 1.9,9.5 3.1,5.9 0,3.6 3.8,3.6"

function ConstraintRow({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="font-mono text-sm tabular-nums">{value}</span>
      </div>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
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
  // replaced the moment a live solve returns.
  const [data, setData] = useState<FrontierResponse>(BASELINE_FRONTIER)
  const [isBaseline, setIsBaseline] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Seconds the current solve has been running, for the progress readout. */
  const [elapsed, setElapsed] = useState(0)

  const errors = validateSettings(settings)

  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [loading])

  async function handleBuild() {
    if (Object.keys(errors).length > 0) return

    setLoading(true)
    setError(null)
    setElapsed(0)

    try {
      const { query, init } = buildFrontierRequest(settings, tickers)
      const res = await fetch(`/api/efficient-frontier?${query}`, init)

      // 431 never reaches the optimiser, so it must not be reported as one
      // failing. It means this browser's headers are too large for the server —
      // usually cookies piled up on localhost — and it is the reader's browser
      // state rather than anything about their settings.
      if (res.status === 431) {
        throw new Error(
          "The request headers were too large for the dev server (HTTP 431). " +
            "The optimiser was never reached. This is almost always cookies " +
            "accumulated on localhost — clear them for this site and retry."
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
          `The optimiser returned an unreadable response (HTTP ${res.status}).`
        )
      }

      if (!res.ok) {
        throw new Error(body?.detail ?? "Failed to build the efficient frontier")
      }

      setData(body as unknown as FrontierResponse)
      setIsBaseline(false)
    } catch (err) {
      // Keep the previous render on screen rather than dropping to a blank
      // frame — the error line says what happened.
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
    ...Object.values(tangency.weights).map((weight) => Math.abs(weight))
  )
  const sectors = data.sectors ?? {}
  const shortSide = Object.values(tangency.weights).filter((w) => w < 0)

  const anchors = [
    { key: "maxSharpe" as const, title: "Max Sharpe", portfolio: data.max_sharpe },
    {
      key: "minVolatility" as const,
      title: "Min volatility",
      portfolio: data.min_volatility,
    },
  ]

  return (
    <div className="flex w-full flex-col gap-4">
      {/* A link the screener built against a different index. It cannot be
          decoded back to the set it promised, so the scope silently widens to
          the whole index unless that is said out loud. */}
      {staleSet && (
        <p
          role="status"
          className="border border-border bg-card px-4 py-2.5 text-sm"
        >
          That screener link points at an older version of the index and
          can&rsquo;t be read back. Optimising over the full index — run the
          screen again for a fresh link.
        </p>
      )}

      <PortfolioControls
        settings={settings}
        errors={errors}
        onChange={setSettings}
        onRun={handleBuild}
        loading={loading}
        universeSize={tickers.length}
      />

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

      {/* One strip, hairline-divided, rather than six bordered tiles: six
          boxes is six borders saying nothing, and this is the row a reader
          scans left to right. */}
      <StatStrip>
        <Stat
          size="lead"
          label="Sharpe"
          value={tangency.sharpe.toFixed(2)}
          hint={
            hasTangency(data)
              ? "Tangency portfolio"
              : "Negative — nothing beat cash"
          }
        />
        <Stat
          label="Expected return"
          value={formatPercent(tangency.return)}
          hint="Annualised, from the 2y window"
        />
        <Stat
          label="Volatility"
          value={formatPercent(tangency.volatility)}
          hint="Annualised standard deviation"
        />
        <Stat
          label="Effective holdings"
          value={effective.toFixed(1)}
          hint={`Of ${heldCount} names held`}
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
          hint="US 13-week treasury, annualised"
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

      <div className="grid gap-4 lg:grid-cols-2">
        <SharpeCurve data={data} isBaseline={isBaseline} />

        <Panel>
          <PanelHeader>
            <PanelTitle>
              Anchor portfolios
              <Info title="The two anchors" side="bottom">
                Both are read off the same solved frontier. Min volatility is
                its left-hand end; max Sharpe is the point the capital market
                line is tangent to. Everything else on this page describes the
                max-Sharpe portfolio.
              </Info>
            </PanelTitle>
            <PanelMeta>Read off the same frontier</PanelMeta>
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
                    <span className="inline-flex items-center gap-1.5">
                      Eff. names
                      <Info title="Effective names" side="left">
                        1/&Sigma;w&sup2; &mdash; the holding count adjusted for
                        how lopsided the weights are. It is where the L2 penalty
                        shows up: at the min-volatility end nothing competes
                        with it, so raising &gamma; visibly spreads this row.
                        Max Sharpe barely moves, because its return target is
                        doing the binding.
                      </Info>
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anchors.map(({ key, title, portfolio }) => (
                  <TableRow key={key}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <svg viewBox="0 0 10 10" className="size-3 shrink-0">
                          {key === "maxSharpe" ? (
                            <polygon
                              points={STAR_POINTS}
                              fill="var(--color-series-3)"
                            />
                          ) : (
                            <polygon
                              points="5,0 10,5 5,10 0,5"
                              fill="var(--color-series-3)"
                            />
                          )}
                        </svg>
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
                  <TableCell className="font-medium">Risk-free rate</TableCell>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.keys(sectors).length > 0 ? (
          <SectorExposure portfolio={tangency} sectors={sectors} />
        ) : (
          <Panel>
            <PanelHeader>
              <PanelTitle>Sector exposure</PanelTitle>
            </PanelHeader>
            <PanelBody>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {isBaseline
                  ? "Run a live optimisation to see how the weights fall across sectors."
                  : "No sector labels were available for these holdings, so the breakdown is omitted rather than shown half-filled."}
              </p>
            </PanelBody>
          </Panel>
        )}

        <Panel>
          <PanelHeader>
            <PanelTitle>Constraints applied</PanelTitle>
            <PanelMeta>What the solver was given</PanelMeta>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-3">
            <div className="flex flex-col">
              <ConstraintRow
                label="Universe"
                value={
                  typeof data.n_assets === "number"
                    ? String(data.n_assets)
                    : "—"
                }
                note={
                  tickers.length > 0
                    ? `${tickers.length} handed over by the screener`
                    : "The full index"
                }
              />
              <ConstraintRow
                label="Maximum position"
                value={
                  typeof data.max_stock_weight === "number"
                    ? formatPercent(data.max_stock_weight)
                    : "—"
                }
                note={
                  typeof data.max_stock_weight === "number" &&
                  data.max_stock_weight > 0.0301 &&
                  typeof data.n_assets === "number" &&
                  settings.maxWeight.trim() === ""
                    ? `Widened from the usual 3%: that cap cannot be spread across ${data.n_assets} stocks and still sum to 100%`
                    : undefined
                }
              />
              <ConstraintRow
                label="Minimum position"
                value={
                  typeof data.min_stock_weight === "number"
                    ? formatSignedPercent(data.min_stock_weight)
                    : "—"
                }
                note={
                  typeof data.min_stock_weight === "number" &&
                  data.min_stock_weight < 0
                    ? `Shorting permitted; ${shortSide.length} ${shortSide.length === 1 ? "name is" : "names are"} held short`
                    : undefined
                }
              />
              <ConstraintRow
                label="L2 penalty (γ)"
                value={(data.l2_gamma ?? 0).toFixed(2)}
                note={
                  (data.l2_gamma ?? 0) > 0
                    ? "Weights pushed off the corners of the feasible set"
                    : "Unregularised — expect weights at exactly 0 or exactly the cap"
                }
              />
              <ConstraintRow
                label="Frontier points"
                value={String(data.n_portfolios)}
                note={
                  data.resolution_capped
                    ? `Capped from ${data.n_portfolios_requested} — every point is a separately solved ${data.n_assets ?? 0}-variable problem, and the service budgets points × assets.`
                    : undefined
                }
              />
            </div>

            {data.excluded_short_history &&
              data.excluded_short_history.length > 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Excluded for insufficient price history:{" "}
                  <span className="font-mono">
                    {data.excluded_short_history.join(", ")}
                  </span>
                  . Listed part-way through the window, so the covariance
                  estimator would see a fraction of their true volatility.
                </p>
              )}

            {isBaseline && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                These are the baseline&apos;s constraints, not yours — run the
                optimisation to apply the settings above.
              </p>
            )}
          </PanelBody>
        </Panel>
      </div>

      <HoldingsBreakdown
        portfolio={tangency}
        sectors={sectors}
        title="Max Sharpe — holdings"
      />
    </div>
  )
}
