-- The landing layer of the warehouse (python-api/notebooks/backtests.md §17).
--
-- ELT: python-api/ingest.py extracts from yfinance and the Ken French library
-- and loads rows here exactly as the provider returned them. Nothing in this
-- schema is derived; every transformation lives in `warehouse`, and the site
-- reads only the views in `public`.
--
-- Rows are upserted and never deleted. yfinance returns about four years of
-- annual statements and five to seven quarters, so a table that is replaced on
-- every pull forgets history the moment it scrolls out of Yahoo's window.
-- Upserting keeps it, and restatements overwrite the figure in place.
--
-- Not exposed through PostgREST (supabase/config.toml lists `public` only), and
-- closed to the browser-safe roles. The single exception, close prices for the
-- chart, is granted column by column in the serving migration.
--
-- double precision rather than numeric throughout: the warehouse does
-- arithmetic on every row, and numeric arrives in Python as Decimal objects.

create schema if not exists raw;
revoke all on schema raw from public, anon, authenticated;
grant usage on schema raw to service_role;

comment on schema raw is
  'Provider rows as fetched (yfinance, Ken French). Written by python-api/ingest.py, read only by the warehouse schema.';

-- ---------------------------------------------------------------------------
-- Securities
-- ---------------------------------------------------------------------------

-- One row per ticker ever tracked. `in_universe` follows
-- python-api/data/sp500_tickers.json on every profile pull, so a company that
-- leaves the index keeps its history and drops off the screener.
create table if not exists raw.company_profile (
  ticker       text primary key,
  name         text,
  sector       text,
  industry     text,
  currency     text,
  in_universe  boolean not null default true,
  fetched_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Market data
-- ---------------------------------------------------------------------------

-- Daily bars for the constituents plus ^GSPC (benchmark), ^TNX (10-year yield,
-- the discount rate) and ^IRX (13-week bill, the optimiser's cash rate).
--   close      split-adjusted only: price x shares is the market cap that day.
--   adj_close  split- and dividend-adjusted: every return is measured on this.
create table if not exists raw.daily_prices (
  ticker     text not null,
  date       date not null,
  close      double precision not null,
  adj_close  double precision not null,
  volume     double precision,
  primary key (ticker, date)
);

-- The as-of date is "the newest ^GSPC row", and every window is a date range.
create index if not exists daily_prices_date_idx on raw.daily_prices (date);

-- Cash dividends per share by ex-date, in today's split basis (as yfinance
-- reports them). A ticker with no rows is a non-payer, which the dividend
-- model must refuse rather than value at zero.
create table if not exists raw.dividends (
  ticker   text not null,
  ex_date  date not null,
  amount   double precision not null check (amount > 0),
  primary key (ticker, ex_date)
);

-- Split events. Kept apart from the bars because the share-count history is
-- NOT split-adjusted while closes are; warehouse.shares_adjusted reconciles
-- the two. ratio = new shares per old share.
create table if not exists raw.splits (
  ticker  text not null,
  date    date not null,
  ratio   double precision not null check (ratio > 0),
  primary key (ticker, date)
);

-- ---------------------------------------------------------------------------
-- Company data
-- ---------------------------------------------------------------------------

-- Every line item of every statement, long format, labelled exactly as
-- yfinance labels it. Long because the item set varies by company and year,
-- and a model added later may want a line nobody pivots today. An absent row
-- means yfinance had no value, never zero.
create table if not exists raw.statement_items (
  ticker      text not null,
  frequency   text not null check (frequency in ('annual', 'quarterly')),
  statement   text not null check (statement in ('income', 'balance', 'cashflow')),
  period_end  date not null,
  item        text not null,
  value       double precision not null,
  fetched_at  timestamptz not null default now(),
  primary key (ticker, frequency, statement, period_end, item)
);

-- Every pivot filters on (frequency, item) before grouping by ticker.
create index if not exists statement_items_item_idx
  on raw.statement_items (frequency, item);

-- Shares outstanding from the filings' cover pages: irregular dates, NOT
-- split-adjusted, occasionally glitchy. Read through warehouse.shares_adjusted.
create table if not exists raw.shares_outstanding (
  ticker  text not null,
  date    date not null,
  shares  double precision not null check (shares > 0),
  primary key (ticker, date)
);

-- Earnings announcements with the consensus estimate Yahoo held going in.
-- The earnings-surprise signal is (reported - estimate) / price.
create table if not exists raw.earnings (
  ticker        text not null,
  report_date   date not null,
  eps_estimate  double precision,
  reported_eps  double precision,
  primary key (ticker, report_date)
);

-- Daily Fama-French factors, as DECIMALS (the library publishes percent).
-- umd is the separate momentum file and may lag the other five.
create table if not exists raw.factor_returns (
  date    date primary key,
  mkt_rf  double precision not null,
  smb     double precision not null,
  hml     double precision not null,
  rmw     double precision,
  cma     double precision,
  umd     double precision,
  rf      double precision not null
);

grant select, insert, update, delete on all tables in schema raw to service_role;

-- ---------------------------------------------------------------------------
-- Carry over what is already stored
-- ---------------------------------------------------------------------------
--
-- The backtest schema (migration 20261112000001) holds the same yfinance pull
-- in the same shape, from 2015, with the adjusted closes, splits, share history
-- and earnings dates the old public tables never kept. Seeding from it means
-- the first live refresh has full history instead of waiting on a ten-minute
-- cold pull. On a fresh database both sides are empty and this is a no-op.

insert into raw.company_profile (ticker, name, sector, industry, currency, fetched_at)
select ticker, name, sector, industry, currency, fetched_at
from public.company_profile
on conflict (ticker) do nothing;

insert into raw.company_profile (ticker, name, sector, industry)
select ticker, name, sector, industry
from backtest.universe
on conflict (ticker) do nothing;

insert into raw.daily_prices (ticker, date, close, adj_close, volume)
select ticker, date, close, adj_close, volume
from backtest.daily_prices
on conflict (ticker, date) do nothing;

insert into raw.splits (ticker, date, ratio)
select ticker, date, ratio from backtest.splits
on conflict (ticker, date) do nothing;

insert into raw.statement_items (ticker, frequency, statement, period_end, item, value)
select ticker, frequency, statement, period_end, item, value
from backtest.statement_items
on conflict (ticker, frequency, statement, period_end, item) do nothing;

insert into raw.shares_outstanding (ticker, date, shares)
select ticker, date, shares from backtest.shares_outstanding
on conflict (ticker, date) do nothing;

insert into raw.earnings (ticker, report_date, eps_estimate, reported_eps)
select ticker, report_date, eps_estimate, reported_eps from backtest.earnings_dates
on conflict (ticker, report_date) do nothing;

insert into raw.dividends (ticker, ex_date, amount)
select ticker, ex_date, amount::double precision
from public.dividend_history
where amount > 0
on conflict (ticker, ex_date) do nothing;

insert into raw.factor_returns (date, mkt_rf, smb, hml, rmw, cma, umd, rf)
select date, mkt_rf, smb, hml, rmw, cma, umd, rf from public.factor_returns
on conflict (date) do nothing;

insert into raw.factor_returns (date, mkt_rf, smb, hml, rmw, cma, umd, rf)
select date, mkt_rf, smb, hml, rmw, cma, umd, rf from backtest.factor_returns
on conflict (date) do nothing;
