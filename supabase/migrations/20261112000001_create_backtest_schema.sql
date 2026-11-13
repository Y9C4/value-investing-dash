-- Stage 0 of the backtest (python-api/notebooks/backtests.md §5, §8): a frozen,
-- point-in-time-taggable copy of everything the signal study reads.
--
-- A schema of its own rather than more tables in `public`, for three reasons:
--   * The product tables hold a rolling window (two years of closes, eight
--     quarters) and are rewritten nightly. A backtest needs a fixed dataset that
--     does not move underneath a result between two runs.
--   * The backtest needs things the product deliberately throws away: raw and
--     dividend-adjusted closes side by side, every statement line item, share
--     count history, splits.
--   * `backtest` is not in PostgREST's exposed schemas (supabase/config.toml),
--     so none of this is reachable with the anon key, and nothing here can
--     collide with a table the site reads.
--
-- Written by `python -m backtest.load` over a direct Postgres connection. Raw
-- tables store what yfinance returned and nothing more; the point-in-time rules
-- live in the views and in backtest/pit.py, so a rule can change without a
-- re-download.

create schema if not exists backtest;
revoke all on schema backtest from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Raw tables
-- ---------------------------------------------------------------------------

-- Today's S&P 500, with today's sector. Both are look-ahead (survivorship and
-- sector drift); acknowledged in backtests.md §11 rather than hidden.
create table if not exists backtest.universe (
  ticker    text primary key,
  name      text,
  sector    text,
  industry  text
);

-- Daily bars from 2015. Two closes on purpose:
--   close      split-adjusted only. For market cap, which must be price x shares
--              at the time; a dividend-adjusted price understates old caps.
--   adj_close  split- and dividend-adjusted. For every return calculation.
-- double precision rather than numeric: this table is read into pandas whole,
-- and numeric arrives as Python Decimal objects.
create table if not exists backtest.daily_prices (
  ticker     text not null,
  date       date not null,
  close      double precision not null,
  adj_close  double precision not null,
  volume     double precision,
  primary key (ticker, date)
);

create index if not exists daily_prices_date_idx on backtest.daily_prices (date);

-- Split events, kept apart from the bars because the share-count history is
-- NOT split-adjusted by yfinance (NVDA reads 2.47bn shares in 2023 and 25.4bn
-- in 2024) while closes are. shares_adjusted below reconciles the two.
create table if not exists backtest.splits (
  ticker  text not null,
  date    date not null,
  -- New shares per old share: 10 for NVDA's 2024 10-for-1, below 1 for a
  -- reverse split.
  ratio   double precision not null check (ratio > 0),
  primary key (ticker, date)
);

-- Every line item of every statement, long format, exactly as yfinance labels
-- it. Long because the item set varies by company and by year, and a model
-- added later may want a line nobody thought to pivot today. Nulls are not
-- stored: an absent row means yfinance had no value, never zero.
create table if not exists backtest.statement_items (
  ticker      text not null,
  frequency   text not null check (frequency in ('annual', 'quarterly')),
  statement   text not null check (statement in ('income', 'balance', 'cashflow')),
  period_end  date not null,
  item        text not null,
  value       double precision not null,
  primary key (ticker, frequency, statement, period_end, item)
);

create index if not exists statement_items_item_idx
  on backtest.statement_items (frequency, item);

-- Shares outstanding history as yfinance reports it (from the filings' cover
-- pages): irregular dates, NOT split-adjusted, occasionally glitchy. Read it
-- through shares_adjusted.
create table if not exists backtest.shares_outstanding (
  ticker  text not null,
  date    date not null,
  shares  double precision not null check (shares > 0),
  primary key (ticker, date)
);

-- Earnings announcement dates. Not an input to any model: kept to check the
-- fixed 90-day publication lag against when results actually came out.
create table if not exists backtest.earnings_dates (
  ticker        text not null,
  report_date   date not null,
  eps_estimate  double precision,
  reported_eps  double precision,
  primary key (ticker, report_date)
);

-- A frozen copy of the Fama-French daily factors (decimals, like
-- public.factor_returns). Copied rather than read from public because the
-- library revises history, and a backtest result should not change because
-- Ken French re-estimated 2024.
create table if not exists backtest.factor_returns (
  date    date primary key,
  mkt_rf  double precision not null,
  smb     double precision not null,
  hml     double precision not null,
  rmw     double precision,
  cma     double precision,
  umd     double precision,
  rf      double precision not null
);

