# Simplifying the valuation layer

A plan to cut the valuation engine down to models that earn their place, fix the
WACC inputs, and make the discount rate visible.

- **Status:** implemented and live on branch `simplify-valuation-models`, not
  yet committed. Migration applied; `POST /backfill/valuations` run — 495 of 504
  tickers valued, 3.08 verdicts each, every sector at 100% coverage.
- **Written:** 2026-08-20
- **Companion:** [`valuation-audit-chtr.md`](./valuation-audit-chtr.md) — the
  end-to-end CHTR trace that prompted most of this

---

## Context

The engine runs nine advertised models (eight can actually fire) whose inputs do
not justify their complexity. Three problems compound:

**1. Irrelevant models dominate the consensus.** FF3/FF5 emit a "fair value" by
mapping annualised regression alpha to an implied price — asset pricing wearing a
valuation costume. Graham is a 1930s screen almost nothing clears. EPV is a floor,
not an estimate. Together they drag every consensus bearish, which is why
`lib/valuation.ts:273-279` has to centre its bands at −36% and ends up labelling a
stock priced 5% *above* its fair value as "deep value".

**2. CAPM is advertised but silent.** `api/engine.py:124` computes `capm_ke` only
as a fallback discount rate. No `capm` row is ever written, so the row reads "Does
not apply" on every stock while the UI claims "nine models". CAPM is a
cost-of-equity method, not a fair-value method — it belongs in a discount-rate
panel, not the verdict table.

**3. WACC is computed from inconsistent inputs.** Four separate discrepancies,
detailed in §2. The equity weight is built on a stale market cap that disagrees
with the price everything else is measured against by 13%.

There is also a conspicuous **absence**: no comparables model at all. Comps and
DCF are the two legs every real valuation stands on, and the data to build one
(`ttm_ebitda`, `net_debt`, `shares_outstanding`, `sector`) is already ingested.

**Outcome:** five fair-value models that each say something distinct, a visible
and correct discount-rate panel, and bands that mean what they say.

---

## Decisions taken

| | Models |
|---|---|
| **Fair-value models kept** | FCFE, FCFF, DDM, RIM, **COMPS** (new) |
| **Promoted to a discount-rate panel** | CAPM, FF5, WACC |
| **Dropped** | FF3/FF5 verdicts, Graham, EPV |

The FF5 *regression* stays — it supplies the cost of equity, which is its real
job. Only its fair-value verdict goes. RIM stays because it is the only model
with no sector exclusion; without it every financial and REIT goes unrated.

---

## 1. Cull the models

**`api/valuation.py`** — delete `factor_verdict` (:200-220), `graham_verdict`
(:409-427), `epv_verdict` (:430-477). Keep `factor_regression` and
`factor_cost_of_equity`. Delete the now-unused constants `MAX_ALPHA`,
`MAX_FACTOR_CONFIDENCE`, `MIN_REGRESSION_R2`.

**`api/engine.py`** — remove the `factor_verdict` calls (:113-120), the
`graham_verdict` call (:215-217), and the `epv_verdict` call (:219-233). Keep the
`ff3`/`ff5` regressions feeding `cost_of_equity` (:108-136).

**`lib/valuation.ts:16-170`** — `MethodId` becomes
`"fcfe" | "fcff" | "ddm" | "rim" | "comps"`. Remove the CAPM, FF3, FF5, Graham
and EPV entries from `VALUATION_METHODS`.

**Follow the type.** `MethodId` is the spine — narrowing it surfaces every
consumer at compile time: `components/screener-filters.tsx` (:264, :338-374),
`components/screener-table.tsx` (:30, :165), `components/screener.tsx`
(:141-142), `components/valuation-breakdown.tsx`, `lib/universe.ts:41-51`.

