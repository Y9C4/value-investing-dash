create table if not exists public.quarterly_fundamentals (
  ticker      text not null,
  period_end  date not null,
  -- When the quarter was actually reported. A quarter ending 2026-03-31 is not
  -- knowable until late April, so any point-in-time analysis must filter on
  -- this rather than period_end. Nullable: yfinance earnings_dates coverage is
  -- patchy, and a missing report date is not a reason to drop the quarter.
  report_date date,

  -- Flow items: sum over 4 trailing quarters for TTM. Never take a single
  -- quarter's value as an annual figure.
  total_revenue                numeric(20, 2),
  net_income                   numeric(20, 2),
  ebit                         numeric(20, 2),
  ebitda                       numeric(20, 2),
  pretax_income                numeric(20, 2),
  tax_provision                numeric(20, 2),
  tax_rate                     numeric(10, 6),
  interest_expense             numeric(20, 2),
  diluted_eps                  numeric(14, 4),
  diluted_avg_shares           numeric(20, 0),
  operating_cash_flow          numeric(20, 2),
  -- Stored as reported by yfinance, i.e. NEGATIVE. Free cash flow is therefore
  -- operating_cash_flow + capital_expenditure, not minus.
  capital_expenditure          numeric(20, 2),
  free_cash_flow               numeric(20, 2),
  depreciation_amortisation    numeric(20, 2),
  change_in_working_capital    numeric(20, 2),
  net_long_term_debt_issuance  numeric(20, 2),
  -- Also negative as reported.
  cash_dividends_paid          numeric(20, 2),
  stock_based_compensation     numeric(20, 2),

  -- Stock items: take the latest period_end only. Summing these across
  -- quarters would quadruple the balance sheet.
  total_debt                   numeric(20, 2),
  net_debt                     numeric(20, 2),
  cash_and_equivalents         numeric(20, 2),
  stockholders_equity          numeric(20, 2),
  tangible_book_value          numeric(20, 2),
  total_assets                 numeric(20, 2),
  current_liabilities          numeric(20, 2),
  invested_capital             numeric(20, 2),
  ordinary_shares_number       numeric(20, 0),

  created_at  timestamptz not null default now(),
  primary key (ticker, period_end)
);

create index if not exists quarterly_fundamentals_period_end_idx
  on public.quarterly_fundamentals (period_end desc);

comment on table public.quarterly_fundamentals is
  'One row per ticker per fiscal quarter, stored at QUARTERLY grain — deliberately never forward-filled into daily rows, which would multiply ~4k rows into ~750k and slow every 500-stock valuation run for no gain, since no model consumes a daily fundamental series. Flow columns must be summed over 4 trailing quarters for TTM; stock columns must be taken from the latest period_end only. See the ttm_fundamentals view, which encodes that split in one place.';

comment on column public.quarterly_fundamentals.capital_expenditure is
  'Negative as reported by yfinance. FCF = operating_cash_flow + capital_expenditure.';

comment on column public.quarterly_fundamentals.report_date is
  'Actual earnings report date, for point-in-time correctness. Nullable.';
