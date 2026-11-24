-- Split-adjust the per-share figures in warehouse.fundamentals_ttm.
--
-- Statement EPS and share counts are as reported at each quarter's end. Prices
-- are split-adjusted, so a split after the statement date left P/E and market
-- cap out by the split ratio: SNDK's 8:1 split of 2026-11-20 showed a P/E of
-- 0.8 and a $13.6B market cap. The fix is the CRSP cumulative adjustment factor
-- (cfacpr / cfacshr): each quarter's EPS is divided, and its share count
-- multiplied, by the product of the ratios of every split after its period end.
-- Display only: the value signal reads warehouse.shares_adjusted, which already
-- applies the same rule to daily share counts.

create or replace view warehouse.fundamentals_ttm as
 WITH ranked AS (
         SELECT fundamentals_quarterly.ticker,
            fundamentals_quarterly.period_end,
            fundamentals_quarterly.revenue,
            fundamentals_quarterly.net_income,
            fundamentals_quarterly.ebit,
            fundamentals_quarterly.ebitda,
            fundamentals_quarterly.tax_rate,
            fundamentals_quarterly.interest_expense,
            fundamentals_quarterly.diluted_eps / adj.factor AS diluted_eps,
            fundamentals_quarterly.operating_cash_flow,
            fundamentals_quarterly.capital_expenditure,
            fundamentals_quarterly.depreciation_amortisation,
            fundamentals_quarterly.change_in_working_capital,
            fundamentals_quarterly.net_borrowing,
            fundamentals_quarterly.dividends_paid,
            fundamentals_quarterly.total_debt,
            fundamentals_quarterly.capital_lease_obligations,
            fundamentals_quarterly.cash,
            fundamentals_quarterly.stockholders_equity,
            fundamentals_quarterly.shares * adj.factor AS shares,
            row_number() OVER (PARTITION BY fundamentals_quarterly.ticker ORDER BY fundamentals_quarterly.period_end DESC) AS rn,
            max(fundamentals_quarterly.period_end) OVER (PARTITION BY fundamentals_quarterly.ticker) AS newest
           FROM warehouse.fundamentals_quarterly
             CROSS JOIN LATERAL ( SELECT COALESCE(exp(sum(ln(sp.ratio))), 1::double precision) AS factor
                   FROM raw.splits sp
                  WHERE sp.ticker = fundamentals_quarterly.ticker AND sp.date > fundamentals_quarterly.period_end) adj
          WHERE COALESCE(fundamentals_quarterly.revenue, fundamentals_quarterly.net_income, fundamentals_quarterly.operating_cash_flow, fundamentals_quarterly.ebit) IS NOT NULL
        ), last4 AS (
         SELECT ranked.ticker,
            ranked.period_end,
            ranked.revenue,
            ranked.net_income,
            ranked.ebit,
            ranked.ebitda,
            ranked.tax_rate,
            ranked.interest_expense,
            ranked.diluted_eps,
            ranked.operating_cash_flow,
            ranked.capital_expenditure,
            ranked.depreciation_amortisation,
            ranked.change_in_working_capital,
            ranked.net_borrowing,
            ranked.dividends_paid,
            ranked.total_debt,
            ranked.capital_lease_obligations,
            ranked.cash,
            ranked.stockholders_equity,
            ranked.shares,
            ranked.rn,
            ranked.newest
           FROM ranked
          WHERE ranked.rn <= 4 AND ranked.period_end > (ranked.newest - 370)
        )
 SELECT ticker,
    max(period_end) AS latest_period_end,
    count(*)::integer AS quarters_used,
    sum(revenue) AS ttm_revenue,
    sum(net_income) AS ttm_net_income,
    sum(ebit) AS ttm_ebit,
    sum(ebitda) AS ttm_ebitda,
    sum(interest_expense) AS ttm_interest_expense,
    sum(diluted_eps) AS ttm_diluted_eps,
    sum(operating_cash_flow) AS ttm_operating_cash_flow,
    sum(capital_expenditure) AS ttm_capital_expenditure,
    sum(depreciation_amortisation) AS ttm_depreciation_amortisation,
    sum(change_in_working_capital) AS ttm_change_in_working_capital,
    sum(net_borrowing) AS ttm_net_borrowing,
    sum(dividends_paid) AS ttm_dividends_paid,
    avg(tax_rate) AS avg_tax_rate,
    max(total_debt) FILTER (WHERE rn = 1) AS total_debt,
    max(total_debt) FILTER (WHERE rn = 1) - COALESCE(max(capital_lease_obligations) FILTER (WHERE rn = 1), 0::double precision) - max(cash) FILTER (WHERE rn = 1) AS net_debt,
    max(stockholders_equity) FILTER (WHERE rn = 1) AS stockholders_equity,
    max(shares) FILTER (WHERE rn = 1) AS shares,
    count(net_income)::integer AS net_income_quarters
   FROM last4
  GROUP BY ticker;

