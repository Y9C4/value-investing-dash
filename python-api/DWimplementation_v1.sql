/*data for Candidate models:
Reverse FCFF
query for FCFF_t */
drop table backtest.temp_models;

create table
    backtest.temp_models as
select
    items.ticker,
    items.period_end,
    items.frequency,
    items.EBIT,
    items.Tax,
    items.DnA,
    items.CapEX,
    items.Cash,
    (
        items.TotalDebt - coalesce(items.CapitalLeaseObligations, 0)
    ) - items.Cash as NetDebt,
    items.TotalDebt,
    items.InterestExpense,
    (
        items.InterestExpense / nullif(
            items.TotalDebt - coalesce(items.CapitalLeaseObligations, 0),
            0
        )
    ) as DebtCost,
    items.dNWC,
    items.CapitalLeaseObligations,
    (
        items.EBIT * (1 - items.Tax) + items.DnA + items.CapEX + items.dNWC
    ) as FCFF,
    -- Other candidate models: RIM, reverse revenue, shareholder yield, COMPS
    items.BookEquity,
    items.NetIncome,
    items.DividendsPaid,
    items.NetStockIssuance,
    items.Revenue,
    items.OperatingIncome,
    items.InvestedCapital,
    items.EBITDA
from
    (
        select
            st.ticker,
            st.period_end,
            st.frequency,
            MAX(
                CASE
                    WHEN st.item = 'EBIT' THEN st.value
                END
            ) AS EBIT,
            MAX(
                CASE
                    WHEN st.item = 'Tax Rate For Calcs' THEN st.value
                END
            ) AS Tax,
            MAX(
                CASE
                    WHEN st.item = 'Depreciation And Amortization' THEN st.value
                END
            ) AS DnA,
            MAX(
                CASE
                    WHEN st.item = 'Capital Expenditure' THEN st.value
                END
            ) AS CapEX,
            MAX(
                CASE
                    WHEN st.item = 'Change In Working Capital' THEN st.value
                END
            ) AS dNWC,
            coalesce(
                max(st.value) filter (
                    where
                        item = 'Cash Cash Equivalents And Short Term Investments'
                ),
                max(st.value) filter (
                    where
                        item = 'Cash And Cash Equivalents'
                )
            ) as Cash,
            MAX(
                CASE
                    WHEN st.item = 'Capital Lease Obligations' THEN st.value
                END
            ) AS CapitalLeaseObligations,
            coalesce(
                max(st.value) filter (
                    where
                        st.item = 'Total Debt'
                ),
                case
                    when max(st.value) filter (
                        where
                            st.item = 'Total Assets'
                    ) is not null then 0
                end
            ) as TotalDebt,
            MAX(
                CASE
                    WHEN st.item = 'Interest Expense' THEN st.value
                END
            ) AS InterestExpense,
            MAX(
                CASE
                    WHEN st.item = 'Common Stock Equity' THEN st.value
                END
            ) AS BookEquity,
            MAX(
                CASE
                    WHEN st.item = 'Net Income Common Stockholders' THEN st.value
                END
            ) AS NetIncome,
            -- stored negative (cash out); missing = no dividend, when the
            -- cash flow statement exists
            coalesce(
                max(st.value) filter (
                    where
                        st.item = 'Cash Dividends Paid'
                ),
                case
                    when max(st.value) filter (
                        where
                            st.item = 'Operating Cash Flow'
                    ) is not null then 0
                end
            ) as DividendsPaid,
            -- negative = net buybacks; missing = none, when the cash flow
            -- statement exists
            coalesce(
                max(st.value) filter (
                    where
                        st.item = 'Net Common Stock Issuance'
                ),
                case
                    when max(st.value) filter (
                        where
                            st.item = 'Operating Cash Flow'
                    ) is not null then 0
                end
            ) as NetStockIssuance,
            MAX(
                CASE
                    WHEN st.item = 'Total Revenue' THEN st.value
                END
            ) AS Revenue,
            MAX(
                CASE
                    WHEN st.item = 'Operating Income' THEN st.value
                END
            ) AS OperatingIncome,
            MAX(
                CASE
                    WHEN st.item = 'Invested Capital' THEN st.value
                END
            ) AS InvestedCapital,
            MAX(
                CASE
                    WHEN st.item = 'EBITDA' THEN st.value
                END
            ) AS EBITDA
        from
            backtest.statement_items st
        where
            st.frequency = 'annual'
        group by
            st.ticker,
            st.period_end,
            st.frequency
    ) items
