"use client"

import { RiMoonLine, RiSunLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"

/**
 * Dark-mode switch.
 *
 * Holds no state: the `dark` class on <html> is the source of truth, set
 * before first paint by the blocking script in `app/layout.tsx`, and both
 * icons are rendered with CSS choosing between them. So there is nothing to
 * hydrate and the icon cannot disagree with the page it sits on — which is
 * exactly what a React state mirror of the class gets wrong on the first
 * paint of a dark page.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement
    const next = root.classList.contains("dark") ? "light" : "dark"
    localStorage.setItem("theme", next)
    root.classList.toggle("dark", next === "dark")
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label="Toggle dark mode"
    >
      <RiMoonLine className="size-4 dark:hidden" />
      <RiSunLine className="hidden size-4 dark:block" />
    </Button>
  )
}
