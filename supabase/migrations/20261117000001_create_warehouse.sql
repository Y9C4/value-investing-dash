-- The transformation layer (python-api/notebooks/backtests.md §17).
--
-- Every number the site shows is derived here, in SQL, from the provider rows in
-- `raw`. Python only extracts and loads; it no longer pivots statements, rolls
-- up trailing twelve months, measures betas, values companies or assembles the
-- screener payload.
--
-- Layout, in dependency order:
--
--   spec, as_of                      the frozen specification and the as-of date
--   securities, shares_adjusted      dimensions
--   fundamentals_annual              point-in-time annual statements (backtest spec)
--   fundamentals_quarterly / _ttm    trailing twelve months (forward models)
--   dividend_stats                   trailing dividend, growth, stability
--   market            [mat]          rates, factor premia, the index
--   price_stats       [mat]          returns, volatility, betas, momentum
--   inputs            [mat]          one row per stock: statement + price + rates
--   signals           [mat]          reverse-DCF alphas, momentum, surprise, ranks
--   forward_valuations [mat]         the five fair-value models
--   stock_snapshot    [mat]          one row per stock, shaped for the screener
--   signal_history, valuation_history  dated archives, appended by refresh()
--
-- The reverse-DCF and signal SQL is ported from notebooks/DWimplementation_v2.sql
-- and notebooks/backtest.ipynb, so the live signal is the one that was tested.
-- The forward models are ported from api/valuation.py and api/engine.py, with
-- the changes listed at forward_valuations.
--
-- Every division below is guarded with nullif. One division by zero would fail
-- the whole refresh, and a refresh that fails leaves yesterday's numbers up.

create schema if not exists warehouse;
revoke all on schema warehouse from public, anon, authenticated;
grant usage on schema warehouse to service_role;

comment on schema warehouse is
  'Every transformation of the raw provider rows, in SQL. Refreshed by warehouse.refresh(); served through views in public.';

-- ---------------------------------------------------------------------------
-- The specification
-- ---------------------------------------------------------------------------

-- Every tuning constant in one place, so the specification the holdout is run
-- against (backtests.md §4 "freeze before the holdout") is one view to commit.
create or replace view warehouse.spec as
select
  60    as pit_lag_days,          -- annual statement usable from period end + 60 (10-K deadline)
  440   as stale_days,            -- older than this is stale: 60 + 365 + 52/53-week slack
  90    as shares_window_days,    -- shares = median of split-adjusted counts over this window
  5     as horizon_years,         -- reverse DCF: growth fades to g_L over N years
  0.025::double precision as long_run_growth,  -- g_L, capped at the risk-free rate
  1.0::double precision   as r_max,             -- implied returns above 100% are unsolvable
  5     as min_peers,             -- a sector median from fewer firms is withheld
  252   as beta_days,             -- factor days in a CAPM beta
  120   as min_beta_obs,          -- fewer overlapping days gives no beta
  -0.10::double precision as growth_floor,     -- trailing revenue CAGR clamp
  0.25::double precision  as growth_cap,
  100   as surprise_window_days;  -- an earnings surprise older than this is dropped

comment on view warehouse.spec is
  'The frozen specification: every constant the signal and the models read. Mirrors notebooks/backtest.ipynb.';

-- The market date everything is valued at: the newest S&P 500 close.
create or replace view warehouse.as_of as
select max(date) as as_of
from raw.daily_prices
where ticker = '^GSPC';

-- ---------------------------------------------------------------------------
-- Dimensions
-- ---------------------------------------------------------------------------

create or replace view warehouse.securities as
select ticker, name, sector, industry, currency
from raw.company_profile
where in_universe;

-- Share counts in the same basis as raw.daily_prices.close, so close x shares
-- is the market cap on that day. Each count is multiplied by every split dated
-- after it. That is a unit conversion, not a leak: close is converted the same
-- way. (Same view as backtest.shares_adjusted.)
create or replace view warehouse.shares_adjusted as
with intervals as (
  select
    ticker,
    lag(date) over (partition by ticker order by date) as since,
    date                                               as until,
    exp(sum(ln(ratio)) over (partition by ticker order by date desc)) as factor
  from raw.splits
)
select
  s.ticker,
  s.date,
  s.shares                         as shares_reported,
  s.shares * coalesce(i.factor, 1) as shares
from raw.shares_outstanding s
left join intervals i
  on  i.ticker = s.ticker
  and s.date < i.until
  and (i.since is null or s.date >= i.since);

-- ---------------------------------------------------------------------------
-- Statements
-- ---------------------------------------------------------------------------

-- Annual statements, one row per company per fiscal year, exactly as the
-- backtest built them (DWimplementation_v2.sql, temp_models): the same item
-- names, the same zero-fills, the same FCFF. available_from is the
-- point-in-time rule; g0 is the trailing revenue CAGR the reverse models grow
-- cash flows at, computed per statement (not per as-of date).
create or replace view warehouse.fundamentals_annual as
with items as (
  select
    ticker,
    period_end,
    max(value) filter (where item = 'EBIT')                          as ebit,
    max(value) filter (where item = 'Tax Rate For Calcs')            as tax,
    max(value) filter (where item = 'Depreciation And Amortization') as dna,
    max(value) filter (where item = 'Capital Expenditure')           as capex,
    max(value) filter (where item = 'Change In Working Capital')     as dnwc,
    coalesce(
      max(value) filter (where item = 'Cash Cash Equivalents And Short Term Investments'),
      max(value) filter (where item = 'Cash And Cash Equivalents')
    )                                                                as cash,
    max(value) filter (where item = 'Capital Lease Obligations')     as capital_lease_obligations,
    -- No debt line on a balance sheet that exists means no debt.
    coalesce(
      max(value) filter (where item = 'Total Debt'),
      case when max(value) filter (where item = 'Total Assets') is not null then 0 end
    )                                                                as total_debt,
    max(value) filter (where item = 'Interest Expense')              as interest_expense,
    max(value) filter (where item = 'Common Stock Equity')           as book_equity,
    max(value) filter (where item = 'Net Income Common Stockholders') as net_income,
    -- Stored negative (cash out). Missing = none, when the cash flow statement exists.
    coalesce(
      max(value) filter (where item = 'Cash Dividends Paid'),
      case when max(value) filter (where item = 'Operating Cash Flow') is not null then 0 end
    )                                                                as dividends_paid,
    -- Negative = net buybacks. Missing = none, when the cash flow statement exists.
    coalesce(
      max(value) filter (where item = 'Net Common Stock Issuance'),
      case when max(value) filter (where item = 'Operating Cash Flow') is not null then 0 end
    )                                                                as net_stock_issuance,
    max(value) filter (where item = 'Total Revenue')                 as revenue,
    max(value) filter (where item = 'Operating Income')              as operating_income,
    max(value) filter (where item = 'Invested Capital')              as invested_capital,
    max(value) filter (where item = 'EBITDA')                        as ebitda
  from raw.statement_items
  where frequency = 'annual'
  group by ticker, period_end
),
statements as (
  select
    *,
    -- Ex-lease, and allowed negative for net-cash companies. Yahoo's own Net
    -- Debt line excludes short-term investments and vanishes when cash > debt.
    total_debt - coalesce(capital_lease_obligations, 0) - cash        as net_debt,
    interest_expense
      / nullif(total_debt - coalesce(capital_lease_obligations, 0), 0) as debt_cost,
    -- Capex and the working-capital change carry their cash-flow signs.
    ebit * (1 - tax) + dna + capex + dnwc                             as fcff
  from items
  -- yfinance's oldest annual column is a shell of stray line items.
  where ebit is not null or total_debt is not null
),
growth as (
  -- (Rev_T / Rev_T-k)^(1/years) - 1, years from the actual period ends.
  select
    ticker,
    period_end,
    power(revenue / lag(revenue, 2) over w,
          365.25 / nullif(period_end - lag(period_end, 2) over w, 0)) - 1 as cagr_2y,
    power(revenue / lag(revenue, 1) over w,
          365.25 / nullif(period_end - lag(period_end, 1) over w, 0)) - 1 as cagr_1y
  from statements
  where revenue > 0
  window w as (partition by ticker order by period_end)
)
select
  s.*,
  s.period_end + spec.pit_lag_days                    as available_from,
  -- 2-year CAGR, else 1-year. Clamped, because past growth barely persists.
  coalesce(g.cagr_2y, g.cagr_1y)                      as g0_raw,
  least(greatest(coalesce(g.cagr_2y, g.cagr_1y), spec.growth_floor), spec.growth_cap) as g0
