create view public.daily_log_returns as
select
  date,
  ticker,
  close,
  ln(close / lag(close) over (partition by ticker order by date)) as log_return
from public.daily_close_prices;

comment on view public.daily_log_returns is
  'Daily log-normal returns (ln(close / previous close)) per ticker. Filter with WHERE ticker IN (...) to select specific tickers.';

create view public.daily_excess_returns as
select
  stock.date,
  stock.ticker,
  stock.close,
  stock.log_return as stock_log_return,
  market.log_return as market_log_return,
  stock.log_return - market.log_return as excess_log_return
from public.daily_log_returns stock
join public.daily_log_returns market
  on market.date = stock.date
  and market.ticker = '^GSPC'
where stock.ticker <> '^GSPC';

comment on view public.daily_excess_returns is
  'Daily log return per ticker alongside the same-day ^GSPC log return and the excess (stock minus market) log return. Filter with WHERE ticker IN (...) to select specific tickers.';
