-- Specification revision: every constant sourced, no silent fallbacks.
-- (.claude/plans/overhaul.md §5; backtests.md §18 records the re-run.)
--
-- Four changes to the inputs the value signal is computed from. Each replaces
-- an ad hoc rule with the accepted method for that quantity:
--
--   1. Beta: Levi & Welch (2017, "Best practice for cost-of-capital
--      estimates", eq. 1): the 252-day daily CAPM beta, Vasicek-shrunk toward
--      the cross-sectional mean by its own standard error, then shrunk 25%
--      toward 0.9, the mean beta of the largest size tertile. Industry priors
--      are deliberately not used: the paper finds they have almost no
--      predictive power. One beta is now used everywhere: the screener column
--      and the cost of equity.
--   2. Cost of debt: Damodaran's synthetic rating (interest coverage ->
--      rating -> default spread over the 10-year yield), replacing interest /
--      debt clamped to [2%, 15%] with rf + 2% when missing. No interest figure
--      means no cost of debt, not a guess.
--   3. Financial Services: no WACC, so the firm-level models (FCFF, revenue)
--      do not apply. Debt is a bank's raw material, not its capital
--      (Damodaran); RIM and shareholder yield still value them.
--   4. Trailing revenue growth: winsorised at the 1st/99th percentile of the
--      cross-section, replacing a fixed [-10%, +25%] clamp.
--
-- The backtest notebook applies the same four rules, and its development-
-- period results were re-run before this migration (lib/signals.ts holds the
-- new ICs).

drop view warehouse.spec cascade;

-- Every constant the signal and the models read, with its source. Values
-- marked "judgement" have no canonical figure; each one withholds a reading
-- rather than imputing one when its threshold is not met.
create view warehouse.spec as
select
  -- SEC Form 10-K deadline for large accelerated filers: 60 days after year end.
  60    as pit_lag_days,
  -- 60 + 365 + slack for 52/53-week fiscal years: a statement older than a
  -- full year past its deadline is stale.
  440   as stale_days,
  -- Judgement: median of split-adjusted share counts over 90 days, because
  -- Yahoo interleaves two share-count sources.
  90    as shares_window_days,
  -- Explicit forecast period before the terminal value: within Damodaran's
  -- 5-10 year high-growth window; robustness-checked at 3 and 10 (backtest).
  5     as horizon_years,
  -- Long-run nominal growth, capped at the risk-free rate in warehouse.inputs:
  -- a firm cannot outgrow the economy forever (Damodaran).
  0.025::double precision as long_run_growth,
  -- Numerical bracket for the root solver, not a modelling choice.
  1.0::double precision   as r_max,
  -- Judgement: a sector statistic from fewer firms is withheld.
  5     as min_peers,
  -- One year of daily returns: within Levi & Welch's (2017) 1-4 year window.
  252   as beta_days,
  -- Judgement: under ~half the window, no beta. Fama-French require 24 of 60
  -- months (40%) for the same purpose.
  120   as min_beta_obs,
  -- Levi & Welch (2017) eq. (1): after Vasicek, shrink beta a further 25%
  -- toward the target for the stock's size tertile. Every S&P 500 member is
  -- in the largest tertile, whose mean beta they report as ~0.9.
  0.25::double precision  as beta_second_shrink,
  0.9::double precision   as beta_target,
  -- Winsorisation percentiles for trailing growth: the standard 1st/99th
  -- percentile outlier treatment in empirical finance.
  0.01::double precision  as winsor_lower,
  0.99::double precision  as winsor_upper,
  -- Judgement: an earnings surprise counts for one fiscal quarter plus a
  -- week's slack after the report.
  100   as surprise_window_days;

comment on view warehouse.spec is
  'The frozen specification: every constant the signal and the models read, with its source. Mirrors notebooks/backtest.ipynb.';