from statements s
left join growth g using (ticker, period_end)
cross join warehouse.spec;

comment on view warehouse.fundamentals_annual is
  'Annual statements as the backtest built them (DWimplementation_v2.sql). available_from = period_end + 60 is the point-in-time rule.';

-- Quarterly statements pivoted with the name fallbacks python-api/fundamentals.py
-- used, which this view replaces. Feeds the trailing-twelve-month rollup the
-- forward models read.
create or replace view warehouse.fundamentals_quarterly as
select
  ticker,
  period_end,
  coalesce(max(value) filter (where item = 'Total Revenue'),
           max(value) filter (where item = 'Operating Revenue'))                 as revenue,
  coalesce(max(value) filter (where item = 'Net Income'),
           max(value) filter (where item = 'Net Income Common Stockholders'),
           max(value) filter (where item = 'Net Income From Continuing Operation Net Minority Interest'),
           max(value) filter (where item = 'Net Income From Continuing Operations')) as net_income,
  coalesce(max(value) filter (where item = 'EBIT'),
           max(value) filter (where item = 'Operating Income'))                  as ebit,
  coalesce(max(value) filter (where item = 'EBITDA'),
           max(value) filter (where item = 'Normalized EBITDA'))                 as ebitda,
  max(value) filter (where item = 'Tax Rate For Calcs')                          as tax_rate,
  coalesce(max(value) filter (where item = 'Interest Expense'),
           max(value) filter (where item = 'Interest Expense Non Operating'))    as interest_expense,
  coalesce(max(value) filter (where item = 'Diluted EPS'),
           max(value) filter (where item = 'Basic EPS'))                         as diluted_eps,
  coalesce(max(value) filter (where item = 'Operating Cash Flow'),
           max(value) filter (where item = 'Cash Flow From Continuing Operating Activities')) as operating_cash_flow,
  coalesce(max(value) filter (where item = 'Capital Expenditure'),
           max(value) filter (where item = 'Purchase Of PPE'))                   as capital_expenditure,
  coalesce(max(value) filter (where item = 'Depreciation And Amortization'),
           max(value) filter (where item = 'Depreciation Amortization Depletion')) as depreciation_amortisation,
  max(value) filter (where item = 'Change In Working Capital')                   as change_in_working_capital,
  coalesce(max(value) filter (where item = 'Net Long Term Debt Issuance'),
           max(value) filter (where item = 'Net Issuance Payments Of Debt'))     as net_borrowing,
  coalesce(max(value) filter (where item = 'Cash Dividends Paid'),
           max(value) filter (where item = 'Common Stock Dividend Paid'))        as dividends_paid,
  max(value) filter (where item = 'Total Debt')                                  as total_debt,
  max(value) filter (where item = 'Capital Lease Obligations')                   as capital_lease_obligations,
  coalesce(max(value) filter (where item = 'Cash Cash Equivalents And Short Term Investments'),
           max(value) filter (where item = 'Cash And Cash Equivalents'))         as cash,
  coalesce(max(value) filter (where item = 'Stockholders Equity'),
           max(value) filter (where item = 'Common Stock Equity'),
           max(value) filter (where item = 'Total Equity Gross Minority Interest')) as stockholders_equity,
  -- Ordinary Shares Number first: Share Issued includes treasury stock.
  coalesce(max(value) filter (where item = 'Ordinary Shares Number'),
           max(value) filter (where item = 'Share Issued'))                      as shares
from raw.statement_items
where frequency = 'quarterly'
group by ticker, period_end;

-- Trailing twelve months, one row per ticker: flows summed over the four newest
-- quarters, stocks read from the newest one. A quarter more than a year before
-- the newest is not part of the same twelve months, so a gap in the history
-- lowers quarters_used instead of stretching the sum over five quarters.
create or replace view warehouse.fundamentals_ttm as
with ranked as (
  select
    *,
    row_number() over (partition by ticker order by period_end desc) as rn,
    max(period_end) over (partition by ticker)                       as newest
  from warehouse.fundamentals_quarterly
  -- A balance-sheet-only column carries no flows to sum.
  where coalesce(revenue, net_income, operating_cash_flow, ebit) is not null
),
last4 as (
  select * from ranked where rn <= 4 and period_end > newest - 370
)
select
  ticker,
  max(period_end)                         as latest_period_end,
  count(*)::int                           as quarters_used,
  sum(revenue)                            as ttm_revenue,
  sum(net_income)                         as ttm_net_income,
  sum(ebit)                               as ttm_ebit,
  sum(ebitda)                             as ttm_ebitda,
  sum(interest_expense)                   as ttm_interest_expense,
  sum(diluted_eps)                        as ttm_diluted_eps,
  sum(operating_cash_flow)                as ttm_operating_cash_flow,
  sum(capital_expenditure)                as ttm_capital_expenditure,
  sum(depreciation_amortisation)          as ttm_depreciation_amortisation,
  sum(change_in_working_capital)          as ttm_change_in_working_capital,
  sum(net_borrowing)                      as ttm_net_borrowing,
  sum(dividends_paid)                     as ttm_dividends_paid,
  avg(tax_rate)                           as avg_tax_rate,
  max(total_debt)          filter (where rn = 1) as total_debt,
  max(total_debt)          filter (where rn = 1)
    - coalesce(max(capital_lease_obligations) filter (where rn = 1), 0)
    - max(cash)            filter (where rn = 1) as net_debt,
  max(stockholders_equity) filter (where rn = 1) as stockholders_equity,
  max(shares)              filter (where rn = 1) as shares
