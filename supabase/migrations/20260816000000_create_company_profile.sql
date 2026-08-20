create table if not exists public.company_profile (
  ticker              text primary key,
  name                text,
  sector              text,
  industry            text,
  shares_outstanding  numeric(20, 0),
  market_cap          numeric(20, 0),
  beta_yf             numeric(10, 4),
  trailing_eps        numeric(14, 4),
  forward_eps         numeric(14, 4),
  book_value_ps       numeric(14, 4),
  dividend_rate       numeric(14, 4),
  dividend_yield      numeric(10, 6),
  payout_ratio        numeric(10, 6),
  return_on_equity    numeric(10, 6),
  earnings_growth     numeric(10, 6),
  revenue_growth      numeric(10, 6),
  currency            text,
  fetched_at          timestamptz not null default now()
);

create index if not exists company_profile_sector_idx
  on public.company_profile (sector);

comment on table public.company_profile is
  'Point-in-time company metadata from yfinance .info, one row per ticker. Overwritten (not versioned) on each refresh, so upserts must use ignore_duplicates=false — unlike daily_close_prices, where a row for a given date never changes. fetched_at records staleness.';
