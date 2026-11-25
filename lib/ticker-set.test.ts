import assert from "node:assert/strict"
import { test } from "node:test"

import { decodeTickerSet, encodeTickerSet } from "./ticker-set.ts"

test("a set round-trips, and is refused once the index changes", () => {
  const universe = ["MSFT", "AAPL", "KO"]
  const token = encodeTickerSet(["KO", "AAPL"], universe)!
  assert.deepEqual(decodeTickerSet(token, [...universe].reverse()), {
    tickers: ["AAPL", "KO"],
    stale: false,
  })
  assert.equal(decodeTickerSet(token, ["MSFT", "AAPL", "OKTA"]).stale, true)
  assert.equal(encodeTickerSet(["OKTA"], universe), null)
})