from last4
group by ticker;

comment on view warehouse.fundamentals_ttm is
  'Trailing twelve months per ticker. quarters_used < 4 means the sums understate and the forward models refuse.';

-- Trailing dividend, growth and payment stability per ticker (replaces
-- engine._dividend_stats). A payer whose newest ex-date is more than 400 days
-- old has stopped, and gets no trailing dividend.
create or replace view warehouse.dividend_stats as
with d as (
  select
    ticker,
    ex_date,
    amount,
    max(ex_date) over (partition by ticker)                       as latest,
    row_number() over (partition by ticker order by ex_date desc) as rn
  from raw.dividends
),
agg as (
  select
    ticker,
    max(latest)                                                   as latest_ex_date,
    count(*)::int                                                 as payments,
    sum(amount) filter (where ex_date > latest - 365)             as trailing,
    -- The full year that starts five years before the newest payment.
    sum(amount) filter (where ex_date >  latest - 5 * 365
                          and ex_date <= latest - 4 * 365)        as early,
    avg(amount)        filter (where rn <= 8)                     as recent_mean,
    stddev_pop(amount) filter (where rn <= 8)                     as recent_sd,
    count(*)           filter (where rn <= 8)                     as recent_n
  from d
  group by ticker
)
select
  agg.ticker,
  agg.latest_ex_date,
  agg.payments,
  case when agg.latest_ex_date > a.as_of - 400 then agg.trailing end as trailing,
  case
    when agg.early > 0 and agg.trailing > 0
      then least(greatest(power(agg.trailing / agg.early, 1.0 / 4) - 1, -0.5), 0.5)
    else 0
  end                                                             as growth,
  -- 1 - coefficient of variation of the last eight payments, in [0, 1].
  case
    when agg.recent_n < 2 then 0.5
    when agg.recent_mean = 0 then 0.3
    else least(greatest(1 - agg.recent_sd / abs(agg.recent_mean), 0), 1)
  end                                                             as stability
from agg
cross join warehouse.as_of a;

-- ---------------------------------------------------------------------------
-- The reverse-DCF solver (ported from notebooks/backtest.ipynb cells 5, 7, 8)
-- ---------------------------------------------------------------------------

-- Linear path x_k = x0 + (x_L - x0) k / N for k = 1..N, reaching x_L in year N.
create or replace function warehouse.fade(x0 double precision, x_l double precision, n int)
returns double precision[]
language sql immutable strict parallel safe
as $$
  select array_agg(x0 + (x_l - x0) * k::double precision / n order by k)
  from generate_series(1, n) as k
$$;

-- x0 compounded along the faded growth path: x_t = x0 (1 + g_1)...(1 + g_t).
create or replace function warehouse.grow(x0 double precision, g0 double precision, g_l double precision, n int)
returns double precision[]
language plpgsql immutable strict parallel safe
as $$
declare
  g double precision[] := warehouse.fade(g0, g_l, n);
  path double precision[] := '{}';
  level double precision := x0;
begin
  for k in 1..n loop
    level := level * (1 + g[k]);
    path := path || level;
  end loop;
  return path;
end
$$;

-- PV of flows for years 1..N plus the Gordon terminal value flows_N (1 + g_L) / (r - g_L).
create or replace function warehouse.pv(r double precision, flows double precision[], g_l double precision)
returns double precision
language plpgsql immutable strict parallel safe
as $$
declare
  n int := array_length(flows, 1);
  total double precision := 0;
begin
  for t in 1..n loop
    total := total + flows[t] / (1 + r) ^ t;
  end loop;
  return total + flows[n] * (1 + g_l) / (r - g_l) / (1 + r) ^ n;
end
$$;

-- The implied return r that sets value(r) = price, by bisection on (g_L, r_max].
--
--   value(r) = base + PV(r, a) - r PV(r, b)
--
-- One form covers every model: cash-flow models have base = 0 and no b; the
-- residual income model's flows are (ROE_t - r) B_t-1 = a_t - r b_t with
-- base = B_0. Null when value(g_L) <= price or value(r_max) >= price, i.e. no
-- root in the bracket, exactly as the notebook's brentq guard.
create or replace function warehouse.implied_return(
  base double precision,
  a double precision[],
  b double precision[],
  g_l double precision,
  price double precision,
  r_max double precision
)
returns double precision
language plpgsql immutable parallel safe
as $$
declare
  lo double precision := g_l + 1e-6;
  hi double precision := r_max;
  mid double precision;
  gap_lo double precision;
  gap_hi double precision;
  gap_mid double precision;
begin
  if a is null or g_l is null or price is null or base is null then
    return null;
  end if;

  gap_lo := base + warehouse.pv(lo, a, g_l) - lo * coalesce(warehouse.pv(lo, b, g_l), 0) - price;
  gap_hi := base + warehouse.pv(hi, a, g_l) - hi * coalesce(warehouse.pv(hi, b, g_l), 0) - price;
  -- Postgres sorts NaN above every number, so test it explicitly.
  if gap_lo is null or gap_hi is null or gap_lo = 'NaN' or gap_hi = 'NaN'
     or not (gap_lo > 0 and gap_hi < 0) then
    return null;
  end if;

  for i in 1..100 loop
    mid := (lo + hi) / 2;
    gap_mid := base + warehouse.pv(mid, a, g_l) - mid * coalesce(warehouse.pv(mid, b, g_l), 0) - price;
    if gap_mid > 0 then lo := mid; else hi := mid; end if;
    exit when hi - lo < 1e-12;
  end loop;
  return (lo + hi) / 2;
end
$$;

-- Reverse FCFF (against EV) and shareholder yield (against market cap): a cash
-- flow cf0 growing along the fade.
create or replace function warehouse.implied_return_cashflow(
  cf0 double precision, g0 double precision, g_l double precision, price double precision,
  n int, r_max double precision
)
returns double precision
language sql immutable parallel safe
as $$
  select case
    when cf0 > 0 and price > 0
      then warehouse.implied_return(0, warehouse.grow(cf0, g0, g_l, n), null, g_l, price, r_max)
  end
