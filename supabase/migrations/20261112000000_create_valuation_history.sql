-- A dated archive of every valuations run.
--
-- `valuations` is keyed on (ticker, method) and is cleared and rewritten on
-- every run, so until now each verdict overwrote the one before it and the
-- product kept no record of what it had said. That made a forward track record
-- impossible: there was nothing to compare against later returns. This table
-- is that record, appended to by the same run that rewrites `valuations`.
--
-- `as_of` is the market date of the closes the run priced against, not the
-- wall-clock time, so a run at 1am and a rerun at 9am the same day both land on
-- the same trading day. A rerun replaces that day's rows rather than adding to
-- them (see backfill.valuations), so a model that stopped applying between the
-- two runs loses its row here too.

create table if not exists public.valuation_history (
  as_of             date not null,
  ticker            text not null,
  method            text not null,
  fair_value        numeric(18, 4) not null,
  margin_of_safety  numeric(10, 6) not null,
  confidence        numeric(6, 4)  not null,
  price_at_calc     numeric(14, 4) not null,
  computed_at       timestamptz not null default now(),
  primary key (as_of, ticker, method)
);

create index if not exists valuation_history_ticker_idx
  on public.valuation_history (ticker, as_of desc);

comment on table public.valuation_history is
  'Every valuations run, archived by market date. Same columns as valuations; written by backfill.valuations(). Read by the backtest, never by the site.';

-- Service role only, like every other ingest table.
alter table public.valuation_history enable row level security;

-- Seed with whatever the last run left behind, so the archive starts from the
-- current verdicts rather than from the next scheduled run.
insert into public.valuation_history (
  as_of, ticker, method, fair_value, margin_of_safety, confidence,
  price_at_calc, computed_at
)
select
  coalesce(
    (select max(p.date) from public.daily_close_prices p
      where p.date <= v.computed_at::date),
    v.computed_at::date
  ),
  v.ticker, v.method, v.fair_value, v.margin_of_safety, v.confidence,
  v.price_at_calc, v.computed_at
from public.valuations v
on conflict (as_of, ticker, method) do nothing;
