create table if not exists public.daily_close_prices (
  date        date not null,
  ticker      text not null,
  close       numeric(14, 4) not null,
  created_at  timestamptz not null default now(),
  primary key (date, ticker)
);

create index if not exists daily_close_prices_ticker_idx
  on public.daily_close_prices (ticker);

create index if not exists daily_close_prices_date_idx
  on public.daily_close_prices (date);

comment on table public.daily_close_prices is
  'Daily close prices for S&P 500 constituents plus the ^GSPC index, backfilled via the FastAPI /backfill/sp500-daily-close endpoint.';