-- P/E and market cap in the snapshot: see the notes inline.
drop view public.screener;
drop materialized view warehouse.stock_snapshot;

create materialized view warehouse.stock_snapshot as
select
  i.ticker,
  coalesce(i.name, i.ticker)                                      as name,
  coalesce(i.sector, 'Unclassified')                              as sector,
  i.as_of,
  i.price,
  -- Price × split-adjusted daily shares, the market value the models discount
  -- against. Statement share counts are not split-adjusted and, for BRK-B,
  -- not even in the same share class.
  i.equity / 1e9                                                  as market_cap_bn,
  i.beta                                                          as beta,
  i.realised_return,
  i.volatility,
  -- Market value of equity over trailing-twelve-month net income (Damodaran's
  -- definition of the equity multiple), which is immune to splits. Withheld
  -- unless all four quarters report net income: a sum over three understates
  -- earnings by a quarter. Summed quarterly EPS had both faults (AAPL 50.8).
  case when t.quarters_used = 4 and t.net_income_quarters = 4 and t.ttm_net_income > 0
    then i.equity / t.ttm_net_income end                          as pe_ratio,
  coalesce(d.trailing / nullif(i.price, 0), 0)                    as dividend_yield,
  -- Classic ratios, as context beside the signal (not part of it). Each is
  -- withheld where its denominator makes it meaningless rather than signed.
  case when i.ev > 0 then i.fcff / i.ev end                       as fcf_yield,
  case when i.ev > 0 and i.ebitda > 0 then i.ev / i.ebitda end    as ev_ebitda,
  case when i.book_equity > 0 then i.equity / i.book_equity end   as pb_ratio,
  case when i.equity > 0 then i.shareholder_payout / i.equity end as shareholder_yield,
  i.roe,
  -- Trailing revenue CAGR as reported, before the model's winsorisation.
  i.g0_raw                                                        as revenue_growth,
  i.revenue / 1e9                                                 as revenue_bn,
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
    'required_return_firm', s.wacc,
    'implied_growth', warehouse.implied_growth_cashflow(
      i.fcff, i.g_l, i.ev, sp.horizon_years, i.wacc, sp.r_max),
    -- True when the inputs are solvable but even g_max does not reach EV: the
    -- price needs more growth than the bracket allows. A reading, not a gap.
    'implied_growth_above_max', case when i.fcff > 0 and i.ev > 0 and i.wacc > i.g_l
      then warehouse.pv(i.wacc, warehouse.grow(i.fcff, sp.r_max, i.g_l, sp.horizon_years), i.g_l) < i.ev
    end
  )                                                               as signals
from warehouse.inputs i
left join warehouse.fundamentals_ttm t using (ticker)
left join warehouse.dividend_stats d using (ticker)
left join warehouse.discount_rates dr using (ticker)
left join warehouse.signals s using (ticker)
cross join warehouse.spec sp
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
  fcf_yield,
  ev_ebitda,
  pb_ratio,
  shareholder_yield,
  roe,
  revenue_growth,
  revenue_bn,
  discount_rates,
  signals
from warehouse.stock_snapshot;

comment on view public.screener is
  'One row per stock in the universe: price, risk statistics, the required returns, and the signal with its four implied returns (backtests.md §16). Refreshed by warehouse.refresh().';

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
grant select on warehouse.discount_rates to service_role;
grant select on public.screener to anon, authenticated;

grant select on warehouse.stock_snapshot to anon, authenticated, service_role;
