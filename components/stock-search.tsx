"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { RiSearchLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * The way into a single stock, on both `/stocks` and `/stocks/[ticker]`.
 *
 * `/stocks` used to render AAPL's charts by default — a page whose content was
 * a company nobody asked for, which then had to be replaced by whatever was
 * typed. It is a router, not a page: the parent holds the search box and every
 * result lives at its own URL, so a stock can be linked, shared and reloaded.
 *
 * Resolution happens here rather than at the destination because the
 * destination's only recourse is a 404. The universe is already in memory on
 * every page, so a typo can be answered in place, and a company name is as
 * good an input as its ticker — few people know that Expand Energy is EXE.
 */

/** Shows what a query looks like rather than describing one. */
const EXAMPLES = ["AAPL", "JNJ", "JPM"]

export function StockSearch({
  stocks,
  current,
}: {
  /** Every stock in the universe, for resolution and the type-ahead list. */
  stocks: { ticker: string; name: string }[]
  /** The stock currently on screen, when there is one. */
  current?: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const index = useMemo(
    () =>
      stocks.map((stock) => ({
        ticker: stock.ticker,
        name: stock.name,
        haystack: `${stock.ticker} ${stock.name}`.toUpperCase(),
      })),
    [stocks]
  )

  /**
   * Exact ticker first, then a name or ticker containing the query.
   *
   * The order matters: "C" is Citigroup's ticker and a substring of two
   * hundred company names, so a substring search that ran first would never
   * reach it.
   */
  function resolve(raw: string): string | null {
    const needle = raw.trim().toUpperCase()
    if (!needle) return null

    const exact = index.find((entry) => entry.ticker === needle)
    if (exact) return exact.ticker

    const partial = index.find((entry) => entry.haystack.includes(needle))
    return partial?.ticker ?? null
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    const ticker = resolve(query)
    if (!ticker) {
      setError(`Nothing in the index matches “${query.trim()}”.`)
      return
    }

    setError(null)
    router.push(`/stocks/${ticker}`)
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        {/* Underline, not a box: the same input treatment the filter rail
            uses, so the two search fields in the app read as one control. */}
        <div className="flex w-full max-w-xs items-center gap-2 border-b border-input focus-within:border-ring">
          <RiSearchLine
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            list="stock-universe"
            aria-label="Ticker or company name"
            placeholder="Ticker or company"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setError(null)
            }}
            className="border-transparent"
          />
        </div>
        <Button type="submit" size="sm">
          View
        </Button>
      </form>

      {/* The whole universe as a native type-ahead. 493 options is nothing to
          the browser, and it turns the field from something you have to know
          the answer for into something you can browse. */}
      <datalist id="stock-universe">
        {stocks.map((stock) => (
          <option key={stock.ticker} value={stock.ticker} label={stock.name} />
        ))}
      </datalist>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : !current ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Try
          {EXAMPLES.map((symbol) => (
            <Button
              key={symbol}
              variant="outline"
              size="xs"
              className="font-mono"
              onClick={() => router.push(`/stocks/${symbol}`)}
            >
              {symbol}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
