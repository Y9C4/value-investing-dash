"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  RiDashboardLine,
  RiFilter3Line,
  RiInformationLine,
  RiPieChartLine,
} from "@remixicon/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Market overview", hint: "Implied vs required return, by sector", icon: RiDashboardLine },
  { href: "/screener", label: "Stock screener", hint: "Rank the S&P 500 by factor percentile", icon: RiFilter3Line },
  { href: "/portfolio", label: "Portfolio optimiser", hint: "Mean–variance efficient frontier", icon: RiPieChartLine },
  { href: "/methodology", label: "Methodology", hint: "Models, assumptions, backtest", icon: RiInformationLine },
]

/** `/` would prefix-match every route, so it is matched exactly. */
function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href)
}

export function AppShell({
  children,
  contextBar,
  /** Maintenance is local-only; see `isDataPageEnabled`. */
  showDataLink = false,
}: {
  children: React.ReactNode
  /**
   * The as-of strip. Rendered on the server and handed down, because this
   * shell is a client component and the data behind the strip is a cached
   * server read.
   */
  contextBar?: React.ReactNode
  showDataLink?: boolean
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-sidebar lg:h-screen lg:w-60 lg:border-r lg:border-b-0">
        <Link
          href="/"
          className="px-5 py-5 font-heading text-lg leading-none whitespace-nowrap transition-opacity hover:opacity-70"
        >
          Value Investing Dash
        </Link>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV.map(({ href, label, hint, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 border-l-2 px-3 py-2 transition-colors",
                  active
                    ? "border-primary bg-sidebar-accent text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium whitespace-nowrap">{label}</span>
                  <span className="hidden text-xs text-muted-foreground lg:block">{hint}</span>
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 lg:mt-auto lg:flex-col lg:items-start lg:py-4">
          <ThemeToggle />
          {showDataLink && (
            <Link
              href="/data"
              className={cn(
                "text-xs transition-colors hover:text-foreground",
                pathname.startsWith("/data") ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Data maintenance
            </Link>
          )}
          <Link
            href="/methodology#about"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            by Yajat Charpe
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
        {/* Sticky against the main column's own scroll: the as-of state is
            only useful while the numbers it describes are on screen. */}
        {contextBar && <div className="sticky top-0 z-30 bg-card">{contextBar}</div>}
        {children}
      </main>
    </div>
  )
}
