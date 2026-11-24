"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  RiDashboardLine,
  RiFilter3Line,
  RiFlaskLine,
  RiInformationLine,
  RiPieChartLine,
} from "@remixicon/react"

import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

const NAV = [
  { href: "/", label: "Market overview", hint: "Implied vs required return, by sector", icon: RiDashboardLine },
  { href: "/screener", label: "Stock screener", hint: "Rank the S&P 500 by factor percentile", icon: RiFilter3Line },
  { href: "/portfolio", label: "Portfolio optimiser", hint: "Mean–variance efficient frontier", icon: RiPieChartLine },
  { href: "/research", label: "Backtest evidence", hint: "Out-of-sample ICs, notebooks", icon: RiFlaskLine },
  { href: "/methodology", label: "Methodology", hint: "Models, assumptions, sources", icon: RiInformationLine },
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
      <a
        href="#main-content"
        className="sr-only z-[60] bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="flex shrink-0 flex-col border-b border-border bg-card lg:h-screen lg:w-60 lg:border-r lg:border-b-0 lg:bg-sidebar">
        <div className="flex items-center justify-between gap-3 px-5 py-3 lg:py-5">
          <Link
            href="/"
            className="font-heading text-lg leading-none whitespace-nowrap transition-opacity hover:opacity-70"
          >
            Value Investing Dash
          </Link>
          {/* Below lg the sidebar footer is hidden; the toggle moves up here. */}
          <span className="lg:hidden">
            <ThemeToggle />
          </span>
        </div>

        {/* Below lg: one scrolling row, faded at the right edge so the items
            past it read as "more", not as missing. */}
        <nav
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto px-3 pb-2 [mask-image:linear-gradient(to_right,black_85%,transparent)] lg:flex-col lg:overflow-visible lg:pb-0 lg:[mask-image:none]"
        >
          {NAV.map(({ href, label, hint, icon: Icon }) => {
            const active = isActive(pathname, href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-1.5 transition-colors lg:gap-3 lg:border-b-0 lg:border-l-2 lg:px-3 lg:py-2",
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

        <div className="hidden border-t border-border px-5 py-4 lg:mt-auto lg:flex lg:flex-col lg:items-start lg:gap-3">
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

      {/* `relative` so absolutely positioned descendants (sr-only labels)
          are contained by main's scroll box instead of stretching the page. */}
      <main id="main-content" tabIndex={-1} className="relative min-w-0 flex-1 outline-none lg:h-screen lg:overflow-y-auto">
        {/* Sticky against the main column's own scroll at lg and up, where the
            as-of state stays beside the numbers it describes. On a phone it
            scrolls away: a pinned strip would cover an eighth of the screen. */}
        {contextBar && <div className="z-30 bg-card lg:sticky lg:top-0">{contextBar}</div>}
        {children}
      </main>
    </div>
  )
}