where
    items.EBIT is not null
    or items.TotalDebt is not null;

-- Add Equity Value + Conservative estimate of Available From 
-- date (day after earnings)
drop table if exists backtest.temp_models2;

create table
    backtest.temp_models2 as (
        select
            m.ticker,
            u.sector,
            m.period_end,
            m.frequency,
            m.EBIT,
            m.Tax,
            m.DnA,
            m.CapEX,
            m.Cash,
            m.NetDebt,
            m.TotalDebt,
            m.InterestExpense,
            m.DebtCost,
            m.dNWC,
            m.CapitalLeaseObligations,
            m.FCFF,
            m.BookEquity,
            m.NetIncome,
            m.DividendsPaid,
            m.NetStockIssuance,
            m.Revenue,
            m.OperatingIncome,
            m.InvestedCapital,
            m.EBITDA,
            p.close,
            s.shares,
            (p.close * s.shares) as Equity,
            rf.RiskFree,
            p.date as X,
            p.date - m.period_end as
        offset
        from
            backtest.temp_models m
            join lateral ( -- first trading day on or after the 60-day 10-K deadline
                select
                    dp.ticker,
                    dp.close,
                    dp.date
                from
                    backtest.daily_prices dp
                where
                    dp.ticker = m.ticker
                    and dp.date >= m.period_end + 60
                    and dp.date <= m.period_end + 67
                order by
                    dp.ticker,
                    dp.date asc
                limit
                    1
            ) p on true
            join lateral (
                select
                    percentile_cont(0.5) within group (
                        order by
                            sa.shares
                    ) as shares
                from
                    backtest.shares_adjusted sa
                where
                    sa.ticker = p.ticker
                    and sa.date <= p.date
                    and sa.date > p.date - 90
            ) s on true
            join lateral ( -- spot 10-year Treasury yield on or before the price date
                select
                    tnx.close / 100 as RiskFree
                from
                    backtest.daily_prices tnx
                where
                    tnx.ticker = '^TNX'
                    and tnx.date <= p.date
                order by
                    tnx.date desc
                limit
                    1
            ) rf on true
            left join backtest.universe u on u.ticker = m.ticker
    );

-- Naming for the columns added below:
--   Prem_*  factor premium known at X (annualised, expanding average)
--   Fwd_*   outcome over the forward window (X, Fwd_Date]
--   *_Mkt   is always market minus risk-free
alter table backtest.temp_models2
add column Prem_Mkt double precision,
add column Fwd_Return double precision;

UPDATE backtest.temp_models2 m
SET
    Prem_Mkt = (
        SELECT
            avg(fr.mkt_rf) * 252
        FROM
            backtest.factor_returns fr
        WHERE
            fr.date < m.X
    );

select
    m.ticker,
    m.X,
    op.adj_close as curr_adj_close,
    m.X + 90 as frwd_date,
    p.adj_close as fwrd_adj_close,
    (p.adj_close / op.adj_close - 1) as Actual_Return
from
    backtest.temp_models2 m
    join lateral (
        select
            dp.adj_close
        from
            backtest.daily_prices dp
        where
            m.ticker = dp.ticker
            and dp.date <= (m.X + 90) + 7
            and dp.date > m.X + 90
        order by
            dp.date asc
        limit
            1
    ) p on true,
    backtest.daily_prices op
where
    m.X = op.date
    and m.ticker = op.ticker;