-- Damodaran's interest-coverage to synthetic-rating table for large
-- non-financial firms (pages.stern.nyu.edu/~adamodar, ratings.html, data as of
-- January 2026). A firm's rating is the row with the highest coverage_above at
-- or below its coverage; the spread is added to the 10-year yield to give the
-- pre-tax cost of debt. Refresh the rows when Damodaran publishes a new year.
create table if not exists warehouse.synthetic_rating (
  coverage_above double precision primary key,
  rating         text not null,
  spread         double precision not null,
  source         text not null
);

truncate warehouse.synthetic_rating;
insert into warehouse.synthetic_rating (coverage_above, rating, spread, source) values
  ('-infinity', 'D',    0.1900, 'Damodaran, large non-financial firms, Jan 2026'),
  (0.20,        'C',    0.1600, 'Damodaran, large non-financial firms, Jan 2026'),
  (0.65,        'CC',   0.1261, 'Damodaran, large non-financial firms, Jan 2026'),
  (0.80,        'CCC',  0.0885, 'Damodaran, large non-financial firms, Jan 2026'),
  (1.25,        'B-',   0.0509, 'Damodaran, large non-financial firms, Jan 2026'),
  (1.50,        'B',    0.0321, 'Damodaran, large non-financial firms, Jan 2026'),
  (1.75,        'B+',   0.0275, 'Damodaran, large non-financial firms, Jan 2026'),
  (2.00,        'BB',   0.0184, 'Damodaran, large non-financial firms, Jan 2026'),
  (2.25,        'BB+',  0.0138, 'Damodaran, large non-financial firms, Jan 2026'),
  (2.50,        'BBB',  0.0111, 'Damodaran, large non-financial firms, Jan 2026'),
  (3.00,        'A-',   0.0089, 'Damodaran, large non-financial firms, Jan 2026'),
  (4.25,        'A',    0.0078, 'Damodaran, large non-financial firms, Jan 2026'),
  (5.50,        'A+',   0.0070, 'Damodaran, large non-financial firms, Jan 2026'),
  (6.50,        'AA',   0.0055, 'Damodaran, large non-financial firms, Jan 2026'),
  (8.50,        'AAA',  0.0040, 'Damodaran, large non-financial firms, Jan 2026');

comment on table warehouse.synthetic_rating is
  'Interest coverage (EBIT / interest expense) to synthetic rating and default spread, Damodaran January 2026, large non-financial firms.';

-- Annual statements, one row per company per fiscal year, exactly as the
-- backtest built them (DWimplementation_v2.sql, temp_models): the same item
-- names, the same zero-fills, the same FCFF. available_from is the
-- point-in-time rule; g0_raw is the trailing revenue CAGR, computed per
-- statement. It is winsorised across the universe in warehouse.inputs, because
-- an outlier bound is a property of the cross-section, not of one statement.
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
  -- 2-year CAGR, else 1-year.
  coalesce(g.cagr_2y, g.cagr_1y)                      as g0_raw
from statements s
left join growth g using (ticker, period_end)
cross join warehouse.spec;

comment on view warehouse.fundamentals_annual is
  'Annual statements as the backtest built them (DWimplementation_v2.sql). available_from = period_end + 60 is the point-in-time rule.';

