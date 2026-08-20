# Valuation audit — CHTR (Charter Communications)

An end-to-end trace of the FCFE and FCFF models: every input, where it came
from, and every formula applied, through to the stored fair values.

- **Ticker:** CHTR · Communication Services
- **Price at calculation:** $154.27
- **TTM period ending:** 2026-06-30 (reported 2026-07-24), 4 of 4 quarters
- **Shares outstanding:** 119,277,493
- **Computed:** 2026-08-20

> **One correction to a common assumption.** WACC is used *only* by FCFF.
> FCFE discounts at the cost of equity directly — no WACC anywhere in it.
> Neither model is a line-item DCF; both take a single trailing-twelve-month
> cash flow and run a two-stage present value over it.

---

## 1. Inputs

All figures from `ttm_fundamentals` and `company_profile`. Flow items are summed
over four quarters; stock items are snapshots from the latest quarter.

| Input | Value | Source |
|---|---:|---|
| Operating cash flow (TTM) | 16,470M | `ttm_operating_cash_flow` |
| Capital expenditure (TTM) | −12,112M | `ttm_capital_expenditure` |
| Net borrowing (TTM) | 157M | `ttm_net_borrowing` |
| EBIT (TTM) | 12,592M | `ttm_ebit` |
| Depreciation & amortisation (TTM) | 8,762M | `ttm_depreciation_amortisation` |
| Change in working capital (TTM) | −314M | `ttm_change_in_working_capital` |
| Interest expense (TTM) | 5,070M | `ttm_interest_expense` |
| Average tax rate | 23.617% | `avg_tax_rate` |
| Total debt | 96,710M | `total_debt` |
| Net debt | 96,201M | `net_debt` |
| Market capitalisation | 20,792M | `company_profile.market_cap` |
| Revenue growth | −1.7% | `company_profile.revenue_growth` |
| Earnings growth | +16.1% | `company_profile.earnings_growth` (**unused**) |

**Capex sign convention.** yfinance reports capital expenditure as a negative
number and it is stored as reported. Every formula below therefore *adds* it.
Writing `CFO − CapEx` against a negative figure would double it.

### Constants

| Constant | Value |
|---|---:|
| `PROJECTION_YEARS` | 10 |
| `TERMINAL_GROWTH` | 3.0% |
| `MAX_GROWTH` | 6.0% |
| `MIN_DISCOUNT_SPREAD` | 2.0% |
| `MIN_COST_OF_EQUITY` / `MAX_COST_OF_EQUITY` | 6% / 20% |
| `MIN_COST_OF_DEBT` / `MAX_COST_OF_DEBT` | 2% / 15% |

---

## 2. Growth rate (shared by both models)

Revenue growth is preferred over earnings growth, which swings too hard on
one-off items. It is then halved as a haircut and floored at zero.

```
observed = revenue_growth                       = −1.7%
growth   = max(0, min(0.12, −0.017 × 0.5))      = 0.0%
```

**Charter's cash flows are projected flat for ten years**, then grow at 3% in
perpetuity. The 16.1% earnings growth figure never enters the calculation.

---

## 3. Cost of equity

Taken from the **Fama-French five-factor regression**, not CAPM. CAPM is only
the fallback when the regression cannot run.

```
ke = rf + Σ βᵢ λᵢ          clamped to [6%, 20%]
```

**ke = 15.49%**

*(Recovered by solving the stored fair values back through the present-value
formula; confirmed independently in section 6.)*

---

## 4. FCFE — Free Cash Flow to Equity

### Cash flow

```
FCFE = CFO + CapEx + net borrowing
     = 16,470M + (−12,112M) + 157M
     = 4,515M
```

### Guards

| Check | Result |
|---|---|
| Sector not Financial Services / Real Estate | pass |
| `quarters_used` = 4 | pass |
| FCFE > 0 | pass |
| `ke − growth ≥ 2%` → 15.49% − 0% | pass |

### Discounting

Two-stage present value at the cost of equity:

```
Equity = Σ(t=1..10) FCFE·(1+g)ᵗ / (1+ke)ᵗ  +  [FCFE·(1+gₜ) / (ke − gₜ)] / (1+ke)¹⁰
```

With `g = 0`, `ke = 0.1549`, `gₜ = 0.03`:

```
Explicit 10 years    =  22.2B
Terminal value (PV)  =   8.8B
Equity value         =  31.06B

Fair value = 31.06B / 119,277,493 = $260.44
```

### Result

| | |
|---|---:|
| Fair value | **$260.44** |
| Margin of safety | **+68.8%** |
| Confidence | 0.4243 |

Confidence = `0.75 (base) × 0.80 (stability) ÷ √2` — the √2 damps two
cash-flow models emitting at once, so a single methodology cannot dominate the
consensus.

---

## 5. FCFF — Free Cash Flow to the Firm

### Cash flow

```
FCFF = EBIT(1 − t) + D&A + CapEx − ΔWC
     = 12,592M × (1 − 0.23617) + 8,762M + (−12,112M) − (−314M)
     = 9,618M + 8,762M − 12,112M + 314M
     = 6,582M
```

