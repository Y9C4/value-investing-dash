"""Quarterly fundamentals, company profile and dividends, from yfinance.

Two hazards drive the design:

- **Row names vary by ticker.** `Interest Expense` is missing for companies
  with no debt, `Free Cash Flow` for banks. `_row` returns None rather than
  defaulting to zero: a missing line item is not zero, and treating it as
  zero produces a plausible-looking wrong valuation.
- **Signs are as-reported.** `Capital Expenditure` and `Cash Dividends Paid`
  arrive negative and are stored that way, so free cash flow is
  `operating_cash_flow + capital_expenditure`.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd
import yfinance as yf

# Quarters kept per ticker. TTM needs 4; a couple more make growth rates and
# stability measures possible without storing a decade of history.
QUARTERS_RETAINED = 8


def _row(df: pd.DataFrame | None, *names: str) -> pd.Series | None:
    """First matching row from a yfinance statement frame, tried in order.

    Returns None when no candidate name is present. Callers must treat that as
    missing data — never as zero.
    """
    if df is None or df.empty:
        return None
    for name in names:
        if name in df.index:
            return df.loc[name]
    return None


def _at(series: pd.Series | None, column: Any) -> float | None:
    """One period's value from a statement row, as a float or None."""
    if series is None or column not in series.index:
        return None
    value = series[column]
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) or math.isinf(result) else result


def _clean(value: Any) -> float | None:
    """A scalar from `.info` as a float, or None if absent/not finite."""
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(result) or math.isinf(result) else result


def _report_dates(ticker: yf.Ticker) -> list[pd.Timestamp]:
    """Known earnings report dates, ascending.

    Used for point-in-time correctness: a quarter ending 2026-03-31 is not
    knowable until it is reported in late April. Coverage is patchy and a
    failure here must not cost us the fundamentals, so everything is guarded.
    """
    try:
        earnings = ticker.earnings_dates
    except Exception:  # noqa: BLE001 - optional enrichment
        return []

    if earnings is None or earnings.empty:
        return []

    return sorted(pd.Timestamp(d).tz_localize(None) for d in earnings.index)


def _match_report_date(period_end: pd.Timestamp, sorted_dates: list) -> str | None:
    """The first earnings date at or after `period_end` — the moment the
    quarter became public."""
    for reported in sorted_dates:
        if reported >= period_end:
            # A report more than a quarter after period end is a mismatch.
            if (reported - period_end).days <= 120:
                return reported.date().isoformat()
            break
    return None


def extract_quarterly_rows(
    symbol: str,
    income: pd.DataFrame,
    balance: pd.DataFrame,
    cashflow: pd.DataFrame,
    sorted_report_dates: list,
) -> list[dict]:
    """Build `quarterly_fundamentals` rows from the three statement frames."""
    # Income statement
    total_revenue = _row(income, "Total Revenue", "Operating Revenue")
    net_income = _row(
        income,
        "Net Income",
        "Net Income Common Stockholders",
        "Net Income From Continuing Operation Net Minority Interest",
        "Net Income From Continuing Operations",
    )
    ebit = _row(income, "EBIT", "Operating Income")
    ebitda = _row(income, "EBITDA", "Normalized EBITDA")
    pretax_income = _row(income, "Pretax Income")
    tax_provision = _row(income, "Tax Provision")
    tax_rate = _row(income, "Tax Rate For Calcs")
    interest_expense = _row(
        income, "Interest Expense", "Interest Expense Non Operating"
    )
    diluted_eps = _row(income, "Diluted EPS", "Basic EPS")
    diluted_shares = _row(income, "Diluted Average Shares", "Basic Average Shares")

    # Balance sheet
    total_debt = _row(balance, "Total Debt")
    net_debt = _row(balance, "Net Debt")
    cash = _row(
        balance,
        "Cash And Cash Equivalents",
        "Cash Cash Equivalents And Short Term Investments",
    )
    equity = _row(
        balance, "Stockholders Equity", "Common Stock Equity",
        "Total Equity Gross Minority Interest",
    )
    tangible_book = _row(balance, "Tangible Book Value", "Net Tangible Assets")
    total_assets = _row(balance, "Total Assets")
    current_liabilities = _row(balance, "Current Liabilities")
    invested_capital = _row(balance, "Invested Capital")
    shares_number = _row(balance, "Ordinary Shares Number", "Share Issued")

    # Cash flow
    operating_cf = _row(
        cashflow, "Operating Cash Flow", "Cash Flow From Continuing Operating Activities"
    )
    capex = _row(cashflow, "Capital Expenditure", "Purchase Of PPE")
    free_cf = _row(cashflow, "Free Cash Flow")
    depreciation = _row(
        cashflow, "Depreciation And Amortization",
        "Depreciation Amortization Depletion",
    )
    working_capital = _row(cashflow, "Change In Working Capital")
    net_borrowing = _row(
        cashflow, "Net Long Term Debt Issuance", "Net Issuance Payments Of Debt"
    )
    dividends_paid = _row(
        cashflow, "Cash Dividends Paid", "Common Stock Dividend Paid"
    )
    sbc = _row(cashflow, "Stock Based Compensation")

    # Union of period-ends across the three statements, newest first.
    periods: set[Any] = set()
    for frame in (income, balance, cashflow):
        if frame is not None and not frame.empty:
            periods.update(frame.columns)

    rows: list[dict] = []
    for period in sorted(periods, reverse=True)[:QUARTERS_RETAINED]:
        period_end = pd.Timestamp(period).tz_localize(None)

        ocf = _at(operating_cf, period)
        cap = _at(capex, period)
        fcf = _at(free_cf, period)
        # Banks and REITs report no capex, so FCF stays None for them rather
        # than being fabricated. Capex is negative, hence the addition.
        if fcf is None and ocf is not None and cap is not None:
            fcf = ocf + cap

        row = {
            "ticker": symbol,
            "period_end": period_end.date().isoformat(),
            "report_date": _match_report_date(period_end, sorted_report_dates),
            "total_revenue": _at(total_revenue, period),
            "net_income": _at(net_income, period),
            "ebit": _at(ebit, period),
            "ebitda": _at(ebitda, period),
            "pretax_income": _at(pretax_income, period),
            "tax_provision": _at(tax_provision, period),
            "tax_rate": _at(tax_rate, period),
            "interest_expense": _at(interest_expense, period),
            "diluted_eps": _at(diluted_eps, period),
            "diluted_avg_shares": _at(diluted_shares, period),
            "operating_cash_flow": ocf,
            "capital_expenditure": cap,
            "free_cash_flow": fcf,
            "depreciation_amortisation": _at(depreciation, period),
            "change_in_working_capital": _at(working_capital, period),
            "net_long_term_debt_issuance": _at(net_borrowing, period),
            "cash_dividends_paid": _at(dividends_paid, period),
            "stock_based_compensation": _at(sbc, period),
            "total_debt": _at(total_debt, period),
            "net_debt": _at(net_debt, period),
            "cash_and_equivalents": _at(cash, period),
            "stockholders_equity": _at(equity, period),
            "tangible_book_value": _at(tangible_book, period),
            "total_assets": _at(total_assets, period),
            "current_liabilities": _at(current_liabilities, period),
            "invested_capital": _at(invested_capital, period),
            "ordinary_shares_number": _at(shares_number, period),
        }

        # A period where every statement was blank carries no information.
        if any(
            value is not None
            for key, value in row.items()
            if key not in ("ticker", "period_end", "report_date")
        ):
            rows.append(row)

    return rows


