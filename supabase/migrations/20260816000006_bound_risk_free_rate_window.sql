-- The original view averaged ^IRX over EVERY stored date. That was harmless
-- while only 1 year of history existed, but the price backfill now stores 2
-- years, which would silently drag the risk-free rate toward older levels and
-- shift every CAPM number with it.
--
-- Bound the average to the most recent 252 trading days, matching the lookback
-- every return calculation already uses.
create or replace view public.average_risk_free_rate as
select avg(close) / 100 as annual_risk_free_rate
from (
  select close
  from public.daily_close_prices
  where ticker = '^IRX'
  order by date desc
  limit 252
) recent;

comment on view public.average_risk_free_rate is
  'Average annualized risk-free rate (13-week T-bill, ^IRX) over the most recent 252 trading days, as a decimal (e.g. 0.0512 for 5.12%). Bounded to 252 days so that storing extra price history does not retroactively change the rate.';
