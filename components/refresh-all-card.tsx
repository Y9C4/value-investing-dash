"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Runs every backfill stage in dependency order behind one button.
 *
 * The per-stage cards below remain the right tool for routine upkeep. This is
 * for the other case: bringing a stale database current without having to
 * remember that valuations read the three tables above them and run last.
 */

type StageResult = {
  failed?: boolean
  skipped?: boolean
  detail?: string
  tickers_requested?: number
  tickers_succeeded?: number
  tickers_valued?: number
  tickers_failed?: string[]
  rows_upserted?: number
  duration_seconds?: number
}

type RefreshAllResult = {
  ok: boolean
  failed_stages: string[]
  duration_seconds: number
  stages: Record<string, StageResult>
}

const STAGE_LABELS: Record<string, string> = {
  daily_close_prices: "Daily close prices",
  factor_returns: "Factor returns",
  quarterly_fundamentals: "Quarterly fundamentals",
  company_profile: "Company profile",
  valuations: "Valuations",
}

export function RefreshAllCard() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RefreshAllResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Off by default: statements change quarterly, so the eight-minute stage is
  // not what a routine refresh needs.
  const [includeFundamentals, setIncludeFundamentals] = useState(false)
  const [full, setFull] = useState(false)

  const estimate = includeFundamentals ? "~10 min" : "~2 min"

  async function handleClick() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const query = new URLSearchParams()
      if (!includeFundamentals) query.set("skip_fundamentals", "true")
      if (full) query.set("full", "true")

      const res = await fetch(`/api/backfill/all?${query}`, { method: "POST" })
      const raw = await res.text()
      let body: RefreshAllResult & { detail?: string }
      try {
        body = JSON.parse(raw)
      } catch {
        throw new Error(`Unreadable response (HTTP ${res.status}).`)
      }
      if (!res.ok) throw new Error(body?.detail ?? "Refresh failed")
      setResult(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex items-baseline justify-between gap-4">
        <CardTitle>Refresh everything</CardTitle>
        <span className="text-xs tracking-wider text-muted-foreground uppercase">
          {estimate}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Runs every stage below in the order they depend on each other and
          recomputes the valuations at the end. Use the individual cards when
          you only need one table; use this after a gap, or when you are not
          sure what is stale.
        </p>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeFundamentals}
              onChange={(e) => setIncludeFundamentals(e.target.checked)}
              disabled={loading}
              className="size-4 accent-foreground"
            />
            Include quarterly fundamentals (adds ~8 min — statements only change
            once a quarter)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => setFull(e.target.checked)}
              disabled={loading}
              className="size-4 accent-foreground"
            />
            Re-pull the full two-year price window (needed after the index
            membership changes, not for a routine refresh)
          </label>
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={handleClick} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh everything"}
          </Button>
          {loading && (
            <p className="text-sm text-muted-foreground">
              Working — this takes {estimate}. Leave the tab open.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {result.ok
                ? `All stages completed in ${result.duration_seconds}s.`
                : `Finished in ${result.duration_seconds}s with ${result.failed_stages.length} failed stage(s).`}
            </p>
            <dl className="flex flex-col gap-1 text-sm">
              {Object.entries(result.stages).map(([name, stage]) => (
                <div key={name} className="flex gap-2">
                  <dt className="min-w-52 text-muted-foreground">
                    {STAGE_LABELS[name] ?? name}
                  </dt>
                  <dd className="font-mono">
                    {stage.failed || stage.skipped
                      ? `${stage.skipped ? "skipped" : "failed"} — ${stage.detail ?? ""}`
                      : `${(stage.tickers_valued ?? stage.tickers_succeeded ?? 0).toLocaleString()}/${(stage.tickers_requested ?? 0).toLocaleString()} ok, ` +
                        `${(stage.rows_upserted ?? 0).toLocaleString()} rows, ${stage.duration_seconds}s`}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