$$;

-- Reverse revenue: EV = PV(revenue x FCFF margin), revenue growing along the
-- fade and the margin fading from the firm's own to its sector median. A
-- negative terminal margin cannot be solved.
create or replace function warehouse.implied_return_revenue(
  rev0 double precision, g0 double precision, g_l double precision,
  m0 double precision, m_l double precision, ev double precision,
  n int, r_max double precision
)
returns double precision
language plpgsql immutable parallel safe
as $$
declare
  revenue double precision[];
  margin double precision[];
  flows double precision[] := '{}';
begin
  if not (rev0 > 0 and m_l > 0 and ev > 0) or g0 is null or m0 is null then
    return null;
  end if;
  revenue := warehouse.grow(rev0, g0, g_l, n);
  margin := warehouse.fade(m0, m_l, n);
  for t in 1..n loop
    flows := flows || revenue[t] * margin[t];
  end loop;
  return warehouse.implied_return(0, flows, null, g_l, ev, r_max);
end
$$;

-- Reverse residual income: market cap = B0 + PV(residual income),
-- RI_t = (ROE_t - r) B_t-1. ROE fades from the firm's own to its sector median;
-- book grows by retained earnings (clean surplus).
create or replace function warehouse.implied_return_rim(
  b0 double precision, roe0 double precision, roe_l double precision,
  payout double precision, g_l double precision, price double precision,
  n int, r_max double precision
)
returns double precision
language plpgsql immutable parallel safe
as $$
declare
  roe double precision[];
  b_prev double precision[];
  a double precision[] := '{}';
begin
  if not (b0 > 0 and price > 0) or roe0 is null or roe_l is null or payout is null then
    return null;
  end if;
  roe := warehouse.fade(roe0, roe_l, n);
  b_prev := array[b0];
  for t in 2..n loop
    b_prev := b_prev || b_prev[t - 1] * (1 + roe[t - 1] * (1 - payout));
  end loop;
  for t in 1..n loop
    a := a || roe[t] * b_prev[t];
  end loop;
  return warehouse.implied_return(b0, a, b_prev, g_l, price, r_max);
end
$$;

-- ---------------------------------------------------------------------------
-- Forward-model helpers (ported from api/valuation.py)
-- ---------------------------------------------------------------------------

-- A cash flow growing at `growth` for `years`, then at `terminal` in
-- perpetuity. Null below the minimum discount spread, where the perpetuity is
-- numerically meaningless.
create or replace function warehouse.two_stage_pv(
  base double precision, growth double precision, discount double precision,
  terminal double precision default 0.03, years int default 10
)
returns double precision
language plpgsql immutable strict parallel safe
as $$
declare
  total double precision := 0;
  flow double precision := base;
begin
  if discount - terminal < 0.02 then
    return null;
  end if;
  for t in 1..years loop
    flow := flow * (1 + growth);
    total := total + flow / (1 + discount) ^ t;
  end loop;
  return total + flow * (1 + terminal) / (discount - terminal) / (1 + discount) ^ years;
end
$$;

-- Residual income: book plus earnings above the cost of equity for `years`,
-- book carried forward by retained earnings.
create or replace function warehouse.residual_income_value(
  book double precision, eps double precision, ke double precision,
  retention double precision, years int default 10
)
returns double precision
language sql immutable strict parallel safe
as $$
  select book + sum((eps - ke * (book + (y - 1) * eps * retention)) / (1 + ke) ^ y)
  from generate_series(1, years) as y
$$;

-- ---------------------------------------------------------------------------
-- Materialised layers
-- ---------------------------------------------------------------------------

-- Market-level inputs at the as-of date. One row.
create materialized view warehouse.market as
with a as (
  select as_of from warehouse.as_of
),
index_closes as (
  select
    p.date,
    p.close,
    lag(p.close) over (order by p.date)               as previous_close,
    ln(p.close / lag(p.close) over (order by p.date)) as log_return
  from raw.daily_prices p, a
  where p.ticker = '^GSPC' and p.date <= a.as_of and p.date > a.as_of - 400
)
select
  a.as_of,
  -- Spot 10-year yield: the maturity-matched rate for discounting long-lived
  -- cash flows. Every model and the required returns use it.
  (select p.close / 100 from raw.daily_prices p
    where p.ticker = '^TNX' and p.date <= a.as_of
    order by p.date desc limit 1)                                   as risk_free_rate,
  -- 13-week bill, 252-day average: the cash rate the optimiser's Sharpe ratio
  -- is measured against.
  (select avg(x.close) / 100 from (
     select p.close from raw.daily_prices p
     where p.ticker = '^IRX' and p.date <= a.as_of
     order by p.date desc limit 252) x)                             as short_rate,
  -- Factor premia known before the as-of date: expanding arithmetic average
  -- since 1963, annualised (DWimplementation_v2.sql, `rates`).
  f.prem_mkt, f.prem_smb, f.prem_hml, f.prem_rmw, f.prem_cma,
  f.factors_through,
  '^GSPC'::text                                                     as index_ticker,
  (select close from index_closes order by date desc limit 1)       as index_close,
  (select close / nullif(previous_close, 0) - 1
     from index_closes order by date desc limit 1)                  as index_change,
  -- The benchmark's annualised mean log return over 252 sessions.
  (select avg(x.log_return) * 252 from (
     select log_return from index_closes
     where log_return is not null
     order by date desc limit 252) x)                               as market_return
from a
cross join lateral (
  select
    avg(fr.mkt_rf) * 252 as prem_mkt,
    avg(fr.smb)    * 252 as prem_smb,
    avg(fr.hml)    * 252 as prem_hml,
    avg(fr.rmw)    * 252 as prem_rmw,
    avg(fr.cma)    * 252 as prem_cma,
    max(fr.date)         as factors_through
  from raw.factor_returns fr
  where fr.date < a.as_of
) f;

create unique index market_as_of_idx on warehouse.market (as_of);

