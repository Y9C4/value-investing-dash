"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel"

/**
 * One backfill stage, with its own button and result readout.
 *
 * Every backfill endpoint returns the same result shape, so one component
 * serves all of them. They stay separate buttons so a five-second factor
 * refresh need not drag an eight-minute fundamentals fetch behind it.
 */

type BackfillResult = {
  tickers_requested: number
  tickers_succeeded: number
  tickers_failed: string[]
  rows_fetched: number
  rows_upserted: number
  duration_seconds: number
  errors: string[]
  /** Only the valuations endpoint reports these. */
  tickers_valued?: number
}

export function BackfillCard({
  title,
  description,
  endpoint,
  buttonLabel,
  estimate,
  confirm,
}: {
  /** Asked before a long job starts; omit for jobs that take seconds. */
  confirm?: string
  title: string
  description: string
  endpoint: string
  buttonLabel: string
  /** Rough runtime, so a long job does not look like a hang. */
  estimate: string
}) {
  const [loading, setLoading] = useState(false)
  const [armed, setArmed] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(endpoint, { method: "POST" })
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.detail ?? `Failed to run ${title}`)
      }

      setResult(body as BackfillResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        <span className="text-xs text-muted-foreground">
          {estimate}
        </span>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {armed ? (
            <>
              <span className="text-sm">{confirm}</span>
              <Button variant="outline" onClick={() => { setArmed(false); void handleClick() }}>
                Start
              </Button>
              <Button variant="ghost" onClick={() => setArmed(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={confirm ? () => setArmed(true) : handleClick} disabled={loading}>
              {loading ? "Running…" : buttonLabel}
            </Button>
          )}
          {loading && (
            <p className="text-sm text-muted-foreground">
              Working — this takes {estimate}.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Succeeded</dt>
              <dd className="font-mono">
                {result.tickers_valued ?? result.tickers_succeeded} /{" "}
                {result.tickers_requested}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Rows</dt>
              <dd className="font-mono">
                {result.rows_upserted.toLocaleString()} upserted (
                {result.rows_fetched.toLocaleString()} fetched)
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Took</dt>
              <dd className="font-mono">{result.duration_seconds}s</dd>
            </div>
            {result.tickers_failed.length > 0 && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Skipped</dt>
                <dd className="font-mono">
                  {result.tickers_failed.length} —{" "}
                  {result.tickers_failed.slice(0, 8).join(", ")}
                  {result.tickers_failed.length > 8 && " …"}
                </dd>
              </div>
            )}
          </dl>
        )}
      </PanelBody>
    </Panel>
  )
}
