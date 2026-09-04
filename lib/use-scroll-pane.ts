"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Turns an element into a pane that ends at the bottom of the window and
 * scrolls its own content.
 *
 * The screener is a two-pane workspace — filters beside results — and panes
 * only work if each one scrolls independently. Sticky column headers need the
 * same thing for a different reason: a header can only stick to the element
 * that is actually being scrolled, so if the page scrolls instead of the
 * table, 448 rows carry their own column labels off the top and every figure
 * below becomes anonymous.
 *
 * The height has to be measured rather than written down. How much room is
 * left above depends on a page header whose description wraps at a different
 * height on every viewport, and no `calc()` can see that. Callers pair the
 * measured value with a CSS fallback close enough that the first paint does
 * not visibly jump.
 *
 * `clipped` reports content past the right edge, for the panes that can be
 * narrower than their content — a clipped column with no visible boundary is
 * indistinguishable from a column that does not exist.
 */
export function useScrollPane<T extends HTMLElement>({
  /** Bottom breathing room, so a pane's border is not flush to the window. */
  gutter = 20,
  /** Below this a pane is too short to be worth filling. */
  minHeight = 320,
  /**
   * Panes only make sense where the shell is already a fixed-height column —
   * `lg` and up. Narrower than that the page scrolls as one document, and
   * pinning a pane to the window would strand it in a 320px box halfway down.
   */
  from = 1024,
}: { gutter?: number; minHeight?: number; from?: number } = {}) {
  const ref = useRef<T>(null)
  const [maxHeight, setMaxHeight] = useState<string>()
  const [clipped, setClipped] = useState(false)

  const measureClip = useCallback(() => {
    const node = ref.current
    if (!node) return
    setClipped(node.scrollWidth - node.clientWidth - node.scrollLeft > 1)
  }, [])

  const measureHeight = useCallback(() => {
    const node = ref.current
    if (!node) return
    if (window.innerWidth < from) {
      setMaxHeight(undefined)
      measureClip()
      return
    }
    // Valid on every later call because sizing the panes is what stops the
    // page behind them from scrolling, which keeps this rect where it is.
    const available =
      window.innerHeight - node.getBoundingClientRect().top - gutter
    setMaxHeight(`${Math.max(minHeight, Math.round(available))}px`)
    measureClip()
  }, [from, gutter, minHeight, measureClip])

  useEffect(() => {
    const node = ref.current
    if (!node) return

    measureHeight()
    const observer = new ResizeObserver(measureClip)
    observer.observe(node)
    node.addEventListener("scroll", measureClip, { passive: true })
    window.addEventListener("resize", measureHeight)

    return () => {
      observer.disconnect()
      node.removeEventListener("scroll", measureClip)
      window.removeEventListener("resize", measureHeight)
    }
  }, [measureClip, measureHeight])

  return { ref, maxHeight, clipped }
}
