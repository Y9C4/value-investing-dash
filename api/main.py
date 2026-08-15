import json
import os
import time
from pathlib import Path
from typing import Literal

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

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
