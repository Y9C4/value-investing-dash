create view public.average_risk_free_rate as
select
  avg(close) / 100 as annual_risk_free_rate
from public.daily_close_prices
where ticker = '^IRX';

comment on view public.average_risk_free_rate is
  'Average annualized risk-free rate (13-week T-bill, ^IRX) over all backfilled dates, as a decimal (e.g. 0.0512 for 5.12%).';
