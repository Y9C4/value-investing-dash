// Run with: node --test lib/format.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

import { formatMarketCap, formatPct, formatPp, formatSignedPct } from "./format.ts"

test("formatPp: true minus, no sign at zero, dash when missing", () => {
  assert.equal(formatPp(0.015), "+1.5 pp")
  assert.equal(formatPp(-0.0182), "−1.8 pp")
  assert.equal(formatPp(-0.0004), "0.0 pp") // rounds to zero: no "−0.0"
  assert.equal(formatPp(null), "—")
  assert.equal(formatPp(Number.NaN), "—")
})

test("formatPct and formatSignedPct", () => {
  assert.equal(formatPct(0.0674), "6.7%")
  assert.equal(formatSignedPct(0.0473, 2), "+4.73%")
  assert.equal(formatSignedPct(-0.2), "−20.0%")
  assert.equal(formatSignedPct(undefined), "—")
})

test("formatMarketCap switches to trillions before $1000B", () => {
  assert.equal(formatMarketCap(999.6), "$1.00T")
  assert.equal(formatMarketCap(743.2), "$743B")
  assert.equal(formatMarketCap(5.4), "$5.4B")
})
