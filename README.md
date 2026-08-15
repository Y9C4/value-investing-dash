Value Investing Dashboard

The goal of this project is to create a dashboard that allows the user to click on a stock and evaluate whether its priced fairly.
- For each individual stock/index, the dashboard will show:
- - CAPM, Fama & French, and other market based measures.
- - P/E, P/B and other ratios
- - Dividend Discount models
- - FCFE model based on publically available earnings data.
- - Market sentiment skew from options pricing
- - implied volatility

- The dashboard will also select stocks from which to make an optimal portfolio allocation with graphs and the works.
- - Users can select criteria based on which they can drop stocks from the market portfolio based on the factors above.
- - Users should be able to toggle short/no short.

Possible ideas for future application:
- identifying companies experiencing rapid growth and use an LLM to identify what project may be leading to the high growth and its completion date to build a multi-stage DDM/FCFE model.

## Running the app

The dashboard is a Next.js app that reads market data from a separate Python microservice (`/api`, see `api/README.md`). Both need to be running for the dashboard to show live data.

### 1. Start the market data API

```bash
cd api
python -m venv .venv
.venv\Scripts\activate   # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

This serves on `http://127.0.0.1:8000`. Leave it running in its own terminal.

### 2. Start the Next.js dashboard

In a separate terminal, from the repo root:

```bash
pnpm install
pnpm dev
```

Copy `.env.local.example` to `.env.local` if you need to point the dashboard at a market data API running somewhere other than `http://127.0.0.1:8000`.

Visit `http://localhost:3000/dashboard` and enter a ticker to see its last 30 days of close prices.
