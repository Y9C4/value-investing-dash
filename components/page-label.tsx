"use client"

import { usePathname } from "next/navigation"

/**
 * The current page's name, as the leading field of the context strip and the
 * page's only `h1`. Derived from the path because the strip is rendered once
 * in the root layout, which does not know which route filled it.
 */

const LABELS: Record<string, string> = {
  "/": "Overview",
  "/screener": "Stock screener",
  "/portfolio": "Portfolio optimiser",
  "/research": "Backtest results",
  "/methodology": "Methodology",
  "/data": "Data maintenance",
}

function labelFor(pathname: string): string {
  const exact = LABELS[pathname]
  if (exact) return exact

  // `/stocks/AAPL` is the stock, not the section. The ticker is the shortest
  // true name for that page and the one the reader came looking for.
  const stock = pathname.match(/^\/stocks\/([^/]+)$/)
  if (stock) return decodeURIComponent(stock[1]).toUpperCase()

  if (pathname.startsWith("/research/")) return "Backtest notebook"

  return "Value Investing Dash"
}

export function PageLabel() {
  const pathname = usePathname()

  return (
    <h1 className="font-heading text-base leading-none whitespace-nowrap">
      {labelFor(pathname)}
    </h1>
  )
}