-- Return statistics, the CAPM beta and momentum per ticker, over trading-day
-- windows ending at the as-of date. Returns are on dividend-adjusted closes.
-- beta_se is the OLS standard error of the beta, which sets how far
-- warehouse.inputs shrinks it toward its sector prior.
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
    -- 12-1 momentum (Jegadeesh & Titman 1993): 252 to 21 sessions back.
    max(b.adj_close)  filter (where b.rn = 22)  as adj_close_1m,
    max(b.adj_close)  filter (where b.rn = 253) as adj_close_12m,
    avg(b.log_return)         filter (where b.rn <= 252) * 252       as realised_return,
    stddev_samp(b.log_return) filter (where b.rn <= 252) * sqrt(252) as volatility,
    count(b.log_return)       filter (where b.rn <= 252)::int        as observations
  from bars b
  group by b.ticker
),
capm as (
  -- OLS of daily excess returns on the market factor, with the slope's
  -- standard error: sqrt(residual variance / Sxx), residual variance =
  -- (Syy - Sxy^2 / Sxx) / (n - 2).
  select
    b.ticker,
    regr_slope(b.simple_return - f.rf, f.mkt_rf)                       as beta,
    sqrt(
      (regr_syy(b.simple_return - f.rf, f.mkt_rf)
        - regr_sxy(b.simple_return - f.rf, f.mkt_rf) ^ 2
          / nullif(regr_sxx(b.simple_return - f.rf, f.mkt_rf), 0))
      / nullif(regr_count(b.simple_return - f.rf, f.mkt_rf) - 2, 0)
      / nullif(regr_sxx(b.simple_return - f.rf, f.mkt_rf), 0)
    )                                                                  as beta_se,
    regr_count(b.simple_return - f.rf, f.mkt_rf)::int                  as n
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
  s.observations,
  s.adj_close_1m / nullif(s.adj_close_12m, 0) - 1                    as momentum,
  case when c.n >= (select min_beta_obs from warehouse.spec) then c.beta end    as beta_raw,
  case when c.n >= (select min_beta_obs from warehouse.spec) then c.beta_se end as beta_se,
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
    ps.observations,
    ps.momentum,
    ps.beta_raw,
    ps.beta_se,
    st.period_end,
    a.as_of - st.period_end                                  as staleness,
    st.ebit, st.tax, st.dna, st.capex, st.dnwc, st.cash, st.capital_lease_obligations,
    st.total_debt, st.net_debt, st.interest_expense, st.debt_cost, st.fcff,
    st.book_equity, st.net_income, st.dividends_paid, st.net_stock_issuance,
    st.revenue, st.operating_income, st.invested_capital, st.ebitda,
    st.g0_raw,
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
-- Winsorisation bounds for trailing growth: the 1st and 99th percentiles of
-- today's cross-section (spec.winsor_lower / winsor_upper).
growth_bounds as (
  select
    percentile_cont((select winsor_lower from warehouse.spec)) within group (order by g0_raw) as lo,
    percentile_cont((select winsor_upper from warehouse.spec)) within group (order by g0_raw) as hi
  from base
  where g0_raw is not null
),
-- Vasicek (1973) prior: the cross-sectional mean and variance of every raw
-- beta in the universe. Not the sector's: Levi & Welch (2017) find industry
-- betas explain 4% of a stock's future beta against ~50% for its own.
beta_prior as (
  select
    avg(beta_raw)      as prior_mean,
    var_samp(beta_raw) as prior_var
  from base
  where beta_raw is not null
),
shrunk as (
  select
    b.*,
    least(greatest(b.g0_raw, gb.lo), gb.hi)                  as g0,
    -- Levi & Welch (2017) eq. (1): the Vasicek beta (the precision-weighted
    -- average of the stock's OLS beta and the cross-sectional mean; a noisier
    -- estimate leans harder on the mean), shrunk a second time toward the
    -- size-tertile target, because true betas drift.
    case when bp.prior_var > 0 and b.beta_se is not null then
      (1 - sp.beta_second_shrink)
        * (bp.prior_var * b.beta_raw + b.beta_se ^ 2 * bp.prior_mean)
          / (bp.prior_var + b.beta_se ^ 2)
      + sp.beta_second_shrink * sp.beta_target
    end                                                      as beta
  from base b
  cross join growth_bounds gb
  cross join beta_prior bp
  cross join warehouse.spec sp
),
-- Interest coverage and the synthetic rating it maps to (Damodaran). Null when
-- either side is missing or there is no interest to cover: no reading, not a
-- guess. Negative EBIT is a real reading and lands in the lowest band.
rated as (
  select
    s.*,
    case when s.interest_expense > 0 then s.ebit / s.interest_expense end as interest_coverage
  from shrunk s
),
derived as (
  select
    b.*,
    sr.rating                                                as synthetic_rating,
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
    -- CAPM cost of equity on the shrunk beta, against the long-run market premium.
    b.rf + b.beta * b.prem_mkt                               as ke,
    -- Pre-tax cost of debt: the 10-year yield plus the synthetic rating's spread.
    b.rf + sr.spread                                         as kd,
    greatest(coalesce(b.total_debt - coalesce(b.capital_lease_obligations, 0), 0), 0) as debt_ex_leases
  from rated b
  left join lateral (
    select r.rating, r.spread
    from warehouse.synthetic_rating r
    where r.coverage_above <= b.interest_coverage
    order by r.coverage_above desc
    limit 1
  ) sr on true
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
  case
    -- Debt is a financial firm's raw material, not its capital, so there is no
    -- meaningful WACC and the firm-level models do not apply (Damodaran). RIM
    -- and shareholder yield, which need only the cost of equity, still do.
    when d.sector = 'Financial Services' then null
    -- No debt: the firm is all equity and kd never enters.
    when d.debt_ex_leases = 0 then d.ke
    else (1 - d.debt_ex_leases / nullif(d.debt_ex_leases + d.equity, 0)) * d.ke
      + d.debt_ex_leases / nullif(d.debt_ex_leases + d.equity, 0) * d.kd * (1 - d.tax)
  end                                                                as wacc
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

-- The rates the signal's implied returns are compared with: CAPM cost of
-- equity for RIM and shareholder yield, WACC for FCFF and revenue.
create view warehouse.discount_rates as
select
  ticker,
  rf,
  ke,
  wacc,
  kd,
  tax,
  1 - debt_weight as equity_weight,
  beta,
  beta_raw,
  interest_coverage,
  synthetic_rating
from warehouse.inputs;

comment on view warehouse.discount_rates is
  'Per-ticker required returns from warehouse.inputs, the same figures warehouse.signals measures implied returns against.';

-- One row per stock in the universe with a price, shaped for the screener and
-- the stock page. public.screener serves it.
create materialized view warehouse.stock_snapshot as
select
  i.ticker,
  coalesce(i.name, i.ticker)                                      as name,
  coalesce(i.sector, 'Unclassified')                              as sector,
  i.as_of,
  i.price,
  i.price * coalesce(t.shares, i.shares) / 1e9                    as market_cap_bn,
  i.beta                                                          as beta,
  i.realised_return,
  i.volatility,
  case when t.ttm_diluted_eps > 0 then i.price / t.ttm_diluted_eps end as pe_ratio,
  coalesce(d.trailing / nullif(i.price, 0), 0)                    as dividend_yield,
  jsonb_build_object(
    'risk_free', dr.rf,
    'cost_of_equity', dr.ke,
    'wacc', dr.wacc,
    'cost_of_debt', dr.kd,
    'equity_weight', dr.equity_weight,
    'tax_rate', dr.tax,
    'beta_raw', dr.beta_raw,
    'interest_coverage', dr.interest_coverage,
    'synthetic_rating', dr.synthetic_rating
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
where i.price is not null;

create unique index stock_snapshot_ticker_idx on warehouse.stock_snapshot (ticker);

create view public.screener
with (security_invoker = true) as
select
  ticker,
  name,
  sector,
  as_of,
  price,
  market_cap_bn,
  beta,
  realised_return,
  volatility,
  pe_ratio,
  dividend_yield,
  discount_rates,
  signals
from warehouse.stock_snapshot;

comment on view public.screener is
  'One row per stock in the universe: price, risk statistics, the required returns, and the signal with its four implied returns (backtests.md §16). Refreshed by warehouse.refresh().';

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
grant select on warehouse.discount_rates to service_role;
grant select on public.screener to anon, authenticated;

grant select on all tables in schema warehouse to service_role;
grant select on warehouse.stock_snapshot to anon, authenticated;
