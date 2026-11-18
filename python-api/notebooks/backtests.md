# Proposal: Backtesting Valuation Signals with Reverse DCF

**Status:** development tests done, holdout not yet run · live warehouse phase 1 in progress (§17) · **Last revised:** 2026-11-17

§1–§12 are the original plan. §13–§17 record what development found and what comes next: the signals added to the product, further models graded by feasibility, how each is tested, how the signal is shown on the screener, and the live data warehouse that computes it.

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
| Learned or forest-based model weights | Phase 2, see §14 | A first regression tree failed out of sample (§13). Forests, linear combinations and regime models are graded in §14 and tested under §15 |
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

---

## 13. What development found, and what the product adds

Development dates only (Mar 2023 – Jan 2025, 23 months), target = 1-month factor-adjusted return, CAPM benchmark. Run of 2026-11-17.

| Signal | Mean IC | IC t-stat | IC > 0 | Q5 − Q1 / month | FF5 alpha / yr (t) | Coverage, dev | Coverage, Oct 2026 |
|---|---|---|---|---|---|---|---|
| **Value + momentum** (mean percentile of combined alpha and momentum) | **0.056** | 1.91 | 70% | 0.8% | +1.0% (0.08) | 97.7% | 86.5% |
| Combined alpha (value) | 0.036 | 1.17 | 61% | 0.4% | −5.3% (−0.86) | 97.9% | 86.5% |
| **Momentum + surprise** (mean percentile of momentum and earnings surprise) | 0.035 | 1.45 | 70% | **0.8%** (t 1.58) | **+3.0%** (0.33) | 98.5% | 96.0% |
| Momentum 12-1 | 0.029 | 1.17 | 65% | 0.5% | −0.6% (−0.05) | 99.8% | 99.4% |
| Earnings surprise (SUE against the analyst forecast, scaled by price) | 0.025 | 1.49 | 65% | 0.3% | −5.2% (−0.90) | 98.9% | 96.4% |

Coverage is the share of stock-months with a value; about 466–476 stocks per date in development. Value's lower coverage in Oct 2026 is the holdout rows' missing CAPM betas where the Fama-French library ends (Sep 2026), not missing statements.

- The two blends are the strongest results in the study and neither is significant on 23 months. Momentum + surprise has the best spread and the only positive factor-adjusted alpha; value + momentum has the best ranking.
- **Regression tree** (`backtest/ml/tree.py`, 33 percentile-ranked predictors, 200-round date-block bootstrap): negative out-of-bag R² at every depth (−1% to −6%) and an out-of-bag IC of about zero. It loses to both blends on most rounds. The fitted tree splits mostly on statement staleness, which is the earnings calendar, not value.

**Decision.** The product shows three signal components (value, momentum, earnings surprise) and their blends, as percentiles (§16). The forward-DCF consensus stays on the site as context. The holdout has not been run, so everything the screener says about these signals is development-period evidence, and the page says so.

---

## 14. Further models, graded by feasibility

Graded on four things: whether the data is already loaded, how many parameters the model has to fit on 23 development months, whether it can be computed live in SQL (§17), and whether a screener reader can be told what it means in one line.

| Grade | Meaning |
|---|---|
| **A** | Data in hand, nothing or one parameter to fit, live in SQL. Do next |
| **B** | Feasible, but fits enough parameters that 23 months is thin, or needs a Python step in the live pipeline |
| **C** | Needs data yfinance does not provide, or a longer window than exists. Deferred |

| Model | What it is | Data | Fit | Live | Grade |
|---|---|---|---|---|---|
| 52-week-high momentum | Price ÷ its 252-day high (George & Hwang 2004). Less crash-prone than 12-1 momentum | Prices | None | SQL | **A** |
| Standardised surprise (SUE) | Surprise ÷ the std of the firm's last 8 surprises, rather than ÷ price | `earnings` holds ~40 reports a ticker | None | SQL | **A** |
| Net share issuance | Minus the 1-year change in split-adjusted shares (Pontiff & Woodgate 2008) | Share-count history | None | SQL | **A** |
| IC-weighted blend | Weight each component by its trailing mean IC instead of equally | The study's own IC series | One weight per component, re-estimated monthly | SQL | **A** |
| Residual momentum | 12-1 momentum on CAPM residual returns (Blitz, Huij & Martens 2011) | Prices, factors | None | SQL (one-factor residuals) | **A−** |
| Sector-neutral momentum and surprise | Percentile within sector instead of within the index | Sector | None | SQL | **A−** |
| Ridge or lasso on ranked characteristics | Linear map from the 33 percentile ranks to the target, fitted walk-forward | `model_data.parquet` | 33 coefficients plus a penalty | Coefficients exported to a table, scored in SQL | **B** |
| Random forest / gradient boosting | Bagged or boosted trees on the same ranks | Same | Hundreds of splits; the single tree already failed | Python scoring job | **B−** |
| HMM regime switching | Two- or three-state hidden Markov model on daily HML and UMD factor returns since 1963; the regime decides the value/momentum weights | `factor_returns` covers 60 years, so the regime model is not limited to 23 months, though its effect on the blend is | ~10 parameters, fitted on factor history only | Python job writes one regime probability a day | **B** |
| Industry momentum | Momentum of the stock's industry (Moskowitz & Grinblatt 1999) | Industry from the profile; 20–40 names per industry | None | SQL | **B** |
| Analyst estimate revisions | Change in consensus EPS over 1–3 months | yfinance has the final estimate only | – | – | **C** |
| Short interest | Days-to-cover | Not in yfinance history | – | – | **C** |
| Longer point-in-time window | Compustat via WRDS (open question 4) | Not available | – | – | **C** |