-- The validation design (backtests.md §4) as data, so every stage agrees on
-- which dates are development and which are the locked holdout.
create table if not exists backtest.rebalance_dates (
  rebalance_date  date primary key,
  period          text not null
                  check (period in ('development', 'embargo', 'holdout', 'terminal')),
  -- End of this date's forward-return window: the next rebalance date. Null
  -- only for the terminal row, which exists to close the last window.
  next_date       date
);

-- One row per dataset per load, so "when was this pulled and what failed" has
-- an answer that does not depend on a terminal scrollback.
create table if not exists backtest.load_runs (
  id              bigint generated always as identity primary key,
  dataset         text not null,
  started_at      timestamptz not null,
  finished_at     timestamptz not null default now(),
  rows_loaded     integer not null,
  tickers_ok      integer,
  tickers_failed  text[] not null default '{}',
  detail          jsonb
);

-- ---------------------------------------------------------------------------
-- Views: the point-in-time rules
-- ---------------------------------------------------------------------------

-- Share counts in the same basis as `daily_prices.close`, so that
-- close x shares is the market cap on that day.
--
-- Each count is multiplied by every split dated after it. Two consequences,
-- both intended:
--   * Using later splits is a unit conversion, not a leak: close is converted
--     the same way, so the market cap is what it was at the time.
--   * Yahoo records spin-offs as fractional "splits" (DHR 1.319 for Fortive)
--     to scale older prices down. The count is scaled up to match, so a
--     pre-spin-off market cap still includes the business that later left,
--     consistent with the pre-spin-off statements it is compared against.
--
-- Written as a join against split intervals rather than a per-row subquery:
-- the same answer at a fiftieth of the cost.
create or replace view backtest.shares_adjusted as
with intervals as (
  -- Counts dated in [since, until) take the product of this split and every
  -- later one; counts after the last split take nothing.
  select
    ticker,
    lag(date) over (partition by ticker order by date) as since,
    date                                               as until,
    exp(sum(ln(ratio)) over (partition by ticker order by date desc)) as factor
  from backtest.splits
)
select
  s.ticker,
  s.date,
  s.shares                           as shares_reported,
  s.shares * coalesce(i.factor, 1)   as shares
from backtest.shares_outstanding s
left join intervals i
  on  i.ticker = s.ticker
  and s.date < i.until
  and (i.since is null or s.date >= i.since);

