# Proposal: Backtesting Valuation Signals with Reverse DCF

**Status:** draft plan · **Last revised:** 2026-11-14

---

## 1. Summary

The question this backtest answers:

> *Do VID's valuation models identify stocks that go on to beat what their risk alone would predict, using only data that was public at the time?*

The plan does three things:

1. **Switch the models from forward to reverse DCF.** Each model currently turns a discount rate into a fair price. Instead, each one solves for the **implied return**: the return an investor would earn buying at today's price, given the company's cash flows. Subtracting the required return (WACC for firm-level models, cost of equity for equity-level ones) gives an **expected alpha** in % per year.
2. **Test the signal before the portfolio.** Valuation signals are evaluated with cheap cross-sectional statistics, iterated freely during a development period, then frozen and run once on a locked holdout.
3. **Run the optimiser once, at the end, in a separate stage.** It uses the frozen signal as its expected-return input.

Everything uses yfinance data. Portfolios are formed at every month-end. The usable window is about Mar 2023 – Oct 2026 (about 44 dates), set by how many years of annual statements yfinance provides.

---

## 2. Why reverse DCF

| Problem with the current forward-DCF margins | How reverse DCF fixes it |
|---|---|
| Margins from different models are on different scales (DDM −70%, COMPS +150%), so the model with the most extreme numbers dominates the consensus | Every model outputs a return in % per year, so outputs are comparable and can be averaged |
| A fair value is very sensitive to the discount rate, and the Fama-French betas behind that rate are estimated from only 252 days of returns, so they are noisy | The implied return comes from price and cash flows. The Fama-French rate is only the benchmark it is compared against |
| A high value-factor loading raises the discount rate, which lowers fair value and penalises the cheap stocks the screen is looking for | The value tilt is measured separately in attribution, rather than built into the price |
| The optimiser forecasts returns from past returns, which the README itself criticises | Expected alpha *is* a return forecast, so it can feed the optimiser directly and connect the two halves of the product |

---

## 3. What yfinance can supply

Checked on AAPL, JPM, KO and MSFT on 2026-11-12:

| Data | History |
|---|---|
| Annual statements (income, balance sheet, cash flow) | 4 usable fiscal years (about FY2022/23 – FY2025/26). yfinance returns a 5th, older column, but it holds only a handful of stray line items |
| Quarterly statements | 5–7 quarters, too few to rebuild a rolling 4-quarter (TTM) figure beyond about a year back |
| Share count history | Back to 2015. Not split-adjusted, unlike prices and statement share counts |
| Prices and dividends | Decades |

**Consequence:** valuations are built from **annual** statements only, refreshed once a year per company. Prices, the risk-free rate, betas and required returns update every month. Quarterly statements are not used: rebuilding TTM flows from 5 quarters gives at most two points per ticker.

**Facts about the current system that affect this plan**

- Stored prices come from `Close` with `auto_adjust=False`. They are split-adjusted, but dividends are not included.
- The `valuations` table is keyed on `(ticker, method)` and `universe_snapshot` is a single row. No valuation history is kept, which contradicts the README's claim that valuations are "stored per stock, model and date".
- Fama-French factor premia are already long-run averages (the full history since 1963). Betas use 252 days of daily returns.

---

## 4. Validation design

### Rebalance dates

**Calendar time, monthly:** the last trading day of every month. At each rebalance date, every stock is valued on that same day, using its newest annual statement that was public by then (§5). This is the standard design for cross-sectional signal tests (Fama-French; Hou, Xue & Zhang; Asness & Frazzini 2013). It gives about 500 stocks on every date and a natural date to form portfolios on.

Valuing each company once, on its own report date (event time), was rejected: about 75% of companies have December year-ends, so dates bunch in March and leave 20–30 stocks in most other months, and staggered dates give no single day to hold a portfolio.

`backtest.models` holds Mar 2022 – Oct 2026. Coverage is thin before **Mar 2023** (3–36 stocks per date in 2022), because yfinance's oldest annual column is almost always empty, so analysis starts in Mar 2023. Oct 2026 has no complete forward window yet.

### Split

| Part | Dates | Purpose |
|---|---|---|
| Development | Mar 2023 – Jan 2025 (23 dates) | All design choices: growth assumptions, which models stay, how to combine them, how to calibrate |
| Embargo | Feb – Apr 2025 (3 dates) | Skipped, so no 3-month return window overlaps both sides |
| Holdout | May 2025 – Oct 2026 (18 dates; 17 with a 1-month outcome) | Run **once** after the design is frozen. This is the reported result |

The split is stored per row in `backtest.models.split`.

