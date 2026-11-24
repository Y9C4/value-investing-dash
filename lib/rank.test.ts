// Run with: node --test lib/rank.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

import { cumeDist, median, quintile } from "./rank.ts"

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
