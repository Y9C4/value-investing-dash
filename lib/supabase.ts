/**
 * Server-side reads of the Supabase snapshot tables.
 *
 * Plain PostgREST over `fetch` rather than `@supabase/supabase-js`, for one
 * reason: Next's persistent cache and `revalidateTag` are properties of
 * `fetch`, and the client library owns its own request pipeline. Going direct
 * keeps the screener on exactly the caching contract it had when it read the
 * Python service.
 *
 * The key here is the publishable (anon) key, which is safe to hold but is not
 * what makes this safe — row-level security is. Migration
 * `20260904000000_deploy_readiness` grants `anon` SELECT on the two snapshot
 * tables and nothing else, so this credential can render the site and cannot
 * reach a price, a statement or a verdict row directly. The service role key
 * never leaves the Python service.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY)
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  }
}

/**
 * One row from a snapshot table, or null for anything that is not a hit.
 *
 * Null rather than throwing on every failure mode — unconfigured, unreachable,
 * empty, malformed — because every caller's answer to all four is the same:
 * fall through to the next source. A snapshot is a fast path, never the only
 * one.
 *
 * `cache: "force-cache"` is required, not decorative: Next declines to cache a
 * request carrying an `Authorization` header unless caching is asked for
 * explicitly, and without it the screener would re-read Supabase on every
 * visitor instead of once an hour.
 *
 * The retry is the interesting part. An empty result is a legitimate 200, so
 * Next caches it like any other, and a single request that lands while the
 * table is being populated pins "there is no snapshot" in front of every
 * visitor for the whole revalidation window. Nothing clears it either: the tag
 * is only purged by the /data proxy routes, and in production the snapshot is
 * written by Cloud Scheduler calling the service directly, with no Next in the
 * path to purge anything. So an empty hit is checked once against the origin.
 * It costs a round trip on a path that was about to fall back anyway, and it
 * turns an hour of stale emptiness into one slightly slower render.
 */
export async function selectSnapshotRow<T>(
  table: string,
  query: string,
  next: { revalidate: number; tags: string[] }
): Promise<T | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null

  const target = `${SUPABASE_URL}/rest/v1/${table}?${query}&limit=1`

  try {
    const response = await fetch(target, {
      headers: headers(SUPABASE_KEY),
      cache: "force-cache",
      next,
    })

    if (!response.ok) return null

    const rows = (await response.json()) as T[]
    if (Array.isArray(rows) && rows.length > 0) return rows[0]

    const fresh = await fetch(target, {
      headers: headers(SUPABASE_KEY),
      cache: "no-store",
    })

    if (!fresh.ok) return null

    const freshRows = (await fresh.json()) as T[]
    return Array.isArray(freshRows) && freshRows.length > 0 ? freshRows[0] : null
  } catch {
    return null
  }
}

/**
 * Many rows from a table the anon key may read.
 *
 * Separate from `selectSnapshotRow` rather than a generalisation of it, because
 * the empty-result retry there is wrong here. That retry exists because a
 * snapshot table has exactly one row and an empty read means "not written yet",
 * which is a transient state worth paying a round trip to escape. An empty
 * price series means the ticker has no stored history, which is permanent and
 * costs a second request to learn twice.
 */
export async function selectRows<T>(
  table: string,
  query: string,
  next: { revalidate: number; tags?: string[] }
): Promise<T[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: headers(SUPABASE_KEY),
      cache: "force-cache",
      next,
    })

    if (!response.ok) return null

    const rows = (await response.json()) as T[]
    return Array.isArray(rows) ? rows : null
  } catch {
    return null
  }
}
