"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type BackfillResult = {
  tickers_requested: number
  tickers_succeeded: number
  tickers_failed: string[]
  rows_fetched: number
  rows_upserted: number
  duration_seconds: number
  errors: string[]
}

export function Sp500BackfillButton() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch("/api/backfill/sp500", { method: "POST" })
      const body = await res.json()

      if (!res.ok) {
        throw new Error(body?.detail ?? "Failed to run S&P 500 backfill")
      }

      setResult(body as BackfillResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>S&P 500 Daily Close Backfill</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Button onClick={handleClick} disabled={loading}>
            {loading ? "Fetching…" : "Backfill S&P 500 (1y)"}
          </Button>
          {loading && (
            <p className="text-sm text-muted-foreground">
              Fetching ~500 tickers and the S&amp;P 500 index — this may take
              a few minutes.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {result && (
          <div className="flex flex-col gap-1 text-sm">
            <p>
              {result.tickers_succeeded} / {result.tickers_requested} tickers
              succeeded in {result.duration_seconds}s
            </p>
            <p>
              {result.rows_upserted} rows upserted ({result.rows_fetched}{" "}
              fetched)
            </p>
            {result.tickers_failed.length > 0 && (
              <p className="text-destructive">
                Failed: {result.tickers_failed.join(", ")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
