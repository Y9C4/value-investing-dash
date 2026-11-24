// Run with: node --test lib/rank.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

import { cumeDist, histogram, median, quintile } from "./rank.ts"

test("cumeDist matches Postgres cume_dist, ties included", () => {
  const ranks = cumeDist([
    ["a", 3],
    ["b", 1],
    ["c", 3],
    ["d", 2],
    ["e", 5],
  ])
  assert.equal(ranks.get("b"), 0.2)
  assert.equal(ranks.get("d"), 0.4)
  assert.equal(ranks.get("a"), 0.8)
  assert.equal(ranks.get("c"), 0.8)
  assert.equal(ranks.get("e"), 1)
})

test("quintiles split a uniform cross-section into equal fifths", () => {
  const entries: [number, number][] = Array.from({ length: 500 }, (_, i) => [i, Math.sin(i) * 100])
  const counts = [0, 0, 0, 0, 0]
  for (const p of cumeDist(entries).values()) counts[quintile(p) - 1] += 1
  assert.deepEqual(counts, [100, 100, 100, 100, 100])
})

test("median skips nulls and averages the middle pair", () => {
  assert.equal(median([3, null, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([null]), null)
})

test("histogram counts every value, puts zero on an edge, and folds the tails in", () => {
  const values = Array.from({ length: 1000 }, (_, i) => Math.tan(((i + 0.5) / 1000 - 0.5) * 3))
  const bins = histogram(values)
  assert.equal(bins.reduce((n, b) => n + b.count, 0), 1000)
  assert.ok(bins.some((b) => Math.abs(b.lo) < 1e-12))
  // tan has huge tails; without the 1–99% range the bins would number in thousands.
  assert.ok(bins.length < 60, `${bins.length} bins`)
  assert.deepEqual(histogram([1]), [])
})
