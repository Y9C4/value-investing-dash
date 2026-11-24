"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

/**
 * The one 404 for the site, in the site's own theme (Next's default sets a
 * white body, which broke the dark theme). An unknown ticker is the common
 * case, so it is named as one.
 */
export default function NotFound() {
  const pathname = usePathname()
  const ticker = pathname.match(/^\/stocks\/([^/]+)$/)?.[1]

  return (
    <div className="flex flex-col gap-4 px-6 py-12 lg:px-10">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        Not found · 404
      </p>
      <h2 className="max-w-2xl font-heading text-2xl leading-snug">
        {ticker ? (
          <>
            <span className="font-figure">{decodeURIComponent(ticker).toUpperCase()}</span> is not a
            ticker in today&rsquo;s S&amp;P 500.
          </>
        ) : (
          "There is no page at this address."
        )}
      </h2>
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {ticker
          ? "The dashboard covers current index members only. Search by ticker or company name in the bar above (share classes use a hyphen, as in BRK-B), or browse the whole index in the screener."
          : "The page may have moved. Every section of the dashboard is linked below."}
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {[
          ["/", "Overview"],
          ["/screener", "Stock screener"],
          ["/portfolio", "Portfolio optimiser"],
          ["/research", "Backtest evidence"],
          ["/methodology", "Methodology"],
        ].map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="underline underline-offset-2 hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
