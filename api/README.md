# Market data microservice

FastAPI service that wraps `yfinance` and serves quote/history/info data to the Next.js dashboard.

## Setup

```bash
cd api
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --port 8000
```

## Endpoints

- `GET /health` — liveness check
- `GET /quote/{ticker}` — latest price snapshot
- `GET /info/{ticker}` — full yfinance ticker info
- `GET /history/{ticker}?period=1y&interval=1d` — OHLCV candles
