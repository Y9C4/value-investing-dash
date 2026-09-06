import UNIVERSE from "@/python-api/data/sp500_tickers.json"

/**
 * Compact URL encoding for a screened set of tickers.
 *
 * `?tickers=A,AAPL,…` reached ~3KB, and Next echoes the URL into the request
 * line, `Next-Url` *and* `Referer` — ~9.2KB of Node's 16KB header budget, so
 * ordinary cookies pushed it into a 431 that the browser reports as a dead
 * page rather than as anything to do with the screen.
 *
 * The universe is known and fixed, so the set is one bit per constituent: 503
 * bits, 84 base64 characters, and the whole index costs the same as one stock.
 *
 * The token carries a fingerprint of the universe it was built against,
 * because the bit positions shift when a constituent changes. A stale token is
 * refused rather than decoded into a different portfolio.
 */

// Sorted rather than trusting file order, so the bit positions depend only on
// which tickers exist and never on how the JSON happens to be maintained.
export const TICKER_UNIVERSE: readonly string[] = [...UNIVERSE].sort()

const TOKEN_VERSION = "v1"

/** FNV-1a. Not cryptographic — this only needs to notice that a list changed. */
function fingerprint(values: readonly string[]): string {
  let hash = 0x811c9dc5
  for (const value of values.join(",")) {
    hash ^= value.charCodeAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

const UNIVERSE_FINGERPRINT = fingerprint(TICKER_UNIVERSE)
const INDEX_OF = new Map(TICKER_UNIVERSE.map((ticker, i) => [ticker, i]))

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * Pack `tickers` into a URL-safe token, or return null when the set contains a
 * name outside the universe and therefore has no bit to live in. Callers fall
 * back to the plain `?tickers=` form, which is only ever reached by small
 * hand-built sets — exactly the case the query string handles comfortably.
 */
export function encodeTickerSet(tickers: readonly string[]): string | null {
  const bytes = new Uint8Array(Math.ceil(TICKER_UNIVERSE.length / 8))

  for (const ticker of tickers) {
    const index = INDEX_OF.get(ticker.trim().toUpperCase())
    if (index === undefined) return null
    bytes[index >> 3] |= 1 << (index & 7)
  }

  return `${TOKEN_VERSION}.${UNIVERSE_FINGERPRINT}.${toBase64Url(bytes)}`
}

export type DecodedTickerSet =
  | { tickers: string[]; stale: false }
  /** The universe moved under a shared link; the caller must not guess. */
  | { tickers: []; stale: true }

export function decodeTickerSet(token: string): DecodedTickerSet {
  const [version, stamp, payload] = token.split(".")
  if (version !== TOKEN_VERSION || !stamp || !payload) {
    return { tickers: [], stale: true }
  }
  if (stamp !== UNIVERSE_FINGERPRINT) return { tickers: [], stale: true }

  const bytes = fromBase64Url(payload)
  if (!bytes) return { tickers: [], stale: true }

  const tickers = TICKER_UNIVERSE.filter(
    (_, index) => (bytes[index >> 3] & (1 << (index & 7))) !== 0
  )
  return { tickers, stale: false }
}

/**
 * The `/portfolio` href for a screened set: a fixed-size token when the set is
 * representable, the legacy query string otherwise.
 */
export function portfolioHref(tickers: readonly string[]): string {
  const token = encodeTickerSet(tickers)
  return token
    ? `/portfolio?set=${token}`
    : `/portfolio?tickers=${tickers.join(",")}`
}
