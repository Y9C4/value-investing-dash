"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  RiFilter3Line,
  RiGithubFill,
  RiInformationLine,
  RiLineChartLine,
  RiLinkedinBoxFill,
  RiMailLine,
  RiPieChartLine,
  RiStockLine,
} from "@remixicon/react"

import { cn } from "@/lib/utils"

const NAV = [
  {
    href: "/screener",
    label: "Screener",
    hint: "Filter Stocks",
    icon: RiFilter3Line,
  },
  {
    href: "/stocks",
    label: "Analysis",
    hint: "Value Individual Stock",
    icon: RiStockLine,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    hint: "Optimise on Screened Stocks",
    icon: RiPieChartLine,
  },
]

const PROFILE = {
  name: "Yajat Charpe",
  degree: "Bachelor of Commerce & Computer Science",
  university: "Monash University",
  graduating: "Graduating Nov 2027",
}

const PROFILE_LINKS = [
  { label: "GitHub", href: "https://github.com/Y9C4", icon: RiGithubFill },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/yajat-charpe-05a372318/",
    icon: RiLinkedinBoxFill,
  },
  { label: "Email", href: "mailto:yajatcharpe@gmail.com", icon: RiMailLine },
]

/** One look for every sidebar link, so About reads as part of the nav. */
function navItemClass(active: boolean) {
  return cn(
    "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
  )
}

function NavLabel({
  label,
  hint,
  active,
}: {
  label: string
  hint: string
  active: boolean
}) {
  return (
    <span className="flex flex-col">
      <span
        className={cn(
          "text-xs font-semibold tracking-widest uppercase",
          active ? "text-foreground" : undefined
        )}
      >
        {label}
      </span>
      <span className="hidden text-xs text-muted-foreground lg:block">
        {hint}
      </span>
    </span>
  )
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
      <aside className="flex shrink-0 flex-col border-b border-border bg-sidebar/50 lg:h-screen lg:w-64 lg:border-r lg:border-b-0">
        {/* Straight to step one. There is no landing page to go back to —
            the workflow starts at the screener and ends at the portfolio. */}
        <Link
          href="/screener"
          className="flex items-center gap-2.5 px-6 py-6 transition-opacity hover:opacity-70"
        >
          <RiLineChartLine className="size-5 text-primary" />
          <span className="font-heading text-sm font-semibold tracking-widest uppercase">
            Value-Investing-Dash
          </span>
        </Link>

        {/* The three steps of the workflow, in the order they're performed,
            then About — set apart by a rule because it is not a step. */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV.map(({ href, label, hint, icon: Icon }) => {
            const active = pathname.startsWith(href)

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={navItemClass(active)}
              >
                <Icon className="size-4 shrink-0" />
                <NavLabel label={label} hint={hint} active={active} />
              </Link>
            )
          })}

          <div
            aria-hidden="true"
            className="mx-3 my-2 hidden border-t border-sidebar-border lg:block"
          />

          <Link
            href="/about"
            aria-current={pathname.startsWith("/about") ? "page" : undefined}
            className={navItemClass(pathname.startsWith("/about"))}
          >
            <RiInformationLine className="size-4 shrink-0" />
            <NavLabel
              label="About"
              hint="How and why it was built"
              active={pathname.startsWith("/about")}
            />
          </Link>
        </nav>

        {/* Who built it. Information, not navigation — only the icons are
            links. On phones it shrinks to the name and the icons. */}
        <div className="flex items-center justify-between gap-3 border-t border-sidebar-border px-6 py-3 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-0 lg:py-6">
          <div className="flex flex-col">
            <span className="text-xs font-semibold tracking-widest uppercase lg:text-sm">
              {PROFILE.name}
            </span>
            <span className="mt-2 hidden text-xs text-primary lg:block">
              {PROFILE.university}
            </span>
            <span className="hidden text-xs leading-relaxed text-muted-foreground lg:block">
              {PROFILE.degree}
            </span>
            <span className="hidden text-xs text-muted-foreground lg:block">
              {PROFILE.graduating}
            </span>
          </div>

          <div className="flex items-center gap-4 lg:mt-4">
            {PROFILE_LINKS.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                title={label}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon className="size-5" />
              </a>
            ))}
          </div>

          {showDataLink && (
            <Link
              href="/data"
              className={cn(
                "mt-6 hidden text-xs tracking-widest uppercase transition-colors hover:text-foreground lg:block",
                pathname.startsWith("/data")
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              Data
            </Link>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
        {/* Sticky against the main column's own scroll: the as-of state is
            only useful while the numbers it describes are on screen. */}
        {contextBar && (
          <div className="sticky top-0 z-30 bg-card">{contextBar}</div>
        )}
        {children}
      </main>
    </div>
  )
}