### Rules

- **Not random k-fold.** Stocks on the same date move together, and random splits leak future information into training.
- **Walk-forward only where something is fitted.** Use it inside development, and only if a later phase adds fitted weights. Equal-weight combinations with fixed assumptions have nothing to fit.
- **Freeze before the holdout.** Write the chosen specification to a config file and commit it before running the holdout.
- **Keep a variant log.** Record every specification tried in development, about a dozen at most.

---

## 5. Data (yfinance, loaded once into the local database's `backtest` schema)

| Input | Point-in-time rule |
|---|---|
| Universe | Today's S&P 500 list (survivorship bias acknowledged in §11) |
| Annual fundamentals: EBIT, tax rate, D&A, capex, change in working capital, net income, EBITDA, operating income, revenue, book equity, invested capital, debt, lease obligations, cash, interest expense, dividends, net share issuance | A fiscal year is usable from **fiscal year end + 60 days**, the 10-K deadline for large accelerated filers (nearly all of the S&P 500). The newest usable year is taken at each rebalance date; a year older than 440 days (60 + 365 + slack for 52/53-week years) is treated as stale and dropped |
| Shares outstanding | Share count history as of the rebalance date, converted to today's split basis to match prices. Median of the last 90 days of filings, because Yahoo's series interleaves two sources and sometimes posts a post-split count early |
| **Valuation price** | Raw close (split-adjusted only) on the rebalance date. Market cap = price × shares, and dividend-adjusted prices would understate past market caps |
| **Enterprise value** | Market cap + net debt. Net debt = total debt − lease obligations − (cash + short-term investments), allowed to go negative for net-cash companies. Yahoo's own `Net Debt` line is not used: it excludes short-term investments and is dropped whenever cash exceeds debt |
| **Return price** | Dividend-adjusted close, for all forward and portfolio returns |
| Risk-free rate | Spot **10-year Treasury yield** (`^TNX`) on the rebalance date: the maturity-matched rate for discounting long-lived cash flows. The Fama-French daily `rf` is used only for excess returns in beta regressions |
| Fama-French 5 factors | Betas estimated only on data up to the rebalance date. Factor premia are the expanding arithmetic average since 1963, up to the rebalance date, annualised |
| Sector | Current profile (minor look-ahead, acknowledged) |

All of these are assembled into one table, `backtest.models`: one row per (rebalance date, ticker).

**Targets**

- **Primary:** 1-month **factor-adjusted return**: the realised return minus what the stock's betas (estimated at the rebalance date) predict from the factors' actual returns over the window. The factor returns compounded over each window are stored with the row (`fwd_*_1m`).
- **Secondary:** 3-month factor-adjusted return (windows overlap on a monthly calendar, so use Newey-West standard errors), and total returns at both horizons.
- Forward factor windows that run past the last published Fama-French date are left empty rather than computed over a partial window.

Coverage per date: about 406 stocks in Mar 2023, about 492 from Nov 2023. Non-December fiscal years enter late because their oldest yfinance year is empty (AAPL first appears in Nov 2023). Report coverage per date.

---

## 6. Candidate models (reverse form)

Each model solves `price = PV(projected cash flows, r)` for `r`, with the rebalance date as t = 0. Expected alpha = `r` − the required return. The required return must match the level of the cash flow:

- **Firm-level** models (reverse FCFF, reverse revenue) solve against enterprise value, so `r` is compared with **WACC**: equity weight × cost of equity + debt weight × cost of debt × (1 − tax). Weights use gross debt excluding leases (net debt can be negative). Cost of debt = interest expense / debt excluding leases, clamped to 2–15%.
- **Equity-level** models (reverse RIM, shareholder yield) solve against market cap, so `r` is compared with the **cost of equity**.
- Cost of equity = risk-free rate + Σ beta × factor premium, using FF5 or CAPM (see the diagnostic in §7).

A model returns nothing when the solve is undefined (for example, negative cash flow, or enterprise value ≤ 0).

| Model | Cash flow solved against | Covers |
|---|---|---|
| Reverse FCFF | Free cash flow to the firm against enterprise value | Most non-financial companies |
| Reverse RIM | Book value plus residual earnings | Banks and insurers, which the cash-flow models skip |
| Reverse revenue | Revenue, with margins reverting to the sector median | Loss-making companies with no positive cash flow |
| Shareholder yield | Dividends plus net buybacks | Replaces DDM's narrow coverage (DDM only runs on stocks yielding at least 1.5%) |
| COMPS | Not a natural implied return | Kept as a relative check. Joins the alpha average only if it passes test 1 on its own |

