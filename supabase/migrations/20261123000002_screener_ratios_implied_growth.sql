-- Classic ratios and implied growth on the screener (.claude/plans/overhaul.md §1-2).
--
-- Implied growth answers the reverse-DCF question the other way round: at the
-- firm's required return (WACC), what growth does today's enterprise value
-- assume? It is the starting growth g0 of the same reverse FCFF the value
-- signal uses (fading linearly to g_L over N years, then a Gordon terminal
-- value), solved for g0 with r fixed instead of for r with g0 fixed. Display
-- only: it is not part of the signal, so nothing here needed re-backtesting.
-- (Expectations investing: Rappaport & Mauboussin 2001.)
--
-- The ratios sit beside the signal as context. The backtest found each one a
-- weaker ranking than the reverse model built on it (backtests.md test 2), but
-- they are the vocabulary a reader already has.

-- g0 such that PV(wacc, FCFF growing from g0 to g_L) = EV, by bisection.
-- PV rises with g0 while every flow is positive, so the root is unique.
-- Bracket: -99% (a flow cannot shrink by more than all of it) to g_max, the
-- same numerical ceiling the implied-return solver uses. Null outside it, or
-- when FCFF <= 0, EV <= 0, or WACC <= g_L (no finite terminal value).
create or replace function warehouse.implied_growth_cashflow(
  cf0 double precision, g_l double precision, price double precision,
  n int, r double precision, g_max double precision
)
returns double precision
language plpgsql immutable parallel safe
as $$
declare
  lo double precision := -0.99;
  hi double precision := g_max;
  mid double precision;
  gap_lo double precision;
  gap_hi double precision;
begin
  if cf0 is null or g_l is null or price is null or r is null or n is null
     or cf0 <= 0 or price <= 0 or r <= g_l then
    return null;
  end if;

  gap_lo := warehouse.pv(r, warehouse.grow(cf0, lo, g_l, n), g_l) - price;
  gap_hi := warehouse.pv(r, warehouse.grow(cf0, hi, g_l, n), g_l) - price;
  if gap_lo = 'NaN' or gap_hi = 'NaN' or not (gap_lo < 0 and gap_hi > 0) then
    return null;
  end if;

  for i in 1..100 loop
    mid := (lo + hi) / 2;
    if warehouse.pv(r, warehouse.grow(cf0, mid, g_l, n), g_l) - price < 0 then
      lo := mid;
    else
      hi := mid;
    end if;
    exit when hi - lo < 1e-12;
  end loop;
  return (lo + hi) / 2;
end
$$;

comment on function warehouse.implied_growth_cashflow is
  'Starting FCFF growth (fading to g_L over n years) at which PV at the required return equals EV. Display-only companion to implied_return_cashflow.';

revoke execute on function warehouse.implied_growth_cashflow from public, anon, authenticated;
grant execute on function warehouse.implied_growth_cashflow to service_role;

drop view public.screener;
drop materialized view warehouse.stock_snapshot;

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
  i.beta                                                          as beta,
  i.realised_return,
  i.volatility,
  case when t.ttm_diluted_eps > 0 then i.price / t.ttm_diluted_eps end as pe_ratio,
  coalesce(d.trailing / nullif(i.price, 0), 0)                    as dividend_yield,
  -- Classic ratios, as context beside the signal (not part of it). Each is
  -- withheld where its denominator makes it meaningless rather than signed.
  case when i.ev > 0 then i.fcff / i.ev end                       as fcf_yield,
  case when i.ev > 0 and i.ebitda > 0 then i.ev / i.ebitda end    as ev_ebitda,
  case when i.book_equity > 0 then i.equity / i.book_equity end   as pb_ratio,
  case when i.equity > 0 then i.shareholder_payout / i.equity end as shareholder_yield,
  i.roe,
  -- Trailing revenue CAGR as reported, before the model's winsorisation.
  i.g0_raw                                                        as revenue_growth,
  i.revenue / 1e9                                                 as revenue_bn,
  jsonb_build_object(
    'risk_free', dr.rf,
    'cost_of_equity', dr.ke,
    'wacc', dr.wacc,
    'cost_of_debt', dr.kd,
    'equity_weight', dr.equity_weight,
    'tax_rate', dr.tax,
    'beta_raw', dr.beta_raw,
    'interest_coverage', dr.interest_coverage,
    'synthetic_rating', dr.synthetic_rating
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
    'required_return_firm', s.wacc,
    'implied_growth', warehouse.implied_growth_cashflow(
      i.fcff, i.g_l, i.ev, sp.horizon_years, i.wacc, sp.r_max),
    -- True when the inputs are solvable but even g_max does not reach EV: the
    -- price needs more growth than the bracket allows. A reading, not a gap.
    'implied_growth_above_max', case when i.fcff > 0 and i.ev > 0 and i.wacc > i.g_l
      then warehouse.pv(i.wacc, warehouse.grow(i.fcff, sp.r_max, i.g_l, sp.horizon_years), i.g_l) < i.ev
    end
  )                                                               as signals
from warehouse.inputs i
left join warehouse.fundamentals_ttm t using (ticker)
left join warehouse.dividend_stats d using (ticker)
left join warehouse.discount_rates dr using (ticker)
left join warehouse.signals s using (ticker)
cross join warehouse.spec sp
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
  fcf_yield,
  ev_ebitda,
  pb_ratio,
  shareholder_yield,
  roe,
  revenue_growth,
  revenue_bn,
  discount_rates,
  signals
from warehouse.stock_snapshot;

comment on view public.screener is
  'One row per stock in the universe: price, risk statistics, the required returns, and the signal with its four implied returns (backtests.md §16). Refreshed by warehouse.refresh().';

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
grant select on warehouse.discount_rates to service_role;
grant select on public.screener to anon, authenticated;

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
