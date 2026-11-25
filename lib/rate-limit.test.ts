// Run with: node --test lib/rate-limit.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"

import { checkRateLimit } from "./rate-limit.ts"

test("the eleventh solve in a minute is refused, with a retry time", () => {
  process.env.RATE_LIMIT_SOLVES_PER_MINUTE = "10"
  process.env.RATE_LIMIT_SOLVES_PER_HOUR = "60"

  for (let i = 0; i < 10; i++) {
    assert.equal(checkRateLimit("caller-a").allowed, true)
  }
  const verdict = checkRateLimit("caller-a")
  assert.equal(verdict.allowed, false)
  if (!verdict.allowed) assert.ok(verdict.retryAfterSeconds >= 1)

  // Another caller is not charged for it.
  assert.equal(checkRateLimit("caller-b").allowed, true)
})

test("a blank limit variable falls back to the default rather than disabling", () => {
  process.env.RATE_LIMIT_SOLVES_PER_MINUTE = ""
  process.env.RATE_LIMIT_SOLVES_PER_HOUR = ""

  for (let i = 0; i < 10; i++) checkRateLimit("caller-c")
  assert.equal(checkRateLimit("caller-c").allowed, false)
})