-- The annual fundamentals the models use, one row per company per fiscal year.
--
-- Names are tried in order where yfinance is inconsistent across companies
-- (the same fallbacks as python-api/fundamentals.py). Signs are as reported:
-- capex, dividends and buybacks are negative.
--
-- available_from is the point-in-time rule: a fiscal year is usable from 90
-- days after it ends. Large US filers must file a 10-K within 60 days, so 90 is
-- conservative; backtest.load's quality report checks it against
-- earnings_dates.
create or replace view backtest.annual_fundamentals as
with a as (
  select * from backtest.statement_items where frequency = 'annual'
),
pivoted as (
select
  ticker,
  period_end,
  period_end + 90 as available_from,

  -- Income statement
  coalesce(max(value) filter (where item = 'Total Revenue'),
           max(value) filter (where item = 'Operating Revenue'))         as revenue,
  max(value) filter (where item = 'Gross Profit')                        as gross_profit,
  coalesce(max(value) filter (where item = 'Operating Income'),
           max(value) filter (where item = 'EBIT'))                      as operating_income,
  coalesce(max(value) filter (where item = 'EBIT'),
           max(value) filter (where item = 'Operating Income'))          as ebit,
  coalesce(max(value) filter (where item = 'EBITDA'),
           max(value) filter (where item = 'Normalized EBITDA'))         as ebitda,
  max(value) filter (where item = 'Pretax Income')                       as pretax_income,
  max(value) filter (where item = 'Tax Provision')                       as tax_provision,
  max(value) filter (where item = 'Tax Rate For Calcs')                  as tax_rate,
  coalesce(max(value) filter (where item = 'Interest Expense'),
           max(value) filter (where item = 'Interest Expense Non Operating')) as interest_expense,
  coalesce(max(value) filter (where item = 'Net Income Common Stockholders'),
           max(value) filter (where item = 'Net Income'),
           max(value) filter (where item = 'Net Income From Continuing Operation Net Minority Interest')) as net_income,
  coalesce(max(value) filter (where item = 'Diluted Average Shares'),
           max(value) filter (where item = 'Basic Average Shares'))      as diluted_avg_shares,

  -- Balance sheet
  coalesce(max(value) filter (where item = 'Stockholders Equity'),
           max(value) filter (where item = 'Common Stock Equity'))       as book_equity,
  max(value) filter (where item = 'Minority Interest')                   as minority_interest,
  max(value) filter (where item = 'Preferred Stock')                     as preferred_stock,
  max(value) filter (where item = 'Total Debt')                          as total_debt,
  max(value) filter (where item = 'Net Debt')                            as net_debt,
  coalesce(max(value) filter (where item = 'Cash And Cash Equivalents'),
           max(value) filter (where item = 'Cash Cash Equivalents And Short Term Investments')) as cash,
  max(value) filter (where item = 'Cash Cash Equivalents And Short Term Investments') as cash_and_short_term_investments,
  max(value) filter (where item = 'Total Assets')                        as total_assets,
  max(value) filter (where item = 'Current Assets')                      as current_assets,
  max(value) filter (where item = 'Current Liabilities')                 as current_liabilities,
  max(value) filter (where item = 'Invested Capital')                    as invested_capital,
  -- Ordinary Shares Number first: Share Issued includes treasury stock (JPM:
  -- 4.1bn issued vs 2.7bn outstanding). Statement share counts are already
  -- restated for later splits, unlike shares_outstanding.
  coalesce(max(value) filter (where item = 'Ordinary Shares Number'),
           max(value) filter (where item = 'Share Issued'))              as shares_outstanding,

  -- Cash flow statement
  coalesce(max(value) filter (where item = 'Operating Cash Flow'),
           max(value) filter (where item = 'Cash Flow From Continuing Operating Activities')) as operating_cash_flow,
  coalesce(max(value) filter (where item = 'Capital Expenditure'),
           max(value) filter (where item = 'Purchase Of PPE'))           as capital_expenditure,
  -- Banks and REITs report no capex, so this stays null for them rather than
  -- being fabricated from operating cash flow alone.
  coalesce(max(value) filter (where item = 'Free Cash Flow'),
           coalesce(max(value) filter (where item = 'Operating Cash Flow'),
                    max(value) filter (where item = 'Cash Flow From Continuing Operating Activities'))
         + coalesce(max(value) filter (where item = 'Capital Expenditure'),
                    max(value) filter (where item = 'Purchase Of PPE'))) as free_cash_flow,
  coalesce(max(value) filter (where item = 'Depreciation And Amortization'),
           max(value) filter (where item = 'Depreciation Amortization Depletion')) as depreciation_amortisation,
  max(value) filter (where item = 'Change In Working Capital')           as change_in_working_capital,
  max(value) filter (where item = 'Stock Based Compensation')            as stock_based_compensation,
  coalesce(max(value) filter (where item = 'Cash Dividends Paid'),
           max(value) filter (where item = 'Common Stock Dividend Paid')) as dividends_paid,
  coalesce(max(value) filter (where item = 'Repurchase Of Capital Stock'),
           max(value) filter (where item = 'Common Stock Payments'))     as share_repurchases,
  coalesce(max(value) filter (where item = 'Issuance Of Capital Stock'),
           max(value) filter (where item = 'Common Stock Issuance'))     as share_issuance,
  coalesce(max(value) filter (where item = 'Net Issuance Payments Of Debt'),
           max(value) filter (where item = 'Net Long Term Debt Issuance')) as net_debt_issuance
from a
group by ticker, period_end
)
-- yfinance's oldest annual column is a shell: four to seven stray line items
-- and none of the figures below. Left in, it would become a ticker's "latest
-- year" on the earliest rebalance dates and value the company from nothing.
select * from pivoted
where coalesce(revenue, net_income, operating_cash_flow, book_equity, total_assets)
      is not null;

comment on view backtest.annual_fundamentals is
  'Annual statements pivoted to the columns the models use. available_from = period_end + 90 is the point-in-time rule; read through backtest/pit.py, which enforces it.';
