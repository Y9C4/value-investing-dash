-- A record of every scheduled ingest, so the dashboard can say when its
-- numbers were gathered rather than only when they were computed.
--
-- The distinction matters. `universe_snapshot.computed_at` says when the
-- valuation models last ran; it says nothing about whether the prices and
-- statements they ran over were fetched this morning or a fortnight ago. A
-- valuations pass over stale inputs produces a fresh timestamp and stale
-- verdicts, which is exactly the failure a freshness indicator exists to
-- catch.
--
-- Scheduled ingest only. The default-frontier precompute is deliberately not
-- recorded here: it is a derived solve over data this table already covers,
-- and mixing "we fetched new prices" with "we re-solved a QP" would make the
-- freshest row in the table meaningless.

create table if not exists public.job_runs (
  id               bigint generated always as identity primary key,
  -- Closed set on purpose. A typo here would silently create a phantom job
  -- that reads as "never run" for the real one, and the stages are stable
  -- enough that adding one is worth a migration.
  job              text not null check (
                     job in (
                       'daily_close_prices',
                       'factor_returns',
                       'quarterly_fundamentals',
                       'company_profile',
                       'valuations'
                     )
                   ),
  -- Three states, not two. The backfills are deliberately partial-tolerant —
  -- a handful of tickers failing out of 493 still refreshes the table — and
  -- collapsing that into "succeeded" would hide a provider outage that is
  -- eating a tenth of the universe every night.
  status           text not null check (status in ('succeeded', 'partial', 'failed')),
  started_at       timestamptz not null,
  finished_at      timestamptz not null default now(),
  duration_seconds numeric(10, 1),
  rows_upserted    integer,
  tickers_failed   integer,
  -- The stage's own error list, verbatim. Kept out of the columns above
  -- because it is for reading after the fact, never for querying.
  detail           jsonb
);

comment on table public.job_runs is
  'One row per scheduled ingest run. Written by api/backfill.py; read for the freshness strip.';

-- Every read is "the latest run of job X", which is this index exactly.
create index if not exists job_runs_job_finished_idx
  on public.job_runs (job, finished_at desc);

-- The only shape anything actually reads.
create or replace view public.latest_job_runs as
select distinct on (job)
  job,
  status,
  started_at,
  finished_at,
  duration_seconds,
  rows_upserted,
  tickers_failed
from public.job_runs
order by job, finished_at desc;

comment on view public.latest_job_runs is
  'Most recent run of each ingest stage.';

-- ---------------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------------
--
-- Readable by the browser-safe key, unlike every other table outside the two
-- snapshots. That is the point of the table: operational metadata with no
-- market data in it, so the site can state its own freshness without a
-- backfill having to run first to bake it into a payload. Writes still belong
-- to the service role alone — there is no insert policy.

alter table public.job_runs enable row level security;

drop policy if exists "anon reads job runs" on public.job_runs;
create policy "anon reads job runs"
  on public.job_runs for select to anon, authenticated using (true);

grant select on public.job_runs to anon, authenticated;

-- Without this the view would run as its owner and hand out whatever the
-- table's policies refuse. Same setting as every other view in the schema.
alter view public.latest_job_runs set (security_invoker = true);
grant select on public.latest_job_runs to anon, authenticated;
