-- Expose the dividend-adjusted close on public.stock_prices.
--
-- The optimiser estimated expected returns from `close`, which is split- but
-- not dividend-adjusted, so a high-yield stock's mean return was understated
-- by its yield. The column is appended, so `create or replace` keeps every
-- existing reader (the chart reads `close` and is unchanged).

create or replace view public.stock_prices
with (security_invoker = true) as
select ticker, date, close, adj_close
from raw.daily_prices;

comment on view public.stock_prices is
  'Daily closes per ticker, including ^GSPC, ^TNX and ^IRX: close is split-adjusted (for charts), adj_close is also dividend-adjusted (for returns).';

-- security_invoker: the caller needs the column itself.
grant select (adj_close) on raw.daily_prices to anon, authenticated;
