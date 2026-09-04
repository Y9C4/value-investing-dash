"use client"

import { usePathname } from "next/navigation"

/**
 * Which page you are on, as the leading field of the context strip.
 *
 * Every page used to open with an eyebrow, a title and a paragraph — "STEP ONE
 * / SCREENER" and a sentence explaining the table underneath it. That block
 * cost the top eighth of the window on every route to say something the
 * sidebar already said, and on a screener whose useful height is whatever the
 * window has left, a header is rows.
 *
 * So the name moved into the strip that was already there. It is the page's
 * `h1` — one per document, first in the reading order, and the only heading
 * the route itself contributes.
 *
 * Derived from the path rather than passed down, because the strip is rendered
 * once in the root layout and the layout does not know which route filled it.
 */

const LABELS: Record<string, string> = {
  "/screener": "Screener",
  "/stocks": "Analysis",
  "/portfolio": "Portfolio",
  "/data": "Data",
}

function labelFor(pathname: string): string {
  const exact = LABELS[pathname]
  if (exact) return exact

  // `/stocks/AAPL` is the stock, not the section. The ticker is the shortest
  // true name for that page and the one the reader came looking for.
  const stock = pathname.match(/^\/stocks\/([^/]+)$/)
  if (stock) return decodeURIComponent(stock[1]).toUpperCase()

  return "Margin"
}

export function PageLabel() {
  const pathname = usePathname()

  return (
    <h1 className="font-heading text-xs font-semibold tracking-widest uppercase">
      {labelFor(pathname)}
    </h1>
  )
}
