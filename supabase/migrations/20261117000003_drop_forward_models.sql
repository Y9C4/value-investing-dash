-- Retire the five forward (fair-value) models.
--
-- DDM, FCFE, FCFF, RIM and comps priced each stock as a multiple of its price
-- levered by 1/(k - g), so a lumpy cash-flow year or a low cost of equity sent
-- margins to +700% while RIM called the median stock 66% overvalued. The
-- backtest had already found their levels meaningless (backtests.md §13). The
-- site now reads value only as the reverse-DCF spread in warehouse.signals: the
-- return today's price implies minus the return the stock's risk requires.
--
-- discount_rates is rebuilt from warehouse.inputs so the stock page shows the
-- exact rates the implied returns are measured against, instead of the forward
-- models' separately clamped ones.

-- ---------------------------------------------------------------------------
-- Drop, dependents first
-- ---------------------------------------------------------------------------

drop view if exists public.screener;
drop materialized view if exists warehouse.stock_snapshot;
drop materialized view if exists warehouse.forward_valuations;
drop view if exists warehouse.discount_rates;
drop table if exists warehouse.valuation_history;
drop function if exists warehouse.two_stage_pv(double precision, double precision, double precision, double precision, int);
drop function if exists warehouse.residual_income_value;

-- ---------------------------------------------------------------------------
-- Rebuild
-- ---------------------------------------------------------------------------

-- The rates the signal's implied returns are compared with: CAPM cost of
-- equity for RIM and shareholder yield, WACC for FCFF and revenue.
create view warehouse.discount_rates as
select
  ticker,
  rf,
  ke,
  wacc,
  kd,
  tax,
  1 - debt_weight as equity_weight
from warehouse.inputs;

comment on view warehouse.discount_rates is
  'Per-ticker required returns from warehouse.inputs, the same figures warehouse.signals measures implied returns against.';

-- One row per stock in the universe with a price, shaped for the screener and
-- the stock page. public.screener serves it.
create materialized view warehouse.stock_snapshot as
select
  i.ticker,
  coalesce(i.name, i.ticker)                                      as name,
  coalesce(i.sector, 'Unclassified')                              as sector,
  i.as_of,
  i.price,
  i.price * coalesce(t.shares, i.shares) / 1e9                    as market_cap_bn,
  i.beta_252                                                      as beta,
  i.realised_return,
  i.volatility,
  case when t.ttm_diluted_eps > 0 then i.price / t.ttm_diluted_eps end as pe_ratio,
  coalesce(d.trailing / nullif(i.price, 0), 0)                    as dividend_yield,
  jsonb_build_object(
    'risk_free', dr.rf,
    'cost_of_equity', dr.ke,
    'wacc', dr.wacc,
    'cost_of_debt', dr.kd,
    'equity_weight', dr.equity_weight,
    'tax_rate', dr.tax
  )                                                               as discount_rates,
  jsonb_build_object(
    'value', s.value,
    'momentum', s.momentum,
    'surprise', s.surprise,
    'surprise_date', s.surprise_date,
    'value_rank', s.value_rank,
    'momentum_rank', s.momentum_rank,
    'surprise_rank', s.surprise_rank,
    'implied_returns', jsonb_build_object(
      'fcff', s.r_fcff, 'rim', s.r_rim, 'revenue', s.r_rev, 'shareholder_yield', s.r_shy),
    'required_return_equity', s.ke,
    'required_return_firm', s.wacc
  )                                                               as signals
from warehouse.inputs i
left join warehouse.fundamentals_ttm t using (ticker)
left join warehouse.dividend_stats d using (ticker)
left join warehouse.discount_rates dr using (ticker)
left join warehouse.signals s using (ticker)
where i.price is not null;

create unique index stock_snapshot_ticker_idx on warehouse.stock_snapshot (ticker);

create view public.screener
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
  discount_rates,
  signals
from warehouse.stock_snapshot;

comment on view public.screener is
  'One row per stock in the universe: price, risk statistics, the required returns, and the signal with its four implied returns (backtests.md §16). Refreshed by warehouse.refresh().';

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
grant select on warehouse.discount_rates to service_role;
grant select on public.screener to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refresh
-- ---------------------------------------------------------------------------

create or replace function warehouse.refresh()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_as_of date;
  started timestamptz := clock_timestamp();
begin
  refresh materialized view concurrently warehouse.market;
  refresh materialized view concurrently warehouse.price_stats;
  refresh materialized view concurrently warehouse.inputs;
  refresh materialized view concurrently warehouse.signals;
  refresh materialized view concurrently warehouse.stock_snapshot;

  select as_of into v_as_of from warehouse.market;
  if v_as_of is null then
    return jsonb_build_object('as_of', null, 'stocks', 0);
  end if;

  delete from warehouse.signal_history where as_of = v_as_of;
  insert into warehouse.signal_history (
    as_of, ticker, price, alpha_fcff, alpha_rim, alpha_rev, alpha_shy,
    value, momentum, surprise, value_rank, momentum_rank, surprise_rank)
  select v_as_of, ticker, price, alpha_fcff, alpha_rim, alpha_rev, alpha_shy,
         value, momentum, surprise, value_rank, momentum_rank, surprise_rank
  from warehouse.signals
  where price is not null;

  return jsonb_build_object(
    'as_of', v_as_of,
    'stocks', (select count(*) from warehouse.stock_snapshot),
    'signals', jsonb_build_object(
      'value', (select count(value) from warehouse.signals),
      'momentum', (select count(momentum) from warehouse.signals),
      'surprise', (select count(surprise) from warehouse.signals)),
    'duration_seconds', round(extract(epoch from clock_timestamp() - started)::numeric, 1)
  );
end
$$;

comment on function warehouse.refresh() is
  'Rebuilds every materialised layer in dependency order and archives the day''s signal. Called by python-api/pipeline.py after each ingest.';

revoke execute on function warehouse.refresh() from public, anon, authenticated;
grant execute on function warehouse.refresh() to service_role;