**Growth specifications to compare in development.** With flat growth, the implied return is roughly yield + growth, which is just the plain ratio. The model only adds information through its growth assumptions, so compare:

1. Flat long-run nominal growth
2. Trailing growth fading to long-run growth over 5 years
3. Sector-median growth fading to long-run growth over 5 years

**How the fade works (reverse FCFF).** Solve for `r`:

```
EV = Σ_{t=1..N} FCFF_t / (1+r)^t  +  [FCFF_N (1+g_L) / (r − g_L)] / (1+r)^N
FCFF_t = FCFF_0 × Π_{k=1..t} (1 + g_k)
g_k   = g_0 + (g_L − g_0) × k / N        (linear fade, reaching g_L in year N)
```

| Parameter | Choice |
|---|---|
| `FCFF_0` | FCFF from the statement in use at the rebalance date. No value if ≤ 0 |
| `g_0`, trailing | Revenue CAGR from the statement 2 years earlier, else 1 year earlier: `(Rev_T / Rev_{T−k})^(1/years) − 1`, with years taken from the actual period ends. Computed once per statement, not per rebalance row. Revenue rather than FCFF, because FCFF growth is too noisy and often undefined. Clamped to [−10%, +25%], since past growth barely persists (Chan, Karceski & Lakonishok 2003) |
| `g_0`, sector | Median trailing `g_0` across the sector at the rebalance date |
| `g_0`, missing | A ticker's first usable statement has no earlier year to compare with. Fall back to `g_L` (the flat specification) and flag the row |
| `g_L` | 2–3% nominal, at most the risk-free rate. Must stay below `r` |
| `N` | 5 years; check N = 3 and N = 10 for robustness |

With flat growth this reduces to `r = FCFF_0 (1 + g_L) / EV + g_L`. Otherwise `f(r) = PV(r) − EV` is strictly decreasing on (g_L, ∞) when every `FCFF_t > 0`, so it has exactly one root; solve with `brentq`. A linear fade is used first; an exponential fade (`g_k = g_L + (g_0 − g_L) φ^k`) adds a parameter and is only worth trying if the linear one shows promise.

The existing five forward models stay in the codebase and on the dashboard. This plan decides which models feed the **consensus**.

---

## 7. What gets tested

### Core tests

| # | Test | Question it answers |
|---|---|---|
| 1 | **Signal quality.** Per model, per rebalance date: rank IC between expected alpha and next-month factor-adjusted return, the top-fifth minus bottom-fifth spread, and coverage. Average the monthly ICs and report a t-statistic (Fama-MacBeth style) | Does the model rank stocks usefully, and for how much of the index? |
| 2 | **Beat the simpler version.** Each model vs its plain ratio (FCF yield, earnings yield, book-to-price, shareholder yield, sector-relative EV/EBITDA), and vs the current forward-DCF margin | Do the model's assumptions add anything? Does reverse DCF beat the current approach? |
| 3 | **Combination.** Equal-weight average of the surviving models' expected alphas vs the best single model vs a plain ratio composite | Is the combined signal better than its parts and better than simple value? |
| 4 | **Calibration.** Bucket stocks by predicted alpha and compare with realised factor-adjusted return | Is the *size* of expected alpha meaningful? If not, it must be scaled before it reaches the optimiser |
| 5 | **Factor attribution.** Fama-French 5 regression of the top-minus-bottom returns for the final signal, plus one table across all models | Is there alpha beyond value, size, profitability and investment exposure? |

**One extra diagnostic:** compare FF5, CAPM and a single flat rate as the required-return benchmark. Run it once, then pick one.

### Rules for keeping a model

A model goes into the consensus only if both hold during development:

- its IC is positive on most dates
- it at least matches its plain ratio

Report negative results as they come out (for example, "the reverse revenue model added nothing, so it was dropped").

### Deferred or cut

| Item | Decision | Reason |
|---|---|---|
| Valuation band tests | Cut | Bands are quintiles, so test 1's spread already covers them |
| Sector breakdown for every variant | Cut | One sector table for the final signal only |
| 2015–2026 optimiser backtest with historical-mean returns | Optional | The real comparison is now historical mean vs expected alpha, and that only exists inside the signal window |
| Long-short portfolios, transaction-cost grid, L2 grid | Deferred | Not needed to answer the core question |
| Learned or forest-based model weights | Phase 2 | Only if a characteristics-bucket analysis (model IC by sector, P/E, momentum, leverage, capex intensity) shows a pattern that holds across dates. Needs a characteristics-only control to rule out hidden momentum or sector bets |
| Deflated Sharpe ratio | Conditional | Only if many portfolio configurations end up being compared |

