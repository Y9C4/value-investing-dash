import json
import os
import time
from pathlib import Path
from typing import Literal

import cvxpy as cp
import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client
from pypfopt import expected_returns
from pypfopt import risk_models
from pypfopt import EfficientFrontier

load_dotenv()

app = FastAPI(title="value-investing-dash market data service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

SP500_TICKERS_PATH = Path(__file__).parent / "data" / "sp500_tickers.json"
SP500_INDEX_TICKER = "^GSPC"
RISK_FREE_TICKER = "^IRX"
FETCH_CHUNK_SIZE = 50
UPSERT_CHUNK_SIZE = 500
SELECT_PAGE_SIZE = 1000

# Frontier constraints: no single name may exceed 3% of the portfolio, and
# historical mean returns are capped to keep extreme estimates from dominating.
MAX_STOCK_WEIGHT = 0.03
MU_CLIP = 0.50
ENVELOPE_POINTS = 100
MIN_ENVELOPE_POINTS = 2
MAX_ENVELOPE_POINTS = 500
# How far past the frontier the capital market line runs (levered portfolios).
CML_LEVERAGE_EXTENSION = 1.4

with open(SP500_TICKERS_PATH, encoding="utf-8") as f:
    SP500_TICKERS: list[str] = json.load(f)

_supabase_url = os.environ.get("SUPABASE_URL")
_supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
_supabase_client: Client | None = None
if _supabase_url and _supabase_key:
    _supabase_client = create_client(_supabase_url, _supabase_key)


def get_supabase() -> Client:
    if _supabase_client is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY in api/.env."
            ),
        )
    return _supabase_client


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quote/{ticker}")
def get_quote(ticker: str):
    try:
        info = yf.Ticker(ticker).fast_info
        price = info.get("lastPrice")
    except (KeyError, IndexError):
        price = None

    if price is None:
        raise HTTPException(status_code=404, detail=f"No quote data for '{ticker}'")

    return {
        "ticker": ticker.upper(),
        "price": info.get("lastPrice"),
        "previousClose": info.get("previousClose"),
        "open": info.get("open"),
        "dayHigh": info.get("dayHigh"),
        "dayLow": info.get("dayLow"),
        "yearHigh": info.get("yearHigh"),
        "yearLow": info.get("yearLow"),
        "marketCap": info.get("marketCap"),
        "currency": info.get("currency"),
    }


@app.get("/info/{ticker}")
def get_info(ticker: str):
    try:
        info = yf.Ticker(ticker).info
    except (KeyError, IndexError):
        info = None

    if not info or info.get("symbol") is None:
        raise HTTPException(status_code=404, detail=f"No info data for '{ticker}'")

    return info


@app.get("/history/{ticker}")
def get_history(
    ticker: str,
    period: Literal[
        "1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"
    ] = "1y",
    interval: Literal[
        "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"
    ] = "1d",
):
    hist = yf.Ticker(ticker).history(period=period, interval=interval)
    if hist.empty:
        raise HTTPException(status_code=404, detail=f"No history data for '{ticker}'")

    hist = hist.reset_index()
    date_col = "Date" if "Date" in hist.columns else "Datetime"

    return {
        "ticker": ticker.upper(),
        "period": period,
        "interval": interval,
        "candles": [
            {
                "date": row[date_col].isoformat(),
                "open": row["Open"],
                "high": row["High"],
                "low": row["Low"],
                "close": row["Close"],
                "volume": row["Volume"],
            }
            for _, row in hist.iterrows()
        ],
    }


RETURNS_LOOKBACK_DAYS = 252


def get_average_risk_free_rate() -> float:
    supabase = get_supabase()
    res = supabase.table("average_risk_free_rate").select("annual_risk_free_rate").execute()

    if not res.data or res.data[0]["annual_risk_free_rate"] is None:
        raise HTTPException(status_code=404, detail="No risk-free rate data")

    return res.data[0]["annual_risk_free_rate"]


@app.get("/returns/{ticker}")
def get_returns(ticker: str):
    df, varcov = get_returns_df(ticker)
    df = df.tail(RETURNS_LOOKBACK_DAYS).reset_index()

    return {
        "ticker": ticker.upper(),
        "candles": [
            {
                "date": row["date"].date().isoformat(),
                "close": row["close"],
                "stock_log_return": row["stock_log_return"],
                "market_log_return": row["market_log_return"],
                "excess_log_return": row["excess_log_return"],
            }
            for _, row in df.iterrows()
        ],
        "varcov": varcov.values.tolist(),
        "risk_free_rate": get_average_risk_free_rate(),
        "expected_stock_return": df["stock_log_return"].mean() * RETURNS_LOOKBACK_DAYS,
        "expected_market_return": df["market_log_return"].mean() * RETURNS_LOOKBACK_DAYS,
    }


