"use client"

import { useSyncExternalStore } from "react"

/** Whether the viewport is at least `px` wide; undefined on the server and while hydrating. */
export function useMinWidth(px: number): boolean | undefined {
  return useSyncExternalStore<boolean | undefined>(
    (notify) => {
      const query = window.matchMedia(`(min-width: ${px}px)`)
      query.addEventListener("change", notify)
      return () => query.removeEventListener("change", notify)
    },
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => undefined
  )
}
