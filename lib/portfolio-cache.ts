"use client"

import type { FrontierResponse } from "@/lib/baseline-frontier"
import type { SelectedPortfolio } from "@/lib/portfolio-selection"
import type { PortfolioSettings } from "@/lib/portfolio-settings"

/**
 * A solved frontier, kept for as long as the tab is open.
 *
 * A solve is five to twenty seconds of real work, and until now clicking
 * through to a stock page and back threw it away: the page came back showing
 * the illustrative baseline as though nothing had been run. That is the one
 * thing a reader is guaranteed to do: optimise, look up a holding, return.
 *
 * `sessionStorage`, deliberately, not `localStorage`. A frontier is a reading
 * of prices on a particular afternoon, so it should not outlive the tab and
 * come back stale next week claiming to be current. It also never leaves the
 * browser; there is no account to attach it to and no reason to store it
 * anywhere a second person could read.
 *
 * Every access is wrapped: private windows and blocked site data throw on the
 * accessor itself, and a page that cannot remember a solve must still render.
 */

const KEY = "margin.portfolio.solve.v1"

export type CachedSolve = {
  /** Which universe this was solved over; see `scopeKey`. */
  scope: string
  settings: PortfolioSettings
  data: FrontierResponse
  savedAt: number
  /**
   * Which point on the curve was being read. Optional: entries written before
   * the frontier was selectable have none, and the page falls back to the
   * tangency it would have shown them anyway.
   */
  selected?: SelectedPortfolio
}

/**
 * The identity of a solve's universe.
 *
 * A frontier over 32 screened names is not a frontier over the index, so a
 * cached result is only restored onto the scope it was solved for; otherwise
 * arriving from a fresh screen would show the previous screen's portfolio
 * under the new one's heading.
 */
export function scopeKey(tickers: readonly string[]): string {
  return tickers.length === 0 ? "index" : [...tickers].sort().join(",")
}

export function readSolve(): CachedSolve | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedSolve
    // Written by an older build, or hand-edited. Nothing here is worth a
    // schema check beyond "does it have the fields the page reads".
    if (!parsed?.data?.max_sharpe || !parsed.settings) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSolve(entry: CachedSolve): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entry))
  } catch {
    // Quota, or storage switched off. The solve is still on screen; it just
    // will not survive the next navigation.
  }
}

export function clearSolve(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // As above.
  }
}