-- Return statistics, betas and momentum per ticker, over trading-day windows
-- ending at the as-of date. Returns are on dividend-adjusted closes.
create materialized view warehouse.price_stats as
with a as (
  select as_of from warehouse.as_of
),
bars as (
  select
    p.ticker,
    p.date,
    p.close,
    p.adj_close,
    row_number() over w                                  as rn,
    ln(p.adj_close / nullif(lag(p.adj_close) over w2, 0)) as log_return,
    p.adj_close / nullif(lag(p.adj_close) over w2, 0) - 1 as simple_return
  from raw.daily_prices p, a
  where p.date <= a.as_of
    and p.date > a.as_of - 550
    and p.ticker in (select ticker from raw.company_profile where in_universe)
  window w  as (partition by p.ticker order by p.date desc),
         w2 as (partition by p.ticker order by p.date)
),
index_returns as (
  select p.date, ln(p.close / lag(p.close) over (order by p.date)) as index_log_return
  from raw.daily_prices p, a
  where p.ticker = '^GSPC' and p.date <= a.as_of and p.date > a.as_of - 550
),
-- The newest beta_days factor dates, which lag prices by weeks.
factor_window as (
  select fr.date, fr.mkt_rf, fr.rf
  from raw.factor_returns fr, a
  where fr.date <= a.as_of
  order by fr.date desc
  limit (select beta_days from warehouse.spec)
),
stats as (
  select
    b.ticker,
    max(b.close)      filter (where b.rn = 1)   as price,
    max(b.date)       filter (where b.rn = 1)   as price_date,
    -- 12-1 momentum: the return from 252 to 21 sessions back.
    max(b.adj_close)  filter (where b.rn = 22)  as adj_close_1m,
    max(b.adj_close)  filter (where b.rn = 253) as adj_close_12m,
    avg(b.log_return)         filter (where b.rn <= 252) * 252       as realised_return,
    stddev_samp(b.log_return) filter (where b.rn <= 252) * sqrt(252) as volatility,
    regr_slope(b.log_return, i.index_log_return) filter (where b.rn <= 252) as beta_252,
    count(b.log_return)       filter (where b.rn <= 252)::int        as observations
  from bars b
  left join index_returns i using (date)
  group by b.ticker
),
capm as (
  -- OLS slope of daily excess returns on the market factor.
  select b.ticker, regr_slope(b.simple_return - f.rf, f.mkt_rf) as beta, count(*)::int as n
  from bars b
  join factor_window f using (date)
  where b.simple_return is not null
  group by b.ticker
)
select
  s.ticker,
  s.price,
  s.price_date,
  s.realised_return,
  s.volatility,
  s.beta_252,
  s.observations,
  s.adj_close_1m / nullif(s.adj_close_12m, 0) - 1                    as momentum,
  case when c.n >= (select min_beta_obs from warehouse.spec) then c.beta end as beta_capm,
  c.n                                                                as beta_obs
from stats s
left join capm c using (ticker);

create unique index price_stats_ticker_idx on warehouse.price_stats (ticker);

-- One row per stock in the universe: the newest point-in-time annual statement,
-- the price, shares and rates at the as-of date, and the required returns.
-- (DWimplementation_v2.sql's backtest.models, for one date instead of every
-- month-end, plus notebook cells 5, 7 and 12.)
create materialized view warehouse.inputs as
with a as (
  select as_of from warehouse.as_of
),
statement as (
  select distinct on (f.ticker) f.*
  from warehouse.fundamentals_annual f, a, warehouse.spec s
  where f.period_end + s.pit_lag_days <= a.as_of
    and f.period_end > a.as_of - s.stale_days
  order by f.ticker, f.period_end desc
),
shares as (
  -- Median, because Yahoo interleaves two share-count sources.
  select sa.ticker, percentile_cont(0.5) within group (order by sa.shares) as shares
  from warehouse.shares_adjusted sa, a, warehouse.spec s
  where sa.date <= a.as_of and sa.date > a.as_of - s.shares_window_days
  group by sa.ticker
),
base as (
  select
    c.ticker,
    c.name,
    c.sector,
    c.industry,
    a.as_of,
    ps.price,
    ps.price_date,
    ps.realised_return,
    ps.volatility,
    ps.beta_252,
    ps.observations,
    ps.momentum,
    ps.beta_capm,
    st.period_end,
    a.as_of - st.period_end                                  as staleness,
    st.ebit, st.tax, st.dna, st.capex, st.dnwc, st.cash, st.capital_lease_obligations,
    st.total_debt, st.net_debt, st.interest_expense, st.debt_cost, st.fcff,
    st.book_equity, st.net_income, st.dividends_paid, st.net_stock_issuance,
    st.revenue, st.operating_income, st.invested_capital, st.ebitda,
    st.g0_raw, st.g0,
    sh.shares,
    ps.price * sh.shares                                     as equity,
    m.risk_free_rate                                         as rf,
    m.prem_mkt,
    least(sp.long_run_growth, m.risk_free_rate)              as g_l
  from raw.company_profile c
  cross join a
  cross join warehouse.market m
  cross join warehouse.spec sp
  left join warehouse.price_stats ps using (ticker)
  left join statement st using (ticker)
  left join shares sh using (ticker)
  where c.in_universe
),
derived as (
  select
    b.*,
    b.equity + b.net_debt                                    as ev,
    coalesce(b.g0, b.g_l)                                    as g0_used,
    b.g0 is null                                             as g0_missing,
    b.net_income / nullif(greatest(b.book_equity, 0), 0)     as roe,
    b.fcff / nullif(greatest(b.revenue, 0), 0)               as margin,
    -- Dividends only; a loss year retains nothing.
    case when b.net_income > 0
      then least(greatest(-b.dividends_paid / b.net_income, 0), 1)
      else 0
    end                                                      as payout,
    -- Dividends plus net buybacks, both stored negative when cash leaves.
    -(coalesce(b.dividends_paid, 0) + coalesce(b.net_stock_issuance, 0)) as shareholder_payout,
    -- CAPM cost of equity against the long-run market premium (BENCHMARK = 'CAPM').
    b.rf + b.beta_capm * b.prem_mkt                          as ke,
    -- Interest over debt ex leases, clamped; rf + 2% where there is no figure.
    least(greatest(coalesce(b.debt_cost, b.rf + 0.02), 0.02), 0.15) as kd,
    greatest(coalesce(b.total_debt - coalesce(b.capital_lease_obligations, 0), 0), 0) as debt_ex_leases
  from base b
),
sector_medians as (
  select
    sector,
    case when count(roe) >= (select min_peers from warehouse.spec)
      then percentile_cont(0.5) within group (order by roe) end    as roe_sector,
    case when count(margin) >= (select min_peers from warehouse.spec)
      then percentile_cont(0.5) within group (order by margin) end as margin_sector
  from derived
  where sector is not null
  group by sector
)
select
  d.*,
  sm.roe_sector,
  sm.margin_sector,
  d.debt_ex_leases / nullif(d.debt_ex_leases + d.equity, 0)          as debt_weight,
  (1 - d.debt_ex_leases / nullif(d.debt_ex_leases + d.equity, 0)) * d.ke
    + d.debt_ex_leases / nullif(d.debt_ex_leases + d.equity, 0) * d.kd * (1 - d.tax) as wacc
