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