def get_returns_df(ticker: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch the last 1 year of daily log returns for `ticker` alongside the
    S&P 500 (^GSPC) log return on the same dates.

    Returns a tuple of:
    - a DataFrame indexed by date (DatetimeIndex) with columns:
      stock_log_return, market_log_return, excess_log_return. Rows with any
      missing return (e.g. a ticker's first trading day, where there's no
      prior close to diff against) are dropped.
    - the 2x2 variance-covariance matrix of stock_log_return and
      market_log_return.
    """
    supabase = get_supabase()
    symbol = ticker.upper()

    res = (
        supabase.table("daily_excess_returns")
        .select("date, close, stock_log_return, market_log_return, excess_log_return")
        .eq("ticker", symbol)
        .order("date")
        .execute()
    )

    if not res.data:
        raise HTTPException(
            status_code=404, detail=f"No return data for '{symbol}'"
        )

    df = pd.DataFrame(res.data)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").dropna()
    returns_df = df[["stock_log_return", "market_log_return"]]
    centered = returns_df - returns_df.mean()
    varcov = centered.T @ centered / len(centered)
    return df, varcov


def _chunk(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _extract_close_rows(ticker: str, df) -> list[dict]:
    series = df["Close"].dropna()
    return [
        {"date": idx.date().isoformat(), "ticker": ticker, "close": float(value)}
        for idx, value in series.items()
    ]


@app.post("/backfill/sp500-daily-close")
def backfill_sp500_daily_close():
    supabase = get_supabase()
    started = time.monotonic()

    all_tickers = [*SP500_TICKERS, SP500_INDEX_TICKER, RISK_FREE_TICKER]
    rows: list[dict] = []
    failed_tickers: list[str] = []
    errors: list[str] = []

    for chunk in _chunk(all_tickers, FETCH_CHUNK_SIZE):
        try:
            data = yf.download(
                tickers=chunk,
                period="1y",
                interval="1d",
                group_by="ticker",
                auto_adjust=False,
                threads=True,
                progress=False,
            )
        except Exception as exc:  # noqa: BLE001 - report and continue
            failed_tickers.extend(chunk)
            errors.append(f"chunk {chunk[0]}..{chunk[-1]}: {exc}")
            continue

        for ticker in chunk:
            try:
                ticker_df = data[ticker] if len(chunk) > 1 else data
                ticker_rows = _extract_close_rows(ticker, ticker_df)
            except Exception as exc:  # noqa: BLE001 - report and continue
                failed_tickers.append(ticker)
                errors.append(f"{ticker}: {exc}")
                continue

            if not ticker_rows:
                failed_tickers.append(ticker)
                errors.append(f"{ticker}: no data returned")
                continue

            rows.extend(ticker_rows)

    rows_upserted = 0
    for batch in _chunk(rows, UPSERT_CHUNK_SIZE):
        try:
            supabase.table("daily_close_prices").upsert(
                batch, on_conflict="date,ticker", ignore_duplicates=True
            ).execute()
            rows_upserted += len(batch)
        except Exception as exc:  # noqa: BLE001 - report and continue
            errors.append(f"upsert batch starting at row {rows_upserted}: {exc}")

    succeeded = len(all_tickers) - len(failed_tickers)

    return {
        "tickers_requested": len(all_tickers),
        "tickers_succeeded": succeeded,
        "tickers_failed": failed_tickers,
        "rows_fetched": len(rows),
        "rows_upserted": rows_upserted,
        "duration_seconds": round(time.monotonic() - started, 1),
        "errors": errors,
    }

def get_sp500_prices_df() -> pd.DataFrame:
    """Fetch daily close prices for every S&P 500 constituent plus the ^GSPC
    index, pivoted wide (index=date, columns=ticker).

    Deliberately does not fetch the risk-free series or compute log returns —
    the frontier only needs prices plus a single average risk-free rate, which
    comes from `get_average_risk_free_rate()`.
    """
    supabase = get_supabase()
    tickers = [*SP500_TICKERS, SP500_INDEX_TICKER]

    rows: list[dict] = []
    for chunk in _chunk(tickers, FETCH_CHUNK_SIZE):
        start = 0
        while True:
            page = (
                supabase.table("daily_close_prices")
                .select("date, ticker, close")
                .in_("ticker", chunk)
                .order("date")
                .order("ticker")
                .range(start, start + SELECT_PAGE_SIZE - 1)
                .execute()
            ).data
            rows.extend(page)
            if len(page) < SELECT_PAGE_SIZE:
                break
            start += SELECT_PAGE_SIZE

    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No close price data. Run /backfill/sp500-daily-close first.",
        )

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    df["close"] = pd.to_numeric(df["close"])
    df = df.drop_duplicates(subset=["date", "ticker"])
    return df.pivot(index="date", columns="ticker", values="close").sort_index()


def _make_efficient_frontier(
    mu: pd.Series, S: pd.DataFrame, short_allowed: bool
) -> EfficientFrontier:
    """Build an EfficientFrontier with the per-stock cap applied consistently.

    When shorting is allowed the cap is symmetric (|w| <= 3%): a plain
    `w <= 0.03` would cap only the long side and leave shorts bounded solely by
    the -1 weight floor.
    """
    weight_bounds = (-1, 1) if short_allowed else (0, 1)
    ef = EfficientFrontier(mu, S, weight_bounds=weight_bounds, solver="CLARABEL")
    if short_allowed:
        ef.add_constraint(lambda w: cp.abs(w) <= MAX_STOCK_WEIGHT)
    else:
        ef.add_constraint(lambda w: w <= MAX_STOCK_WEIGHT)
    return ef


def _portfolio_stats(
    weights: np.ndarray, mu: pd.Series, S: pd.DataFrame, risk_free_rate: float
) -> tuple[float, float, float]:
    """Expected return, volatility and Sharpe for an arbitrary weight vector,
    evaluated directly against mu/S rather than via a solve."""
    annual_return = float(weights @ mu.values)
    volatility = float(np.sqrt(weights @ S.values @ weights))
    sharpe = (annual_return - risk_free_rate) / volatility if volatility else 0.0
    return annual_return, volatility, sharpe


def build_efficient_frontier(
    ShortAllowed: bool, n_portfolios: int = ENVELOPE_POINTS
) -> dict:
    """Build the efficient-frontier envelope for the S&P 500 universe.

    Optimises two anchor portfolios under identical constraints — the max-Sharpe
    (tangency) portfolio and the minimum-volatility portfolio — then sweeps a
    blend of the two weight vectors across `n_portfolios` steps to trace an
    envelope of further efficient portfolios for plotting.
    """
    if not MIN_ENVELOPE_POINTS <= n_portfolios <= MAX_ENVELOPE_POINTS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"n_portfolios must be between {MIN_ENVELOPE_POINTS} and "
                f"{MAX_ENVELOPE_POINTS}"
            ),
        )

    prices = get_sp500_prices_df()
    # ^GSPC is fetched for reference but is an index, not an investable holding.
    stock_prices = prices[[t for t in SP500_TICKERS if t in prices.columns]]

    mu = expected_returns.mean_historical_return(stock_prices)
    mu = mu.clip(lower=-MU_CLIP, upper=MU_CLIP)
    S = risk_models.CovarianceShrinkage(stock_prices).ledoit_wolf()
    risk_free_rate = get_average_risk_free_rate()

    ef_sharpe = _make_efficient_frontier(mu, S, ShortAllowed)
    ef_sharpe.max_sharpe(risk_free_rate=risk_free_rate)
    sharpe_weights = pd.Series(ef_sharpe.clean_weights()).reindex(mu.index).fillna(0.0)

    ef_minvol = _make_efficient_frontier(mu, S, ShortAllowed)
    ef_minvol.min_volatility()
    minvol_weights = pd.Series(ef_minvol.clean_weights()).reindex(mu.index).fillna(0.0)

    # Blend the two anchors' weights; both sum to 1, so every blend does too.
    envelope = []
    for t in np.linspace(0.0, 1.0, n_portfolios):
        blended = (1 - t) * sharpe_weights.values + t * minvol_weights.values
        annual_return, volatility, sharpe = _portfolio_stats(
            blended, mu, S, risk_free_rate
        )
        envelope.append(
            {
                "t": float(t),
                "return": annual_return,
                "volatility": volatility,
                "sharpe": sharpe,
            }
        )

    def _summarise(weights: pd.Series) -> dict:
        annual_return, volatility, sharpe = _portfolio_stats(
            weights.values, mu, S, risk_free_rate
        )
        holdings = weights[weights.abs() > 1e-4].sort_values(ascending=False)
        return {
            "return": annual_return,
            "volatility": volatility,
            "sharpe": sharpe,
            "weights": {
                ticker: round(float(weight), 4) for ticker, weight in holdings.items()
            },
        }

    max_sharpe = _summarise(sharpe_weights)

    # Capital market line: from the risk-free asset through the tangency
    # (max-Sharpe) portfolio, extended past it into levered territory.
    slope = (
        (max_sharpe["return"] - risk_free_rate) / max_sharpe["volatility"]
        if max_sharpe["volatility"]
        else 0.0
    )
    max_volatility = (
        max(point["volatility"] for point in envelope) * CML_LEVERAGE_EXTENSION
    )
    capital_market_line = [
        {"volatility": volatility, "return": risk_free_rate + slope * volatility}
        for volatility in (0.0, max_volatility)
    ]

    return {
        "short_allowed": ShortAllowed,
        "n_portfolios": n_portfolios,
        "risk_free_rate": risk_free_rate,
        "max_sharpe": max_sharpe,
        "min_volatility": _summarise(minvol_weights),
        "capital_market_line": capital_market_line,
        "envelope": envelope,
    }


@app.post("/efficient-frontier")
def post_efficient_frontier(
    short_allowed: bool = False, n_portfolios: int = ENVELOPE_POINTS
):
    return build_efficient_frontier(short_allowed, n_portfolios)

