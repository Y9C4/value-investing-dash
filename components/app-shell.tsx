"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  RiFilter3Line,
  RiLineChartLine,
  RiPieChartLine,
  RiStockLine,
} from "@remixicon/react"

import { IntroDialog } from "@/components/intro-dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import { cn } from "@/lib/utils"

const NAV = [
  {
    href: "/screener",
    label: "Screener",
    hint: "Filter the universe",
    icon: RiFilter3Line,
  },
  {
    href: "/stocks",
    label: "Analysis",
    hint: "Value one company",
    icon: RiStockLine,
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    hint: "Optimise the survivors",
    icon: RiPieChartLine,
  },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-border bg-sidebar lg:h-screen lg:w-64 lg:border-r lg:border-b-0">
        <div className="flex items-center gap-2.5 px-6 py-6">
          <RiLineChartLine className="size-5 text-primary" />
          <span className="font-heading text-sm font-semibold tracking-widest uppercase">
            Margin
          </span>
        </div>

        {/* The three steps of the workflow, in the order they're performed. */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
          {NAV.map(({ href, label, hint, icon: Icon }) => {
            const active = pathname.startsWith(href)

            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
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
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto hidden flex-col gap-3 px-6 py-6 lg:flex">
          <IntroDialog />
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/data"
              className={cn(
                "text-xs tracking-widest uppercase transition-colors hover:text-foreground",
                pathname.startsWith("/data")
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              Data
            </Link>
          </div>
        </div>

        <div className="absolute top-4 right-4 lg:hidden">
          <ThemeToggle />
        </div>
      </aside>

      <main className="min-w-0 flex-1 lg:h-screen lg:overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