from derived d
left join sector_medians sm using (sector);

create unique index inputs_ticker_idx on warehouse.inputs (ticker);

-- The tested signal: four reverse-DCF expected alphas and their average,
-- 12-1 momentum, the latest earnings surprise, and each one's percentile in
-- today's universe. Alphas are r - WACC for firm-level models (FCFF, revenue)
-- and r - Ke for equity-level ones (RIM, shareholder yield).
create materialized view warehouse.signals as
with solved as (
  select
    i.ticker,
    i.as_of,
    i.price,
    i.ke,
    i.wacc,
    i.momentum,
    warehouse.implied_return_cashflow(i.fcff, i.g0_used, i.g_l, i.ev, s.horizon_years, s.r_max) as r_fcff,
    warehouse.implied_return_rim(i.book_equity, i.roe, i.roe_sector, i.payout, i.g_l, i.equity,
                                 s.horizon_years, s.r_max)                                  as r_rim,
    warehouse.implied_return_revenue(i.revenue, i.g0_used, i.g_l, i.margin, i.margin_sector, i.ev,
                                     s.horizon_years, s.r_max)                              as r_rev,
    warehouse.implied_return_cashflow(i.shareholder_payout, i.g0_used, i.g_l, i.equity,
                                      s.horizon_years, s.r_max)                             as r_shy
  from warehouse.inputs i
  cross join warehouse.spec s
),
surprise as (
  -- The latest report strictly before the as-of date, if within ~a quarter.
  select distinct on (e.ticker)
    e.ticker,
    e.report_date,
    e.reported_eps - e.eps_estimate as eps_surprise
  from raw.earnings e, warehouse.as_of a, warehouse.spec s
  where e.report_date < a.as_of
    and e.report_date >= a.as_of - s.surprise_window_days
    and e.eps_estimate is not null
    and e.reported_eps is not null
  order by e.ticker, e.report_date desc
),
alphas as (
  select
    sv.*,
    sv.r_fcff - sv.wacc as alpha_fcff,
    sv.r_rim  - sv.ke   as alpha_rim,
    sv.r_rev  - sv.wacc as alpha_rev,
    sv.r_shy  - sv.ke   as alpha_shy,
    su.report_date      as surprise_date,
    su.eps_surprise / nullif(sv.price, 0) as surprise
  from solved sv
  left join surprise su using (ticker)
),
components as (
  select
    a.*,
    -- Equal-weight average of whichever kept models are available (test 3).
    (select avg(x) from unnest(array[a.alpha_fcff, a.alpha_rim, a.alpha_rev, a.alpha_shy]) as x) as value
  from alphas a
)
select
  c.*,
  -- Percentile within today's universe among stocks with the component, so
  -- every component is on the same 0-1 scale (the arithmetic the blends were
  -- tested with). Null where the component is.
  case when c.value    is not null then cume_dist() over (partition by c.value    is null order by c.value)    end as value_rank,
  case when c.momentum is not null then cume_dist() over (partition by c.momentum is null order by c.momentum) end as momentum_rank,
  case when c.surprise is not null then cume_dist() over (partition by c.surprise is null order by c.surprise) end as surprise_rank
from components c;

create unique index signals_ticker_idx on warehouse.signals (ticker);

