-- The serving layer: what the site and the optimiser read (backtests.md §17).
--
-- `public` is the only schema PostgREST exposes, so it is the API. After this
-- migration it holds no provider data and no computation: three read-only
-- views over the warehouse, plus the two tables the service itself writes
-- (job_runs, frontier_snapshot).
--
--   screener        one row per stock: price, statistics, forward verdicts,
--                   discount rates and the signal. Replaces universe_snapshot,
--                   which was a JSON blob assembled in Python.
--   market_summary  one row: as-of date, rates, factor premia, the index.
--   stock_prices    daily closes, for the chart and the optimiser.
--
-- The views are security_invoker, so a reader needs SELECT on what is beneath
-- them. The browser-safe roles are granted exactly that and nothing more: two
-- materialised views and three columns of raw.daily_prices. Neither `raw` nor
-- `warehouse` is exposed through the API, so those grants are reachable only
-- through these views.

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

create or replace view public.screener
with (security_invoker = true) as
select
  ticker,
  name,
  sector,
  as_of,
  price,
  market_cap_bn,
  beta,
  realised_return,
  volatility,
  pe_ratio,
  dividend_yield,
  verdicts,
  consensus,
  discount_rates,
  signals
from warehouse.stock_snapshot;

comment on view public.screener is
  'One row per stock in the universe: price, risk statistics, the five forward verdicts with their consensus, the discount rates, and the signal (backtests.md §16). Refreshed by warehouse.refresh().';

create or replace view public.market_summary
with (security_invoker = true) as
select
  as_of,
  risk_free_rate,
  short_rate,
  prem_mkt,
  factors_through,
  index_ticker,
  index_close,
  index_change,
  market_return
from warehouse.market;

comment on view public.market_summary is
  'One row: the as-of date, the 10-year yield the models discount at, the 13-week rate the optimiser uses, the market premium, and the index level.';

create or replace view public.stock_prices
with (security_invoker = true) as
select ticker, date, close
from raw.daily_prices;

comment on view public.stock_prices is
  'Daily split-adjusted closes per ticker, including ^GSPC, ^TNX and ^IRX.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

grant usage on schema warehouse to anon, authenticated;
grant usage on schema raw to anon, authenticated;

grant select on warehouse.stock_snapshot, warehouse.market to anon, authenticated;
grant select (ticker, date, close) on raw.daily_prices to anon, authenticated;

grant select on public.screener, public.market_summary, public.stock_prices
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Carry the archive over, then retire the old tables
-- ---------------------------------------------------------------------------

insert into warehouse.valuation_history (
  as_of, ticker, method, fair_value, margin_of_safety, confidence,
  price_at_calc, computed_at
)
select as_of, ticker, method, fair_value, margin_of_safety, confidence,
       price_at_calc, computed_at
from public.valuation_history
on conflict (as_of, ticker, method) do nothing;

-- Views first: they depend on the tables below.
drop view if exists public.daily_excess_returns;
drop view if exists public.daily_log_returns;
drop view if exists public.average_risk_free_rate;
drop view if exists public.ttm_fundamentals;
drop view if exists public.latest_close_prices;

-- Provider data now lands in raw.*; derived data is computed in warehouse.*.
drop table if exists public.daily_close_prices;
drop table if exists public.quarterly_fundamentals;
drop table if exists public.company_profile;
drop table if exists public.dividend_history;
drop table if exists public.factor_returns;
drop table if exists public.valuations;
drop table if exists public.ticker_statistics;
drop table if exists public.universe_snapshot;
drop table if exists public.valuation_history;

-- ---------------------------------------------------------------------------
-- job_runs: the pipeline's stages
-- ---------------------------------------------------------------------------
--
-- Prices and factors daily, statements weekly, then the warehouse refresh.
-- Earlier rows are renamed onto the stage that now does their work, so the
-- freshness readout keeps its history.

alter table public.job_runs drop constraint if exists job_runs_job_check;

update public.job_runs set job = 'prices'       where job = 'daily_close_prices';
update public.job_runs set job = 'fundamentals' where job in ('quarterly_fundamentals', 'company_profile');
update public.job_runs set job = 'refresh'      where job = 'valuations';

alter table public.job_runs add constraint job_runs_job_check
  check (job in ('prices', 'factor_returns', 'fundamentals', 'refresh'));

comment on table public.job_runs is
  'One row per pipeline stage run. Written by python-api/pipeline.py; read for the freshness strip.';
