/**
 * Percentile rank as cumulative distribution: the share of values at or below
 * each one, in (0, 1]. Ties share the highest rank of their group. This is
 * Postgres's `cume_dist()`, which `warehouse.signals` ranks every component
 * with, so a rank computed here and one computed there agree.
 *
 * No imports, so `node --test lib/rank.test.ts` can run it directly.
 */
export function cumeDist<K>(entries: [K, number][]): Map<K, number> {
  const sorted = [...entries].sort((a, b) => a[1] - b[1])
  const ranks = new Map<K, number>()
  const n = sorted.length
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j += 1
    for (let k = i; k <= j; k += 1) ranks.set(sorted[k][0], (j + 1) / n)
    i = j + 1
  }
  return ranks
}

/**
 * Which fifth of the cross-section a percentile falls in, 5 being the top:
 * the quintile sort of Fama & French, and of the backtest's Q5 − Q1 test.
 * Breakpoints move with the data because the percentile does.
 */
export function quintile(percentile: number): 1 | 2 | 3 | 4 | 5 {
  if (percentile > 0.8) return 5
  if (percentile > 0.6) return 4
  if (percentile > 0.4) return 3
  if (percentile > 0.2) return 2
  return 1
}

/** The median of the values that were measured; null when none were. */
export function median(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/** The q-quantile of sorted values, linear between order statistics (R type 7). */
function quantileSorted(xs: number[], q: number): number {
  const h = (xs.length - 1) * q
  const lo = Math.floor(h)
  return xs[lo] + (h - lo) * ((xs[Math.ceil(h)] ?? xs[lo]) - xs[lo])
}

export type Bin = { lo: number; hi: number; count: number }

/**
 * Equal-width bins with the Freedman–Diaconis width, 2·IQR·n^(−1/3) (1981),
 * over the 1st–99th percentile range; values outside it fall into the edge
 * bins, so every observation is counted and no single outlier sets the scale.
 * Edges are aligned to zero so a sign change is always a bin edge.
 */
export function histogram(values: number[]): Bin[] {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (xs.length < 2) return []
  const iqr = quantileSorted(xs, 0.75) - quantileSorted(xs, 0.25)
  const width = (2 * iqr) / Math.cbrt(xs.length)
  if (!(width > 0)) return [{ lo: xs[0], hi: xs[xs.length - 1], count: xs.length }]
  const start = Math.floor(quantileSorted(xs, 0.01) / width)
  const end = Math.ceil(quantileSorted(xs, 0.99) / width)
  const bins: Bin[] = []
  for (let k = start; k < Math.max(end, start + 1); k += 1) {
    bins.push({ lo: k * width, hi: (k + 1) * width, count: 0 })
  }
  for (const x of xs) {
    const i = Math.min(bins.length - 1, Math.max(0, Math.floor(x / width) - start))
    bins[i].count += 1
  }
  return bins
}
