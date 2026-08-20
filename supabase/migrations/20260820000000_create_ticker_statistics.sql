-- Per-ticker risk and return statistics over the trailing 252-trading-day
-- window. Computed alongside the valuations run, which already builds the log
-- return series, so this costs nothing extra to produce.
--
-- Kept out of company_profile deliberately: that table is overwritten wholesale
-- by the profile backfill, which does not compute returns and would blank these
-- columns on every refresh.

create table if not exists public.ticker_statistics (
  ticker            text primary key,
  -- Annualised mean daily LOG return (mean x 252). Log rather than simple
  -- return because the daily series is additive in logs, which is what makes
  -- the x252 scaling valid.
  realised_return   numeric(12, 6),
  -- Annualised standard deviation of the same series (sd x sqrt(252)).
  volatility        numeric(12, 6),
  -- Covariance with the index over the window, divided by index variance.
  beta_252          numeric(10, 4),
  -- How many trading days actually backed the numbers above. Below 252 the
  -- window was short and the annualisation is correspondingly noisier.
  observations      integer not null,
  computed_at       timestamptz not null default now()
);

comment on table public.ticker_statistics is
  'Trailing 252-trading-day return and risk statistics, one row per ticker. Written by POST /backfill/valuations. Absence of a row means the ticker had too little price history to measure.';

comment on column public.ticker_statistics.realised_return is
  'Annualised mean daily log return. Realised over the window, not a forecast.';