-- Realised 3-month return, X -> first trading day after X + 90.
-- Fwd_Date is kept so the factor window below covers exactly the same days.
alter table backtest.temp_models2
add column Fwd_Date date;

with
    fwd as (
        select
            m.ticker,
            m.period_end,
            p.date as fwd_date,
            p.adj_close / op.adj_close - 1 as fwd_return
        from
            backtest.temp_models2 m
            join backtest.daily_prices op on op.ticker = m.ticker
            and op.date = m.X
            join lateral (
                select
                    dp.date,
                    dp.adj_close
                from
                    backtest.daily_prices dp
                where
                    dp.ticker = m.ticker
                    and dp.date > m.X + 90
                    and dp.date <= m.X + 97
                order by
                    dp.date asc
                limit
                    1
            ) p on true
    )
update backtest.temp_models2 m
set
    Fwd_Date = f.fwd_date,
    Fwd_Return = f.fwd_return
from
    fwd f
where
    f.ticker = m.ticker
    and f.period_end = m.period_end;

-- Factor returns compounded over the same window (X, Fwd_Date], for the
-- factor-adjusted target: Fwd_Return - (Fwd_Rf + betas x these). Null when the
-- window runs past the last Fama-French date, rather than a partial window.
alter table backtest.temp_models2
add column Fwd_Rf double precision,
add column Fwd_Mkt double precision,
add column Fwd_Smb double precision,
add column Fwd_Hml double precision,
add column Fwd_Rmw double precision,
add column Fwd_Cma double precision;

with
    win as (
        select
            m.ticker,
            m.period_end,
            exp(sum(ln(1 + fr.rf))) - 1 as rf,
            -- market total return over the window, minus the window's rf
            exp(sum(ln(1 + fr.mkt_rf + fr.rf))) - exp(sum(ln(1 + fr.rf))) as mkt,
            exp(sum(ln(1 + fr.smb))) - 1 as smb,
            exp(sum(ln(1 + fr.hml))) - 1 as hml,
            exp(sum(ln(1 + fr.rmw))) - 1 as rmw,
            exp(sum(ln(1 + fr.cma))) - 1 as cma
        from
            backtest.temp_models2 m
            join backtest.factor_returns fr on fr.date > m.X
            and fr.date <= m.Fwd_Date
        where
            m.Fwd_Date <= (
                select
                    max(date)
                from
                    backtest.factor_returns
            )
        group by
            m.ticker,
            m.period_end
    )
update backtest.temp_models2 m
set
    Fwd_Rf = w.rf,
    Fwd_Mkt = w.mkt,
    Fwd_Smb = w.smb,
    Fwd_Hml = w.hml,
    Fwd_Rmw = w.rmw,
    Fwd_Cma = w.cma
from
    win w
where
    w.ticker = m.ticker
    and w.period_end = m.period_end;

-- FF5 factor premia known at X: expanding arithmetic average since 1963,
-- annualised, same as Prem_Mkt above. FF5 Ke = RiskFree + b*Prem_Mkt
-- + s*Prem_Smb + h*Prem_Hml + r*Prem_Rmw + c*Prem_Cma, with the betas from
-- the Python regression.
alter table backtest.temp_models2
add column Prem_Smb double precision,
add column Prem_Hml double precision,
add column Prem_Rmw double precision,
add column Prem_Cma double precision;

UPDATE backtest.temp_models2 m
SET
    (Prem_Smb, Prem_Hml, Prem_Rmw, Prem_Cma) = (
        SELECT
            avg(fr.smb) * 252,
            avg(fr.hml) * 252,
            avg(fr.rmw) * 252,
            avg(fr.cma) * 252
        FROM
            backtest.factor_returns fr
        WHERE
            fr.date < m.X
    );


select
    count(distinct ticker)
from
    backtest.temp_models2
where
    fcff is not null;

select
    st.ticker
from
    backtest.statement_items st
    left join backtest.temp_models2 m on st.ticker = m.ticker
where
    m.ticker is NULL
group by
    st.ticker;

select
    *
from
    backtest.temp_models2;
