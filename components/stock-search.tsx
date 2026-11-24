"use client"

import { useId, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { RiSearchLine } from "@remixicon/react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Matches shown at once: enough to disambiguate a name, few enough to scan. */
const MAX_MATCHES = 8

/** "brk.b" and "BRK/B" are how people type share classes; the index uses "BRK-B". */
const normalise = (raw: string) => raw.trim().toUpperCase().replace(/[./]/g, "-")

/**
 * The way into a single stock, in the context bar on every page: a combobox
 * (WAI-ARIA 1.2 pattern) over the whole index, by ticker or company name.
 *
 * Ranked exact ticker, then ticker prefix, then name prefix, then any
 * substring. "C" is Citigroup's ticker and a substring of two hundred names,
 * so a plain substring search would never reach it.
 */
export function StockSearch({
  stocks,
}: {
  /** Every stock in the universe, for resolution and the type-ahead list. */
  stocks: { ticker: string; name: string }[]
}) {
  const router = useRouter()
  const listId = useId()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const needle = normalise(query)
    if (!needle) return []
    const rank = (stock: { ticker: string; name: string }) => {
      const name = stock.name.toUpperCase()
      if (stock.ticker === needle) return 0
      if (stock.ticker.startsWith(needle)) return 1
      if (name.startsWith(needle)) return 2
      if (name.includes(needle) || stock.ticker.includes(needle)) return 3
      return -1
    }
    return stocks
      .map((stock) => ({ stock, rank: rank(stock) }))
      .filter((m) => m.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.stock.ticker.localeCompare(b.stock.ticker))
      .slice(0, MAX_MATCHES)
      .map((m) => m.stock)
  }, [query, stocks])

  const expanded = open && matches.length > 0

  function go(ticker: string) {
    setQuery("")
    setOpen(false)
    setError(null)
    router.push(`/stocks/${ticker}`)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const choice = matches[Math.min(active, matches.length - 1)]
    if (!choice) {
      if (query.trim()) setError(`No S&P 500 stock matches “${query.trim()}”.`)
      return
    }
    go(choice.ticker)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      if (matches.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current) => (current + step + matches.length) % matches.length)
    } else if (event.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative" role="search">
      <div className="flex w-full items-center gap-2 border-b border-input focus-within:border-ring focus-within:shadow-[0_1px_0_0_var(--color-ring)] sm:w-52 xl:w-64">
        <RiSearchLine className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          type="text"
          role="combobox"
          aria-label="Find a stock by ticker or company name"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
          placeholder="Find a stock: ticker or name"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
            setOpen(true)
            setError(null)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          className="h-8 border-transparent text-xs focus-visible:shadow-none"
        />
      </div>

      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching stocks"
          className="absolute top-full right-0 z-50 mt-1 w-full border border-border bg-popover py-1 sm:w-72 shadow-lg"
        >
          {matches.map((stock, i) => (
            <li
              key={stock.ticker}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: the input's blur closes the list first otherwise.
              onMouseDown={(event) => {
                event.preventDefault()
                go(stock.ticker)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-xs",
                i === active && "bg-accent"
              )}
            >
              <span className="w-14 shrink-0 font-mono font-semibold">{stock.ticker}</span>
              <span className="truncate text-muted-foreground">{stock.name}</span>
            </li>
          ))}
        </ul>
      )}

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