def extract_profile_row(symbol: str, info: dict) -> dict:
    """Build the `company_profile` row from a yfinance `.info` dict."""
    return {
        "ticker": symbol,
        "name": info.get("longName") or info.get("shortName"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "shares_outstanding": _clean(info.get("sharesOutstanding")),
        "market_cap": _clean(info.get("marketCap")),
        "beta_yf": _clean(info.get("beta")),
        "trailing_eps": _clean(info.get("trailingEps")),
        "forward_eps": _clean(info.get("forwardEps")),
        "book_value_ps": _clean(info.get("bookValue")),
        "dividend_rate": _clean(info.get("dividendRate")),
        "dividend_yield": _clean(info.get("dividendYield")),
        "payout_ratio": _clean(info.get("payoutRatio")),
        "return_on_equity": _clean(info.get("returnOnEquity")),
        "earnings_growth": _clean(info.get("earningsGrowth")),
        "revenue_growth": _clean(info.get("revenueGrowth")),
        "currency": info.get("currency"),
    }


def extract_dividend_rows(symbol: str, dividends: pd.Series | None) -> list[dict]:
    """Build `dividend_history` rows. An empty series is meaningful — it marks
    a non-payer, which must yield no DDM verdict rather than a zero."""
    if dividends is None or len(dividends) == 0:
        return []

    rows: list[dict] = []
    for ex_date, amount in dividends.items():
        value = _clean(amount)
        if value is None or value <= 0:
            continue
        rows.append(
            {
                "ticker": symbol,
                "ex_date": pd.Timestamp(ex_date).tz_localize(None).date().isoformat(),
                "amount": value,
            }
        )
    return rows


def fetch_ticker_fundamentals(symbol: str) -> dict:
    """Everything for one ticker in a single pass.

    `.info`, the three statements and `.dividends` all come from one
    `yf.Ticker`, so fetching them together costs one round of network work
    instead of three. Never raises: a failure is reported in the `error` key so
    one bad ticker cannot abort a 500-ticker run.
    """
    try:
        ticker = yf.Ticker(symbol)

        income = ticker.quarterly_income_stmt
        balance = ticker.quarterly_balance_sheet
        cashflow = ticker.quarterly_cashflow
        info = ticker.info or {}
        dividends = ticker.dividends

        report_dates = _report_dates(ticker)

        return {
            "ticker": symbol,
            "quarters": extract_quarterly_rows(
                symbol, income, balance, cashflow, report_dates
            ),
            "profile": extract_profile_row(symbol, info),
            "dividends": extract_dividend_rows(symbol, dividends),
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - reported, never raised
        return {
            "ticker": symbol,
            "quarters": [],
            "profile": None,
            "dividends": [],
            "error": f"{type(exc).__name__}: {exc}",
        }
