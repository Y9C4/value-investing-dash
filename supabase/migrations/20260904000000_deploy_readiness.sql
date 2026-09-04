-- Everything the deployment needs from the database, in one batch.
--
-- Applied before either service ships, because the live database is shared
-- with the running dev servers and a change landing between two deploys would
-- break whichever half went first. Every statement here is additive or
-- invisible to the code running today: the Python service authenticates with
-- the service role key, which bypasses row-level security entirely, and the
-- anon key had no consumer before this migration.

-- ---------------------------------------------------------------------------
-- Snapshot tables: the read path that lets the site work while the solver
-- is scaled to zero.
-- ---------------------------------------------------------------------------

-- The scored universe, exactly as `api/universe.py:scored()` returns it.
--
-- Stored as one jsonb blob rather than normalised because it is a render
-- payload, not a queryable fact: assembling it costs five full-table reads and
-- ~35s, and the shaping logic already exists in Python. Splitting it into
-- columns would duplicate that shaping in TypeScript and gain nothing — no
-- caller filters it server-side.
create table if not exists public.universe_snapshot (
  -- Single row, enforced. A history of screener payloads would grow by ~350KB
  -- a day for data nothing reads twice.
  id          int primary key default 1 check (id = 1),
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);

comment on table public.universe_snapshot is
  'Single-row render payload for the screener. Written by backfill.valuations().';

-- The default-constraint frontier solves, precomputed.
--
-- Keyed rather than single-row: the full-index default is what the screener's
-- primary call-to-action asks for, but a small screened set solved under the
-- same defaults is worth keeping too, and both are pure functions of the
-- prices plus the constraint set.
create table if not exists public.frontier_snapshot (
  -- sha256 over the sorted ticker list and the resolved constraints.
  cache_key   text primary key,
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);

comment on table public.frontier_snapshot is
  'Precomputed frontier solves, keyed by universe fingerprint and constraints.';

-- ---------------------------------------------------------------------------
-- The price index.
-- ---------------------------------------------------------------------------

-- The primary key is (date, ticker), so every read filtered by ticker goes
-- through the single-column ticker index and then out to the heap for the
-- close. Both hot readers are ticker-first:
--
--   market.prices_df       .in_("ticker", chunk).order("date")
--   latest_close_prices    distinct on (ticker) ... order by ticker, date desc
--
-- INCLUDE (close) makes both index-only scans. This is the cheapest available
-- fix for the cold read that dominates a small solve.
create index if not exists daily_close_prices_ticker_date_idx
  on public.daily_close_prices (ticker, date desc) include (close);

-- ---------------------------------------------------------------------------
-- Row-level security.
-- ---------------------------------------------------------------------------
--
-- Nothing reads these tables with the anon key today, so enabling RLS with no
-- policy denies a request that is never made. It is a precondition for the
-- snapshot read path below, which is the first thing to use the anon key at
-- all, and it clears every finding Supabase's security advisor raises.

alter table public.daily_close_prices     enable row level security;
alter table public.company_profile        enable row level security;
alter table public.quarterly_fundamentals enable row level security;
alter table public.dividend_history       enable row level security;
alter table public.factor_returns         enable row level security;
alter table public.valuations             enable row level security;
alter table public.ticker_statistics      enable row level security;
alter table public.universe_snapshot      enable row level security;
alter table public.frontier_snapshot      enable row level security;

-- Read-only, and only the two snapshot tables. The browser-safe key can render
-- the site and nothing else; every write still goes through the service role.
drop policy if exists "anon reads universe snapshot" on public.universe_snapshot;
create policy "anon reads universe snapshot"
  on public.universe_snapshot for select to anon, authenticated using (true);

drop policy if exists "anon reads frontier snapshot" on public.frontier_snapshot;
create policy "anon reads frontier snapshot"
  on public.frontier_snapshot for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- View security.
-- ---------------------------------------------------------------------------
--
-- A Postgres view runs as its owner by default, so a view over an RLS-enabled
-- table hands out exactly what the table refuses. `security_invoker` makes the
-- caller's policies apply, which is the only setting under which the RLS above
-- means anything.
alter view public.daily_log_returns      set (security_invoker = true);
alter view public.daily_excess_returns   set (security_invoker = true);
alter view public.average_risk_free_rate set (security_invoker = true);
alter view public.ttm_fundamentals       set (security_invoker = true);
alter view public.latest_close_prices    set (security_invoker = true);