**Hardcoded counts to fix:** `components/screener-rationale.tsx:28` ("Nine
valuation models") and `app/data/page.tsx:46` ("all nine models"). Derive from
`VALUATION_METHODS.length` rather than restating it.

**`lib/sample-universe.ts`** — the offline fixture carries `capm` verdicts that
will no longer typecheck. Regenerate against the new method set. Note separately
that `app/stocks/[ticker]/page.tsx` renders this fabricated data with **no
"sample data" warning**, unlike `components/screener.tsx:60-61` — worth fixing
while here.

---

## 2. Fix WACC

All four live in `api/valuation.py:374-386`, the only WACC in the codebase.

### a. The equity weight uses a stale, mismatched market cap

`equity_mv` comes from `company_profile.market_cap` — a yfinance snapshot written
by a *different* backfill than the price table. Every other figure in the model,
including the `price` the margin of safety is measured against, comes from
`latest_close_prices` and `ttm_fundamentals.shares_outstanding`.

In the CHTR audit these disagree by 13%:

| Source | Value |
|---|---:|
| `company_profile.market_cap` | $20,792M |
| price × shares ($154.27 × 119,277,493) | **$18,401M** |

The audit's `E/V` of 0.17695 is built on the wrong one.

→ Compute `equity_mv = price * shares` inside `fcff_verdict`, consistent with
every other input. Keep `market_cap` only as a fallback when shares are missing.

### b. WACC is clamped to cost-of-equity bounds

Line 386 clamps into `[MIN_COST_OF_EQUITY, MAX_COST_OF_EQUITY]` = [6%, 20%] —
limits defined at :29-33 explicitly for k<sub>e</sub>. A levered firm's WACC
legitimately sits *below* its cost of equity, so the floor bites constantly. CHTR
landed at 6.036%: four basis points from having its discount rate silently
replaced by a constant meant for a different quantity.

→ Add `MIN_WACC` / `MAX_WACC` (suggest 3% / 20%) and clamp against those.

### c. Gross debt in the weights, net debt in the bridge

Line 382 weights with `total_debt`; line 398 bridges with `net_debt`. Minor for
CHTR, severe for cash-rich names: gross debt inflates the debt weight (lowering
WACC, raising EV) and then the bridge adds the same cash back — the cash benefit
is counted twice.

→ Use one definition on both sides. Recommend `net_debt` for both, floored at 0
for the weight so net-cash companies get a 100% equity weight rather than a
negative one.

### d. The market-cap feedback loop

The audit's own finding (`valuation-audit-chtr.md:219-233`): a falling price
lowers the equity weight, pulling WACC toward the cheap after-tax cost of debt,
which *raises* the valuation. The model says the equity is worth more the further
it falls.

→ Cap the debt weight at `D/V ≤ 0.60`. This is a modelling judgement, not a bug
fix, and should be stated as such in the FCFF blurb.

### Also worth checking while in this function

Line 370 adds `capex` (correct — yfinance stores it negative as-reported) but
*subtracts* `change_in_working_capital`, which comes from the same cash-flow
statement under the same sign convention. For CHTR, ΔWC of −314M *added* 314M to
FCFF. Verify against a company with a large known working-capital swing before
changing it — the convention is genuinely ambiguous in yfinance, so this should
not be flipped on inference alone.

---

## 3. New: comps model

`comps_verdict` in `api/valuation.py`, following the existing contract exactly —
a pure function returning a verdict dict or `None`, refusing rather than guessing.

- Sector-median **EV/EBITDA** and **P/E**, computed across the universe.
- Requires a two-pass structure in `engine.compute_universe`: pass one collects
  per-ticker EV/EBITDA and EPS by sector, pass two values each ticker against its
  sector's median. `value_one` sees one ticker at a time, so the medians must be
  computed in `compute_universe` (`api/engine.py:249-345`) and passed down.
- Refuses when: EBITDA ≤ 0, EPS ≤ 0, the sector has fewer than ~5 usable peers,
  `quarters_used < 4`, or the sector is missing.
- Fair value = mean of the two implied per-share values where both exist.

Register it in `lib/valuation.ts` with a `refusesWhen` list mirroring those
guards, matching how the other entries are written.

---

## 4. Discount-rate panel

Replaces CAPM/FF5/WACC as verdict rows.

**Persist the rates.** `ticker_statistics` is the right home — already one row per
ticker, already upserted by this same backfill, and deliberately kept out of
`company_profile` because that table is overwritten wholesale. New migration
adding nullable columns: `cost_of_equity`, `cost_of_equity_source`
(`'ff5' | 'ff3' | 'capm'`), `capm_cost_of_equity`, `wacc`, `cost_of_debt`,
`equity_weight`, `tax_rate`.

`value_one` already computes all of these and currently discards them. Return
them alongside the verdicts and write them in `compute_universe`
(`api/engine.py:311-321`, where `stats` rows are already assembled).

**Surface them.** A new `components/discount-rate-panel.tsx` on the stock detail
page showing rf, beta, CAPM k<sub>e</sub>, FF5 k<sub>e</sub>, which one was used,
k<sub>d</sub>, tax rate, E/V and D/V, and the resulting WACC — with the formula
beside each. This is the panel a finance reader actually wants to interrogate,
and it is where CAPM belongs.

Extend `GET /valuations` (`api/main.py:681-763`) to pass the new columns through;
it already reads `ticker_statistics` at :706-711.

---

## 5. Confidence, "Signal", and the bands

### "Signal" — delete the column

`components/valuation-breakdown.tsx:72` is a header over a `<MarginBar>`
(:118-120) rendering the *same* `marginOfSafety` shown as a number in the column
immediately to its left. No information.

### Confidence — keep the weight, drop the pretence

It is load-bearing: it is the weight in `consensusMarginOfSafety`
(`lib/valuation.ts:221-235`), which drives the screener's sort, filter and bands.
But it carries **no per-stock information** — `api/engine.py:169` hardcodes
`stability = 0.8`, so the numbers are constants across the entire index:

| Model | Confidence | Varies by stock? |
|---|---:|---|
| FCFE | 0.75 × 0.8 = 0.60 | no |
| FCFF | 0.80 × 0.8 = 0.64 | no |
| EPV | 0.35 × 0.8 = 0.28 | no |
| RIM | 0.35 × 1.0 = 0.35 | no |

The `_stability` function (`api/valuation.py:105-121`) is real, but is only ever
used for dividends.

→ Relabel the column **"Weight"**, keep the per-model constants as explicitly
declared weights, and delete the hardcoded `stability` multiplier rather than
letting it imply a measurement that never happens. With EPV gone, reconsider
whether `damp_cashflow_confidence` (:515-530) earns its keep over just FCFE/FCFF.

### Bands — re-centre on zero

The −36% skew exists only to compensate for the models being removed;
`lib/valuation.ts:258-272` says so outright. Once EPV and Graham are gone the
compensation is actively wrong.

| Band | Now | Proposed |
|---|---:|---:|
| deep-value | ≥ −0.05 | ≥ +0.25 |
| undervalued | ≥ −0.22 | ≥ +0.10 |
| fair | > −0.40 | > −0.10 |
| overvalued | > −0.50 | > −0.25 |
| expensive | ≤ −0.50 | ≤ −0.25 |

**Confirm against the real distribution** after the first backfill rather than
shipping the round numbers blind.

### Related, cheap

`api/valuation.py:93` discards any verdict where `fair > price * 10`. That
censors only the most *undervalued* results, biasing every consensus downward.
Either drop the rule or make it symmetric.

---

## Verification

1. `POST /backfill/valuations` against the dev API on :8000 (already running —
   attach, do not restart). Check the response: `verdicts_per_ticker` should land
   near 3–4, and `tickers_valued` must not fall — RIM and comps have to keep
   financials and REITs rated.
2. Re-run the CHTR trace by hand against the new output. Specifically: `E/V`
   should now be built on ~$18.4B rather than $20.8B, and WACC should no longer
   sit on the 6% floor. **Update `valuation-audit-chtr.md`** — it is the
   project's own audit and goes stale the moment this lands.
3. Spot-check a cash-rich name (AAPL, GOOGL) for fix 2c and a heavily levered one
   (CHTR) for 2d — those are the two cases the current code gets wrong.
4. `pnpm lint && pnpm build`. The `MethodId` narrowing should surface every stale
   consumer as a type error; a clean build is the main signal here.
5. Load the screener and one stock page: no "Does not apply" CAPM row, the
   discount-rate panel populates, band labels look sane against the new
   distribution.

**Ordering:** cull first (§1) and get a clean build — that shrinks the surface
before anything new lands. Then WACC (§2), then confidence and bands (§5), then
the two additive pieces (§3 comps, §4 panel) last.

---

## Open questions

Three items below are recommendations rather than settled decisions:

- **The `D/V ≤ 0.60` cap** (§2d) is one of four possible remedies for the
  feedback loop; the others are a target capital structure, refusing FCFF above a
  leverage threshold, or widening `MIN_DISCOUNT_SPREAD` for the terminal stage.
- **The proposed band cut points** (§5) are round numbers pending a look at the
  real post-cull distribution.
- **The ΔWC sign** (§2) needs empirical confirmation before being touched.


---

## What the data changed after implementation

Two assumptions in this plan turned out to be wrong once the backfill ran.
Recorded here because both are more interesting than the plan they corrected.

### The bands could not be centred on zero

§5 assumed the −36% skew was compensation for EPV, Graham and RIM, and would
disappear once they did. It did not. With those models gone the median consensus
is **−0.335** — essentially unchanged. The skew was never mainly about them:

| model | n | median margin | share negative |
|---|---:|---:|---:|
| comps | 488 | **+0.02** | 48% |
| fcfe | 268 | −0.48 | 76% |
| fcff | 239 | −0.57 | 78% |
| ddm | 137 | −0.65 | 91% |
| rim | 391 | −0.74 | **99%** |

Comps is centred; the cash-flow models are conservative by construction. They
discount at a median cost of equity of 12.08% (median WACC 10.53%) while halving
observed growth and capping it at 6% against a 3% perpetuity. On an absolute
scale that files three fifths of the index under "expensive".

The bands are therefore **quintiles of the real distribution, labelled as
relative** — `BAND_BASIS` in `lib/valuation.ts`, rendered in the filter rail and
on the stock page. Relative bands are defensible; relative bands presented as
absolute were the original sin.

### A dead-code removal was not dead

Dropping `min(0.12, …)` from the growth derivation in `api/engine.py` looked
redundant against `MAX_GROWTH = 0.06`. It was not. `MAX_GROWTH` clamps only the
rate fed into the projection, while the discount-spread guards in `fcfe_verdict`
and `fcff_verdict` deliberately test the rate *before* that clamp, so an absurd
growth estimate refuses rather than being capped into looking reasonable.

89 tickers sit above the ceiling. Removing it cost 25 FCFE and 22 FCFF verdicts
before it was caught and restored.

## Still open

- **RIM votes "expensive" on 99% of the index** — a near-constant, not a signal,
  and the same critique that removed EPV and Graham. Comps covers 98.6% of the
  universe, so dropping RIM would keep every sector rated and move the median to
  −0.21. Undecided.
- **Whether the cash-flow models are too conservative or the market is
  expensive.** Candidates: the factor premia are annualised over the entire
  Fama-French history (1963→) rather than a recent window, and the regression
  mixes two risk-free definitions — its left side subtracts `^IRX/252` while
  `mkt_rf` on the right is defined against Fama-French's own `rf`. The second is
  an outright bug.
- **The ΔWC sign** at `api/valuation.py`, untouched pending a company with a
  large known working-capital swing to settle it.