### Cost of debt

```
kd = interest expense / total debt
   = 5,070M / 96,710M
   = 5.242%                    (within the [2%, 15%] clamp)
```

### WACC

```
E = market cap  = 20,792M      E/V = 0.17695
D = total debt  = 96,710M      D/V = 0.82305
V = E + D       = 117,502M

WACC = (E/V)·ke + (D/V)·kd·(1 − t)
     = 0.17695 × 0.1549  +  0.82305 × 0.05242 × (1 − 0.23617)
     = 0.02741 + 0.03296
     = 6.036%
```

> `MIN_COST_OF_EQUITY` also floors WACC at 6%. The result landed at 6.036% —
> **four basis points above the clamp.**

### Discounting and equity bridge

```
Enterprise value = Σ(t=1..10) FCFF / (1+WACC)ᵗ  +  terminal PV
                 = 48.4B + 124.3B
                 = 172.60B

Equity value = EV − net debt = 172.60B − 96.20B = 76.40B

Fair value = 76.40B / 119,277,493 = $640.48
```

### Result

| | |
|---|---:|
| Fair value | **$640.48** |
| Margin of safety | **+315.2%** |
| Confidence | 0.4525 |

Confidence = `0.80 (base) × 0.80 (stability) ÷ √2`.

---

## 6. Verification

The reconstruction is self-consistent, which confirms the figures above are the
ones actually used:

- Solving the FCFE present value back for the discount rate → **ke = 0.1549**
- Solving FCFF's present value for WACC (0.060363), then inverting the WACC
  formula for the equity cost → **ke = 0.1549**

Two independent paths agreeing to four decimals.

---

## 7. Findings

### The two models disagree by 2.5×

FCFE says $260. FCFF says $640. Same company, same period, same underlying cash
generation. When inputs are consistent these should broadly agree, so the gap is
diagnostic rather than informative.

### WACC contains a backwards feedback loop

Charter's equity is only **17.7% of its capital structure**, because the stock
fell 55.6% over the trailing year. That collapse pulls WACC down toward the
after-tax cost of debt:

| Rate | Value |
|---|---:|
| Cost of equity | 15.49% |
| After-tax cost of debt | 4.01% |
| **Blended WACC** | **6.04%** |

A lower discount rate produces a higher valuation — so **the further the equity
falls, the more valuable this model says the equity is.** Market capitalisation
is an input to the discount rate that is then used to value that same equity.

### Terminal value dominates FCFF

At a 6.04% discount against 3% terminal growth, the spread is 3.04% and the
terminal multiple is **33.9×**.

| Model | Explicit 10y | Terminal | Terminal share | Terminal multiple |
|---|---:|---:|---:|---:|
| FCFE | 22.2B | 8.8B | 28% | 8.2× |
| FCFF | 48.4B | 124.3B | **72%** | **33.9×** |

Nearly three quarters of FCFF's answer is an assumption about 2036.

### Leverage amplifies every error

Equity is 44% of enterprise value, so errors in EV are magnified on the way down
to per-share value:

| EV error | Equity impact | Fair value |
|---|---:|---:|
| −10% | −22.6% | $496 |
| baseline | — | $640 |
| +10% | +22.6% | $785 |

### Sensitivity to WACC

| WACC | Enterprise value | Equity value | Fair value |
|---:|---:|---:|---:|
| 5.50% | 208.4B | 112.2B | $940 |
| **6.04%** | **172.4B** | **76.2B** | **$639** |
| 7.00% | 132.4B | 36.2B | $303 |
| 8.00% | 107.0B | 10.8B | $90 |

A 96 basis point move in the discount rate more than halves the answer.

---

## 8. Assessment

**FCFE's $260 is the more defensible figure.** It discounts equity cash flow at
the equity cost of capital, its terminal value is a modest 28% of the total, and
it is not exposed to the market-cap feedback loop.

**FCFF's $640 should be treated as an artifact** of discounting a heavily
levered firm at a market-cap-weighted WACC during a period when that market cap
had collapsed.

Standard remedies, none yet applied — each is a modelling decision rather than a
bug fix:

1. Cap the debt weight in WACC (e.g. `D/V ≤ 60%`)
2. Use a target capital structure instead of current market weights
3. Refuse FCFF above a leverage threshold, as is already done for banks and REITs
4. Widen `MIN_DISCOUNT_SPREAD` for the terminal stage, so a 34× terminal
   multiple cannot arise

---

## Appendix — code references

| Element | Location |
|---|---|
| FCFE implementation | `api/valuation.py` · `fcfe_verdict` |
| FCFF implementation | `api/valuation.py` · `fcff_verdict` |
| Two-stage present value | `api/valuation.py` · `_two_stage_pv` |
| Growth derivation, cost of equity | `api/engine.py` · `value_one` |
| TTM rollup (sum flows, snapshot stocks) | `supabase/migrations/20260816000004_create_fundamentals_views.sql` |
