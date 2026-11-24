"use client"

import { useSyncExternalStore } from "react"
import { RiMoonLine, RiSunLine } from "@remixicon/react"

/**
 * Dark by default; light swaps the colour tokens and nothing else. The choice
 * lives on `<html data-theme>` (set before paint by the script in the root
 * layout) and in localStorage, which may be unavailable — then it lasts the tab.
 */
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const isLight = () => document.documentElement.dataset.theme === "light"

export function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, isLight, () => false)

  function toggle() {
    const next = light ? "dark" : "light"
    if (next === "light") document.documentElement.dataset.theme = "light"
    else delete document.documentElement.dataset.theme
    try {
      localStorage.setItem("theme", next)
    } catch {}
    listeners.forEach((listener) => listener())
  }

  const Icon = light ? RiMoonLine : RiSunLine
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      title={light ? "Dark theme" : "Light theme"}
      className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="hidden lg:inline">{light ? "Dark" : "Light"} theme</span>
    </button>
  )
}