-- The five forward (fair-value) models, one row per verdict. Ported from
-- api/valuation.py and api/engine.py with these changes (backtests.md §17):
--   * cost of equity is CAPM against the long-run market premium, clamped to
--     [6%, 20%], instead of the FF5 regression; rf is the spot 10-year yield;
--   * growth, payout, EPS and book come from the statements instead of
--     yfinance's .info snapshot (growth = half the trailing revenue CAGR,
--     capped to [0, 12%], 4% when unknown, the dashboard's old rule);
--   * FCFF adds the working-capital change, which yfinance reports with its
--     cash-flow sign; net debt excludes leases and nets short-term investments.
-- A model that does not apply produces no row. Absence is the signal.
create materialized view warehouse.forward_valuations as
with base as (
  select
    i.ticker,
    i.sector,
    i.price,
    i.rf,
    i.g0_raw,
    coalesce(t.shares, i.shares)                                   as shares,
    coalesce(t.quarters_used, 0)                                   as quarters,
    t.ttm_ebit, t.ttm_ebitda, t.ttm_interest_expense, t.ttm_diluted_eps,
    t.ttm_operating_cash_flow, t.ttm_capital_expenditure, t.ttm_depreciation_amortisation,
    t.ttm_change_in_working_capital, t.ttm_net_borrowing, t.total_debt, t.net_debt,
    t.stockholders_equity, t.ttm_net_income, t.ttm_dividends_paid,
    least(greatest(i.rf + coalesce(i.beta_capm, i.beta_252) * i.prem_mkt, 0.06), 0.20) as ke,
    case when i.g0_raw is null then 0.04 else least(greatest(0.5 * i.g0_raw, 0), 0.12) end as growth,
    t.avg_tax_rate is null                                         as imputed_tax,
    least(greatest(coalesce(t.avg_tax_rate, 0.21), 0), 0.5)        as tax,
    case when t.ttm_net_income > 0 then -t.ttm_dividends_paid / t.ttm_net_income end as payout,
    d.trailing                                                     as dividend,
    d.growth                                                       as dividend_growth,
    d.payments,
    d.stability
  from warehouse.inputs i
  left join warehouse.fundamentals_ttm t using (ticker)
  left join warehouse.dividend_stats d using (ticker)
  where i.price > 0
),
rates as (
  -- WACC exactly as api/valuation.py's wacc_components: yield on gross debt,
  -- net-debt weights, the debt weight capped at 60%, clamped to [3%, 20%].
  select
    b.*,
    b.price * b.shares as equity_mv,
    least(greatest(
      case when coalesce(b.total_debt, 0) > 0 and b.ttm_interest_expense > 0
        then b.ttm_interest_expense / b.total_debt
        else b.rf + 0.02 end, 0.02), 0.15)                          as kd,
    least(greatest(coalesce(b.net_debt, 0), 0)
          / nullif(b.price * b.shares + greatest(coalesce(b.net_debt, 0), 0), 0), 0.60) as debt_weight
  from base b
),
rates2 as (
  select
    r.*,
    least(greatest((1 - r.debt_weight) * r.ke + r.debt_weight * r.kd * (1 - r.tax), 0.03), 0.20) as wacc
  from rates r
),
multiples as (
  -- Sector median EV/EBITDA and P/E, each withheld below five usable peers.
  select
    sector,
    case when count(ev_ebitda) >= 5 then percentile_cont(0.5) within group (order by ev_ebitda) end as ev_ebitda,
    case when count(pe) >= 5        then percentile_cont(0.5) within group (order by pe)        end as pe
  from (
    select
      sector,
      case when ttm_ebitda > 0 and equity_mv + coalesce(net_debt, 0) > 0
        then (equity_mv + coalesce(net_debt, 0)) / ttm_ebitda end as ev_ebitda,
      case when ttm_diluted_eps > 0 then price / ttm_diluted_eps end as pe
    from rates2
    where quarters >= 4 and sector is not null and shares > 0
  ) peers
  group by sector
),
candidates as (
  -- Dividend discount: the trailing dividend grown at half its 5-year CAGR
  -- (max 6%), then 3% forever. Payers yielding under 1.5% are not described.
  select ticker, 'ddm' as method, price,
    warehouse.two_stage_pv(dividend, least(0.06, greatest(0, dividend_growth) * 0.5), ke) as fair_value,
    0.60 * stability * case when payout > 0.9 then 0.6 else 1 end as confidence
  from rates2
  where dividend > 0 and payments >= 8 and dividend / price >= 0.015

  union all
  -- Free cash flow to equity at the cost of equity.
  select ticker, 'fcfe', price,
    warehouse.two_stage_pv(fcfe, least(growth, 0.06), ke) / shares,
    0.75 * case when coalesce(ttm_net_borrowing, 0) > 0.5 * fcfe then 0.6 else 1 end
  from (
    select *, ttm_operating_cash_flow + ttm_capital_expenditure + coalesce(ttm_net_borrowing, 0) as fcfe
    from rates2
    where coalesce(sector, '') not in ('Financial Services', 'Real Estate')
      and quarters >= 4 and shares > 0
  ) x
  where fcfe > 0 and ke - greatest(0, growth) >= 0.02

  union all
  -- Free cash flow to the firm at WACC, bridged to equity by net debt.
  select ticker, 'fcff', price,
    (warehouse.two_stage_pv(fcff, least(growth, 0.06), wacc) - coalesce(net_debt, 0)) / shares,
    0.80 * case when imputed_tax then 0.8 else 1 end
  from (
    select *, ttm_ebit * (1 - tax) + coalesce(ttm_depreciation_amortisation, 0)
              + ttm_capital_expenditure + coalesce(ttm_change_in_working_capital, 0) as fcff
    from rates2
    where coalesce(sector, '') not in ('Financial Services', 'Real Estate')
      and quarters >= 4 and shares > 0 and equity_mv > 0
  ) x
  where fcff > 0 and wacc - greatest(0, growth) >= 0.02

  union all
  -- Residual income: book plus earnings above the cost of equity.
  select ticker, 'rim', price,
    warehouse.residual_income_value(
      stockholders_equity / nullif(shares, 0), ttm_diluted_eps, ke,
      1 - case when payout between 0 and 1 then payout else 0.4 end),
    0.35 * least(1, quarters / 4.0)
  from rates2
  where stockholders_equity / nullif(shares, 0) > 0 and ttm_diluted_eps is not null and quarters >= 4

  union all
  -- Comparables: the average of the values implied by the sector's median
  -- EV/EBITDA and P/E.
  select r.ticker, 'comps', r.price,
    (select avg(v) from unnest(array[
      case when m.ev_ebitda is not null and r.ttm_ebitda > 0
            and m.ev_ebitda * r.ttm_ebitda - coalesce(r.net_debt, 0) > 0
        then (m.ev_ebitda * r.ttm_ebitda - coalesce(r.net_debt, 0)) / r.shares end,
      case when m.pe is not null and r.ttm_diluted_eps > 0
        then m.pe * r.ttm_diluted_eps end
    ]) as v),
    0.55
  from rates2 r
  join multiples m using (sector)
  where r.quarters >= 4 and r.shares > 0
),
verdicts as (
  -- A fair value at or below zero, or ten times off the price in either
  -- direction, means the model's assumptions broke.
  select *
  from candidates
  where fair_value > 0 and fair_value between price / 10 and price * 10
)
select
  v.ticker,
  v.method,
  v.fair_value,
  (v.fair_value - v.price) / v.price as margin_of_safety,
  -- FCFE and FCFF discount the same cash generation two ways; when both speak
  -- each gets 1/sqrt(2) of a vote.
  least(greatest(v.confidence, 0), 1)
    * case when v.method in ('fcfe', 'fcff')
            and count(*) filter (where v.method in ('fcfe', 'fcff')) over (partition by v.ticker) = 2
           then 1 / sqrt(2) else 1 end   as confidence,
  v.price                                as price_at_calc
from verdicts v;

create unique index forward_valuations_key_idx on warehouse.forward_valuations (ticker, method);

-- The discount rates the forward models used, per ticker, for the stock page.
create or replace view warehouse.discount_rates as
with b as (
  select
    i.ticker,
    i.rf,
    i.price * coalesce(t.shares, i.shares)                                    as equity_mv,
    least(greatest(i.rf + coalesce(i.beta_capm, i.beta_252) * i.prem_mkt, 0.06), 0.20) as ke,
    i.rf + coalesce(i.beta_capm, i.beta_252) * i.prem_mkt                     as capm_ke,
    least(greatest(coalesce(t.avg_tax_rate, 0.21), 0), 0.5)                   as tax,
    least(greatest(
      case when coalesce(t.total_debt, 0) > 0 and t.ttm_interest_expense > 0
        then t.ttm_interest_expense / t.total_debt else i.rf + 0.02 end, 0.02), 0.15) as kd,
    greatest(coalesce(t.net_debt, 0), 0)                                      as weight_debt,
    coalesce(t.quarters_used, 0)                                              as quarters
  from warehouse.inputs i
  left join warehouse.fundamentals_ttm t using (ticker)
)
select
  ticker,
  rf,
  ke                                                             as cost_of_equity,
  capm_ke                                                        as capm_cost_of_equity,
  case when quarters >= 4 and equity_mv > 0 then kd end          as cost_of_debt,
  case when quarters >= 4 and equity_mv > 0 then tax end         as tax_rate,
  case when quarters >= 4 and equity_mv > 0
    then 1 - least(weight_debt / nullif(equity_mv + weight_debt, 0), 0.60) end as equity_weight,
  case when quarters >= 4 and equity_mv > 0
    then least(greatest(
      (1 - least(weight_debt / nullif(equity_mv + weight_debt, 0), 0.60)) * ke
      + least(weight_debt / nullif(equity_mv + weight_debt, 0), 0.60) * kd * (1 - tax),
      0.03), 0.20) end                                           as wacc
from b;

