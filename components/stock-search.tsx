"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { RiSearchLine } from "@remixicon/react"

import { Input } from "@/components/ui/input"

/**
 * The way into a single stock, in the context bar on every page. Enter submits.
 *
 * Resolution happens here rather than at the destination because the
 * destination's only recourse is a 404. A company name is as good an input as
 * its ticker — few people know that Expand Energy is EXE.
 */
export function StockSearch({
  stocks,
}: {
  /** Every stock in the universe, for resolution and the type-ahead list. */
  stocks: { ticker: string; name: string }[]
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const index = useMemo(
    () =>
      stocks.map((stock) => ({
        ticker: stock.ticker,
        haystack: `${stock.ticker} ${stock.name}`.toUpperCase(),
      })),
    [stocks]
  )

  /**
   * Exact ticker first, then a name or ticker containing the query. "C" is
   * Citigroup's ticker and a substring of two hundred names, so a substring
   * search that ran first would never reach it.
   */
  function resolve(raw: string): string | null {
    const needle = raw.trim().toUpperCase()
    if (!needle) return null
    const exact = index.find((entry) => entry.ticker === needle)
    if (exact) return exact.ticker
    return index.find((entry) => entry.haystack.includes(needle))?.ticker ?? null
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const ticker = resolve(query)
    if (!ticker) {
      setError(`Nothing in the index matches “${query.trim()}”.`)
      return
    }
    setError(null)
    setQuery("")
    router.push(`/stocks/${ticker}`)
  }

  return (
    <form onSubmit={handleSubmit} className="relative" role="search">
      <div className="flex w-48 items-center gap-2 border-b border-input focus-within:border-ring">
        <RiSearchLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          list="stock-universe"
          aria-label="Find a stock by ticker or company name"
          placeholder="Find a stock"
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setError(null)
          }}
          className="h-7 border-transparent text-xs"
        />
      </div>

      {/* The whole universe as a native type-ahead: ~500 options is nothing to
          the browser, and it lets the field be browsed. */}
      <datalist id="stock-universe">
        {stocks.map((stock) => (
          <option key={stock.ticker} value={stock.ticker} label={stock.name} />
        ))}
      </datalist>

      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-40 mt-1 w-64 border border-border bg-popover px-2 py-1 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </form>
  )
}