---

## 8. Pipeline

Each stage is cached and lives in its own file, so a later stage never forces an earlier one to rerun.

| Stage | Does | Output | Cost | Reruns |
|---|---|---|---|---|
| 0. Data | Pull from yfinance into the `backtest` schema, then build `backtest.models` (one row per rebalance date × ticker, point-in-time rules applied) with `DWimplementation.sql` | Local Supabase (Postgres) | ~10 min load, ~2 s build | Once; rebuild `models` when an input rule changes |
| 1. Signals | For each date × stock × model: implied return (root solve), required return, expected alpha, plain ratios | One long table: `date, ticker, model, value` | Seconds to minutes (~35k solves) | When a model specification changes |
| 2. Evaluation | Join forward returns, then compute IC, spreads, calibration and factor regressions | Tables and charts | Seconds | Freely, during development |
| 3. Freeze and holdout | Commit the chosen specification, then run stages 1–2 on the holdout dates | Reported results | Seconds | **Once** |
| 4. Portfolio | Optimiser comparisons using only the frozen signal (§9) | Portfolio results | Seconds to minutes | After stage 3 |

**Leak test:** `backtest/test_leaks.py` fails if any input to a rebalance date is dated after that date. **Needs updating:** it and `backtest/pit.py` still target the earlier design (quarterly `rebalance_dates`, the `annual_fundamentals` view, a 90-day lag). Stage 1 now reads `backtest.models`, so the test should check that table instead: `period_end + 60 <= rebalance_date` on every row (verified 0 violations on 2026-11-14), prices and share counts on or before the rebalance date, and no development window overlapping the holdout.

**Code reuse:** the final reverse-DCF functions move into `valuation.py`, so the dashboard runs the same code that was tested.

---

## 9. Portfolio stage

The optimiser runs only after the signal is frozen, as a single solve per date per configuration: maximise expected return minus a fixed risk-aversion penalty on variance. No frontier tracing. About 44 monthly dates × 6 configurations ≈ 260 solves.

All portfolios are long-only, drawn from the top fifth by expected alpha, and use the default position cap unless stated otherwise.

| Configuration | Expected-return input |
|---|---|
| Equal-weight (1/N) | None (baseline) |
| Minimum variance | None |
| Mean-variance | Historical mean returns (the current product) |
| Mean-variance | Calibrated expected alpha |
| Mean-variance, looser cap | Calibrated expected alpha |
| Mean-variance + L2 | Calibrated expected alpha |

- **Benchmarks:** S&P 500 total return and an equal-weight S&P 500.
- **Metrics:** annualised return, volatility, Sharpe, maximum drawdown, turnover, FF5 alpha.

---

## 10. Order of work

1. **Archive dated valuation snapshots.** Write a dated copy of each nightly run from now on. This builds a forward track record and fixes the README claim.
2. **Stage 0:** data cache and leak test.
3. **First answer:** stage 1 with one model (reverse FCFF, flat growth), then tests 1 and 2.
4. Add the other models and growth specifications, development dates only.
5. Combination, calibration, attribution and the required-return diagnostic.
6. Freeze and run the holdout.
7. Stage 4 portfolio file.
8. Write-up and a Backtest page on the dashboard. Move the reverse-DCF code into `valuation.py`.

---

## 11. Limitations

- **Survivorship bias.** The universe is today's S&P 500. yfinance has no historical membership and few prices for delisted names; in `backtest.models` every row has a forward return, so no stock ever drops out. Over about 3 years the effect is modest, but it inflates absolute returns. Rank-based tests are less affected.
- **Restated figures.** yfinance shows older years as later restated, not as originally filed.
- **Short window, one market regime.** 2023–2026 was mostly a market led by mega-cap growth stocks, so value probably lagged. A weak headline result is possible. Factor-adjusted targets and attribution keep the study informative either way.
- **Few time periods.** About 44 monthly dates support claims about cross-sectional ranking, not strong claims about long-run strategy returns. Fundamentals change only once a year per company, so successive months are not independent signals.
- **Shallow growth history.** Trailing growth uses at most two prior years, and is missing for each company's first usable statement.

---

## 12. Open questions

1. ~~Should the horizon be 3 months or 12 months?~~ Settled: monthly rebalancing with a 1-month primary horizon, 3 months secondary (§5).
2. What happens to a model that fails test 2: hidden from the dashboard, or kept visible with zero weight in the consensus?
3. Should the dashboard switch to expected alpha as the screening metric once the holdout passes?
4. Is WRDS/Compustat available through the university? Longer point-in-time fundamentals would extend the window to many years.
