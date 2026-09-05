/**
 * Per-caller rate limiting for the optimiser.
 *
 * This has to live here rather than in the Python service. Once every solve
 * arrives through this app's route handler, the service sees one client — the
 * proxy — on every request, and a per-IP limit there would be a limit on the
 * whole world at once. The service enforces the other half of the design: a
 * global budget denominated in solve-seconds, which is the resource that is
 * actually scarce.
 *
 * The state is a `Map` in one serverless instance's memory, which is worth
 * being honest about: Vercel may run several instances, so the effective limit
 * is the configured one times however many are warm, and a deploy resets it. It
 * is sized to stop a loop pointed at the endpoint, not a distributed attacker,
 * and Vercel's own DDoS protection sits in front of it. A shared store (Redis,
 * Upstash) is what this would become if it ever needed to be exact — for a
 * portfolio project the dependency costs more than the precision is worth.
 */

/**
 * Requests per window, per caller. Overridable so the sweep can run clean.
 *
 * `??` is not enough here, and the difference is the whole limiter. A variable
 * declared in `.env` or on Vercel but left blank arrives as `""`, which is not
 * null, so `??` passes it through and `Number("")` is 0 — and 0 on both windows
 * is the documented way to turn the limiter *off*. A key present and empty is
 * the most likely shape of a deployment mistake, so it has to read as "unset"
 * rather than as "disabled".
 */
function limit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

function limits(): { perMinute: number; perHour: number } {
  return {
    perMinute: limit("RATE_LIMIT_SOLVES_PER_MINUTE", 10),
    perHour: limit("RATE_LIMIT_SOLVES_PER_HOUR", 60),
  }
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

// Bounded so a spray of forged `x-forwarded-for` values cannot grow the map
// without limit. Eviction is oldest-first, which is the right victim: a key
// with no recent hits is not being limited anyway.
const MAX_TRACKED_CALLERS = 10_000

const hits = new Map<string, number[]>()

/**
 * Who to charge for this request.
 *
 * The first entry of `x-forwarded-for` is the client as seen by the edge; the
 * rest are proxies. Spoofable in principle, which is fine — a caller who
 * rotates the header to evade this still runs into the solver's global
 * compute budget, which no header can move.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? "unknown"
}

export type RateLimitVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; detail: string }

/**
 * Record a request and say whether it is over the line.
 *
 * Both windows are read off one timestamp log rather than two counters, so a
 * burst of ten in a second and a steady ten a minute are told apart.
 */
export function checkRateLimit(key: string): RateLimitVerdict {
  const { perMinute, perHour } = limits()
  if (perMinute <= 0 && perHour <= 0) return { allowed: true }

  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((at) => now - at < HOUR_MS)

  const inLastMinute = recent.filter((at) => now - at < MINUTE_MS)

  const over =
    (perMinute > 0 && inLastMinute.length >= perMinute
      ? {
          oldest: inLastMinute[0]!,
          windowMs: MINUTE_MS,
          limit: perMinute,
          per: "minute",
        }
      : null) ??
    (perHour > 0 && recent.length >= perHour
      ? { oldest: recent[0]!, windowMs: HOUR_MS, limit: perHour, per: "hour" }
      : null)

  if (over) {
    // The refused request is not logged: otherwise a caller hammering the
    // endpoint would keep pushing their own window forward and never recover.
    hits.set(key, recent)
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((over.windowMs - (now - over.oldest)) / 1000)
    )
    return {
      allowed: false,
      retryAfterSeconds,
      detail:
        `Too many optimisations: the limit is ${over.limit} per ${over.per}. ` +
        `Each solve is real convex optimisation on a small free-tier machine. ` +
        `Try again in ${retryAfterSeconds} seconds.`,
    }
  }

  recent.push(now)
  hits.set(key, recent)

  if (hits.size > MAX_TRACKED_CALLERS) {
    const oldest = hits.keys().next()
    if (!oldest.done) hits.delete(oldest.value)
  }

  return { allowed: true }
}
