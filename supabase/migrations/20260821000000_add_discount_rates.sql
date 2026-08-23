-- The discount rates each valuation actually used, stored per ticker.
--
-- Previously these existed only as locals inside `engine.value_one` and
-- `valuation.fcff_verdict` and were discarded once a verdict was written, so
-- the UI could describe a WACC but never show the one the model discounted at.
-- CAPM lives here rather than in `valuations`: it produces a cost of equity,
-- not an intrinsic value per share, and listing it as a fair-value model is
-- what left a permanently empty "CAPM" row on every stock page.
--
-- Nullable throughout. A ticker whose fundamentals are too thin for a WACC
-- still has a cost of equity, and a ticker with no factor regression still has
-- the CAPM fallback.

alter table public.ticker_statistics
  add column if not exists cost_of_equity        numeric(10, 6),
  -- Which model produced cost_of_equity: 'ff5', 'ff3' or 'capm'. Load-bearing
  -- for the panel, because the three use incomparable equity risk premia and a
  -- reader comparing two companies needs to know they were priced differently.
  add column if not exists cost_of_equity_source text,
  -- The CAPM figure regardless of which source won, so the panel can show the
  -- textbook number beside the one that was used.
  add column if not exists capm_cost_of_equity   numeric(10, 6),
  add column if not exists wacc                  numeric(10, 6),
  add column if not exists cost_of_debt          numeric(10, 6),
  -- E / (E + max(net debt, 0)), after the MAX_DEBT_WEIGHT cap.
  add column if not exists equity_weight         numeric(10, 6),
  add column if not exists tax_rate              numeric(10, 6);

comment on column public.ticker_statistics.cost_of_equity is
  'The discount rate the equity models (FCFE, DDM, RIM) actually used, as a decimal. Sourced from the FF5 regression where it ran, FF3 next, CAPM as the fallback -- see cost_of_equity_source.';

comment on column public.ticker_statistics.wacc is
  'The blended rate FCFF discounted at, as a decimal. Null where the company had too little on file to build a capital structure. Bounded by MIN_WACC/MAX_WACC in api/valuation.py -- deliberately NOT the cost-of-equity bounds, which would floor a levered firm''s WACC at its own ke.';