-- One row per stock in the universe with a price, shaped for the screener and
-- the stock page. public.screener serves it.
create materialized view warehouse.stock_snapshot as
with verdicts as (
  select
    ticker,
    jsonb_agg(jsonb_build_object(
      'method', method,
      'fair_value', round(fair_value::numeric, 4),
      'margin_of_safety', round(margin_of_safety::numeric, 6),
      'confidence', round(confidence::numeric, 4)
    ) order by method)                                            as verdicts,
    sum(margin_of_safety * confidence) / nullif(sum(confidence), 0) as consensus_margin,
    count(*)::int                                                 as models
  from warehouse.forward_valuations
  group by ticker
)
select
  i.ticker,
  coalesce(i.name, i.ticker)                                      as name,
  coalesce(i.sector, 'Unclassified')                              as sector,
  i.as_of,
  i.price,
  i.price * coalesce(t.shares, i.shares) / 1e9                    as market_cap_bn,
  i.beta_252                                                      as beta,
  i.realised_return,
  i.volatility,
  case when t.ttm_diluted_eps > 0 then i.price / t.ttm_diluted_eps end as pe_ratio,
  coalesce(d.trailing / nullif(i.price, 0), 0)                    as dividend_yield,
  coalesce(v.verdicts, '[]'::jsonb)                               as verdicts,
  case when v.consensus_margin is not null then jsonb_build_object(
    'margin_of_safety', round(v.consensus_margin::numeric, 6),
    'fair_value', round((i.price * (1 + v.consensus_margin))::numeric, 4),
    'models', v.models
  ) end                                                           as consensus,
  jsonb_build_object(
    'risk_free', dr.rf,
    'cost_of_equity', dr.cost_of_equity,
    'cost_of_equity_source', 'capm',
    'capm_cost_of_equity', dr.capm_cost_of_equity,
    'wacc', dr.wacc,
    'cost_of_debt', dr.cost_of_debt,
    'equity_weight', dr.equity_weight,
    'tax_rate', dr.tax_rate
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
    'required_return_firm', s.wacc
  )                                                               as signals
from warehouse.inputs i
left join warehouse.fundamentals_ttm t using (ticker)
left join warehouse.dividend_stats d using (ticker)
left join warehouse.discount_rates dr using (ticker)
left join warehouse.signals s using (ticker)
left join verdicts v using (ticker)
where i.price is not null;

create unique index stock_snapshot_ticker_idx on warehouse.stock_snapshot (ticker);

-- ---------------------------------------------------------------------------
-- Archives
-- ---------------------------------------------------------------------------

-- Every refresh's signal, by market date: the forward track record the
-- holdout cannot provide (it ends in Oct 2026).
create table if not exists warehouse.signal_history (
  as_of          date not null,
  ticker         text not null,
  price          double precision,
  alpha_fcff     double precision,
  alpha_rim      double precision,
  alpha_rev      double precision,
  alpha_shy      double precision,
  value          double precision,
  momentum       double precision,
  surprise       double precision,
  value_rank     double precision,
  momentum_rank  double precision,
  surprise_rank  double precision,
  computed_at    timestamptz not null default now(),
  primary key (as_of, ticker)
);

create index if not exists signal_history_ticker_idx
  on warehouse.signal_history (ticker, as_of desc);

-- Every refresh's forward verdicts, by market date (formerly
-- public.valuation_history, carried over by the serving migration).
create table if not exists warehouse.valuation_history (
  as_of             date not null,
  ticker            text not null,
  method            text not null,
  fair_value        double precision not null,
  margin_of_safety  double precision not null,
  confidence        double precision not null,
  price_at_calc     double precision not null,
  computed_at       timestamptz not null default now(),
  primary key (as_of, ticker, method)
);

create index if not exists valuation_history_ticker_idx
  on warehouse.valuation_history (ticker, as_of desc);

-- ---------------------------------------------------------------------------
-- Refresh
-- ---------------------------------------------------------------------------

-- Rebuild every layer in dependency order and archive the day. Called by the
-- service after each ingest. CONCURRENTLY, so the site keeps reading the old
-- rows until the new ones are ready rather than blocking on the refresh.
--
-- A rerun on the same market date replaces that date's archive rows, so a
-- model that stopped applying between two runs loses its row there too.
create or replace function warehouse.refresh()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_as_of date;
  started timestamptz := clock_timestamp();
begin
  refresh materialized view concurrently warehouse.market;
  refresh materialized view concurrently warehouse.price_stats;
  refresh materialized view concurrently warehouse.inputs;
  refresh materialized view concurrently warehouse.signals;
  refresh materialized view concurrently warehouse.forward_valuations;
  refresh materialized view concurrently warehouse.stock_snapshot;

  select as_of into v_as_of from warehouse.market;
  if v_as_of is null then
    return jsonb_build_object('as_of', null, 'stocks', 0);
  end if;

  delete from warehouse.signal_history where as_of = v_as_of;
  insert into warehouse.signal_history (
    as_of, ticker, price, alpha_fcff, alpha_rim, alpha_rev, alpha_shy,
    value, momentum, surprise, value_rank, momentum_rank, surprise_rank)
  select v_as_of, ticker, price, alpha_fcff, alpha_rim, alpha_rev, alpha_shy,
         value, momentum, surprise, value_rank, momentum_rank, surprise_rank
  from warehouse.signals
  where price is not null;

  delete from warehouse.valuation_history where as_of = v_as_of;
  insert into warehouse.valuation_history (
    as_of, ticker, method, fair_value, margin_of_safety, confidence, price_at_calc)
  select v_as_of, ticker, method, fair_value, margin_of_safety, confidence, price_at_calc
  from warehouse.forward_valuations;

  return jsonb_build_object(
    'as_of', v_as_of,
    'stocks', (select count(*) from warehouse.stock_snapshot),
    'signals', jsonb_build_object(
      'value', (select count(value) from warehouse.signals),
      'momentum', (select count(momentum) from warehouse.signals),
      'surprise', (select count(surprise) from warehouse.signals)),
    'verdicts', (select count(*) from warehouse.forward_valuations),
    'duration_seconds', round(extract(epoch from clock_timestamp() - started)::numeric, 1)
  );
end
$$;

comment on function warehouse.refresh() is
  'Rebuilds every materialised layer in dependency order and archives the day''s signal and verdicts. Called by python-api/pipeline.py after each ingest.';

-- Functions are executable by PUBLIC by default; nothing outside the service
-- has a reason to run the solver or trigger a refresh.
revoke execute on all functions in schema warehouse from public, anon, authenticated;
grant execute on all functions in schema warehouse to service_role;
grant select on all tables in schema warehouse to service_role;
