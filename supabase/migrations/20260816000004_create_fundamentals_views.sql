-- Trailing-twelve-month rollup, one row per ticker.
--
-- This view is the single place the "sum flows, snapshot stocks" rule lives.
-- Flow columns are summed across the 4 most recent quarters; stock columns are
-- read from the single most recent quarter via `filter (where rn = 1)`. Doing
-- this in SQL keeps the rule from being re-derived (and mis-derived) in Python.
create or replace view public.ttm_fundamentals as
with ranked as (
  select
    *,
    row_number() over (partition by ticker order by period_end desc) as rn
  from public.quarterly_fundamentals
)
select
  ticker,
  max(period_end)  filter (where rn = 1) as latest_period_end,
  max(report_date) filter (where rn = 1) as latest_report_date,
  -- Load-bearing: quarters_used < 4 means every ttm_* sum below understates,
  -- and callers must lower confidence or refuse a verdict outright.
  count(*)                               as quarters_used,

  -- Flows: summed over the trailing 4 quarters.
  sum(total_revenue)                as ttm_revenue,
  sum(net_income)                   as ttm_net_income,
  sum(ebit)                         as ttm_ebit,
  sum(ebitda)                       as ttm_ebitda,
  sum(pretax_income)                as ttm_pretax_income,
  sum(tax_provision)                as ttm_tax_provision,
  sum(interest_expense)             as ttm_interest_expense,
  sum(diluted_eps)                  as ttm_diluted_eps,
  sum(operating_cash_flow)          as ttm_operating_cash_flow,
  sum(capital_expenditure)          as ttm_capital_expenditure,
  sum(free_cash_flow)               as ttm_free_cash_flow,
  sum(depreciation_amortisation)    as ttm_depreciation_amortisation,
  sum(change_in_working_capital)    as ttm_change_in_working_capital,
  sum(net_long_term_debt_issuance)  as ttm_net_borrowing,
  sum(cash_dividends_paid)          as ttm_dividends_paid,
  sum(stock_based_compensation)     as ttm_stock_based_compensation,
  avg(tax_rate)                     as avg_tax_rate,

  -- Stocks: latest quarter only.
  max(total_debt)             filter (where rn = 1) as total_debt,
  max(net_debt)               filter (where rn = 1) as net_debt,
  max(cash_and_equivalents)   filter (where rn = 1) as cash_and_equivalents,
  max(stockholders_equity)    filter (where rn = 1) as stockholders_equity,
  max(tangible_book_value)    filter (where rn = 1) as tangible_book_value,
  max(total_assets)           filter (where rn = 1) as total_assets,
  max(current_liabilities)    filter (where rn = 1) as current_liabilities,
  max(invested_capital)       filter (where rn = 1) as invested_capital,
  max(ordinary_shares_number) filter (where rn = 1) as shares_outstanding,
  max(diluted_avg_shares)     filter (where rn = 1) as diluted_avg_shares
from ranked
where rn <= 4
group by ticker;

comment on view public.ttm_fundamentals is
  'Trailing-twelve-month rollup, one row per ticker. Flow columns are summed over the 4 most recent quarters; stock columns are taken from the single most recent quarter. quarters_used reports how many quarters actually contributed — anything below 4 means the ttm_* sums understate and the caller must lower confidence or refuse to emit a verdict.';

-- Most recent stored close per ticker: the as-of price valuations compare
-- fair values against. `distinct on` avoids a correlated subquery over the
-- ~250k-row price table.
create or replace view public.latest_close_prices as
select distinct on (ticker)
  ticker,
  date,
  close
from public.daily_close_prices
order by ticker, date desc;

comment on view public.latest_close_prices is
  'Most recent stored close per ticker. The as-of price the valuation engine compares fair values against.';