Already tested and not pursued: quality (ROIC), gross profitability, low accruals, low volatility, magic formula, 1-month reversal, sector-neutral value (all ≤ the value baseline in §13); COMPS (dropped by the keep rule); the forward-DCF margin (beaten by reverse FCFF in test 2).

**Order:** the five A-grade signals first, each as a single component. Then the IC-weighted blend over whatever survives. Then ridge, as the only fitted model whose weights can be read off and checked. Forest and HMM only if ridge beats the equal-weight blend. A model the equal-weight blend cannot be shown to lose to adds a parameter and nothing else.

---

## 15. How each is tested

Every candidate goes through the same bench as §7, on the same development dates and the same 1-month factor-adjusted target, so results compare directly.

**Every candidate:**

1. **Test 1** (rank IC, IC t-stat, share of months positive, Q5 − Q1 spread, coverage) on its own.
2. **Head-to-head:** against the best current blend (value + momentum) on the **same stocks**, with a t-stat on the monthly IC difference (test 2's method). A new component joins the blend only if adding it raises the blend's IC on the same stocks.
3. **Test 5 attribution**, so a "new" signal that is a known factor in disguise is caught.
4. **Robustness:** 3-month target with Newey-West errors, and total returns, as in cell 16.

**Fitted models** (IC weights, ridge, forest, HMM) add three rules, because a fitted model can memorise development:

- **Walk-forward is the score that counts.** Fit on the dates before t, predict t, and step forward a month. The IC of those predictions is the model's IC. Nothing fitted is ever scored on a date it was trained on.
- **The date-block bootstrap (`tree.py`) is for choosing settings**, such as depth, penalty or number of states, and for the spread of the score. Whole months are resampled, never rows, because stocks in the same month share that month's shock. It ignores time order, so it chooses settings; it is not the reported number.
- **Baselines on the same rounds:** each round also scores value + momentum and momentum + surprise on the same out-of-bag dates, and the result is reported as the share of rounds the model beats them.

**Specific checks:**

| Model | Extra check |
|---|---|
| IC-weighted blend | The weights at each date use only ICs from earlier months, with a 1-month gap, since a 1-month target is not known until a month after the date |
| Ridge / lasso | The penalty is chosen by bootstrap inside each walk-forward window; report how much the coefficients move from one window to the next |
| Forest / boosting | Same, plus permutation importance on walk-forward predictions, to check it is not splitting on the earnings calendar again |
| HMM | Fitted on factor returns before each date only; the test is whether the regime-weighted blend's IC beats the fixed 50/50 blend; report how many regime switches fall inside development (probably one or two) |
| 52-week high, SUE, issuance | Check correlation with existing components; above about 0.7 it is the same signal again |

**Against overfitting:**

- Every variant tried goes in the variant log, as §4 already requires.
- With more than ten variants, promote only on an IC t-stat above 3 (Harvey, Liu & Zhu 2016), not 2.
- The holdout is run once, after the specification is frozen and committed.

---

## 16. Showing the signal on the screener

**Ranks, not magnitudes.** Test 4 found the size of expected alpha meaningless (calibration slope 0.14), so no component is shown as a forecast return. Each is a **percentile within today's universe**, 0–100, the same arithmetic the blends were tested with.

| Component | Raw value | Shown as |
|---|---|---|
| Value | Combined expected alpha: the average of reverse FCFF, RIM, revenue and shareholder-yield alphas against CAPM | Percentile, with the four implied returns on the stock page |
| Momentum | Return from 12 months to 1 month ago | Percentile, with the raw return |
| Earnings surprise | (Reported − estimated EPS) ÷ price, latest report within 100 days | Percentile, with the raw surprise |

**One score, chosen components.**

- The screener's signal score is the mean percentile of the components switched on: value + momentum by default, the best tested blend.
- Momentum + surprise, a single component, or all three are one click away. All three together is untested and says so.
- A stock missing any selected component is unscored rather than averaged over fewer, so the rule is the same as the valuation models' "rated only when all selected models speak".

**How it reads:**

- A **Signal** column, the default sort, with the score and a bar. It is coloured by quintile from the existing **sequential palette** (magnitude), not the valuation bands' diverging cheap/expensive palette, because a percentile has no fair-value midpoint.
- Quintile chips in the filter rail, beside the existing valuation bands.
- Each component toggle carries its coverage and its development IC, and the rail states that the evidence comes from 23 development months with the holdout not yet run.
- The stock page gets a signals panel: each component's raw value and percentile, the score, and the four implied returns against the required return.

**What stays:** the valuation bands and the model toggles remain as filters. They stop being the default ordering, because the backtest ranks them below the signal.

**Revised 2026-11-17: forward fair values removed.** Live, the forward models gave margins from −90% to +742% (RIM's median −66%), which read as nonsense on a screener. The "Price implies" column, the bands and the model toggles now use the reverse-DCF implied excess return instead: the four kept models, averaged over whichever solve (test 3's rule), banded at today's quintiles (−7.0 / −2.9 / +0.1 / +2.2%). DDM, FCFE, FCFF, RIM and comps are dropped from the warehouse (`20261117000003_drop_forward_models.sql`) along with `valuation_history`.

---

## 17. The live data warehouse

**Shape: ELT.** Python extracts from yfinance and Ken French and loads the rows untouched. Postgres does every transformation. The site reads a small serving layer.

| Schema | Holds | Written by | Read by |
|---|---|---|---|
| `raw` | Provider rows as fetched: `company_profile`, `daily_prices` (close and adjusted close), `dividends`, `splits`, `statement_items` (long format, annual and quarterly), `shares_outstanding`, `earnings`, `factor_returns`. Upserted, never deleted, so history accumulates past yfinance's 4-year window | `python-api/ingest.py` over a direct Postgres connection | `warehouse` only |
| `warehouse` | Every transform, in SQL: statement pivots (annual, point-in-time, and TTM), split-adjusted shares, rates, CAPM betas, return statistics, the reverse-DCF implied returns (a PL/pgSQL root solver), momentum, surprise, percentiles; materialised views refreshed by `warehouse.refresh()`, plus the dated archive `signal_history` (the five forward models and `valuation_history` were dropped in 20261117000003) | `warehouse.refresh()` after each ingest | `public` |
| `public` | The API: `screener` (one row per stock), `stock_prices`, `market_summary`, `job_runs`, `frontier_snapshot` | Views over `warehouse`; `job_runs` and `frontier_snapshot` by the service | The site (anon key, read only), the optimiser |

**Same specification as the backtest.**

- An annual statement is usable from period end + 60 days, and is stale after 440.
- N = 5, g_L = min(2.5%, rf), and the CAPM benchmark against rf = the spot 10-year yield (^TNX).
- Shares are the 90-day median of split-adjusted share counts.
- The SQL is ported from `DWimplementation_v2.sql` and the notebook. The one live difference is the as-of date: the latest close instead of a month end.

**Forward models move to SQL too, with three changes:**

- **Cost of equity:** CAPM instead of FF5, the benchmark §7's diagnostic chose, and the only one that does not need a multi-factor regression per stock.
- **Risk-free rate:** ^TNX instead of the 252-day average ^IRX. The 13-week rate stays on the optimiser's Sharpe ratio.
- **Growth, payout, EPS and book value:** taken from the statements instead of yfinance's `.info` snapshot.

The FCFF working-capital term is added rather than subtracted. yfinance reports it with its cash-flow sign, as the backtest SQL already assumes.

**What Python stopped doing.** The modules below are kept in the repo and no longer imported:

| Module | Replaced by |
|---|---|
| `fundamentals.py` (statement pivot in Python) | `warehouse.fundamentals_*` |
| `engine.py` and the forward models in `valuation.py` | nothing: retired in 20261117000003 |
| `universe.py` (screener payload assembly) | `public.screener` |
| `backfill.py` | `pipeline.py` + `ingest.py` |

Python keeps extraction, loading and the optimiser.

**Phases:**

1. **Warehouse and signal on the site** (this change): raw / warehouse / public schemas, ingest, `refresh()`, the screener signal and the stock-page panel.
2. **Holdout:** freeze the specification in a committed config, run tests 1–5 once on May 2025 – Oct 2026, and report the result on the about page whatever it is.
3. **A-grade models** (§14), through §15, then the IC-weighted blend.
4. **Portfolio stage** (§9) with the frozen signal, ranked rather than scaled, as the optimiser's expected-return input.
