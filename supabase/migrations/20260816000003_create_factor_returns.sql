create table if not exists public.factor_returns (
  date     date primary key,
  mkt_rf   numeric(12, 8) not null,
  smb      numeric(12, 8) not null,
  hml      numeric(12, 8) not null,
  rmw      numeric(12, 8),
  cma      numeric(12, 8),
  umd      numeric(12, 8),
  rf       numeric(12, 8) not null
);

comment on table public.factor_returns is
  'Daily Fama-French factor returns from the Ken French data library, stored as DECIMALS (the source CSV is in percent and is divided by 100 on ingest). One table serves FF3, FF5 and Carhart-4: the Mkt-RF/SMB/HML series are identical across the 3- and 5-factor files, so there is nothing to duplicate. rmw/cma come from the 5-factor file; umd from the separate momentum file. The library publishes with a multi-week lag, so factor regressions must join on the date INTERSECTION with price returns and must never assume the last 252 price dates are covered.';
