create table if not exists public.valuations (
  ticker            text not null,
  method            text not null,
  fair_value        numeric(18, 4) not null,
  margin_of_safety  numeric(10, 6) not null,
  confidence        numeric(6, 4)  not null,
  -- The close the margin was computed against. Stored so the UI can show how
  -- stale a verdict is, and so margins can be recomputed against a live quote
  -- without re-running the (slow) fair value calculation.
  price_at_calc     numeric(14, 4) not null,
  computed_at       timestamptz not null default now(),
  primary key (ticker, method)
);

create index if not exists valuations_ticker_idx
  on public.valuations (ticker);

comment on table public.valuations is
  'One row per ticker per valuation model that produced a verdict. A model that REFUSED to value a ticker has no row here: absence is a deliberate signal (a non-payer gets no DDM row, a bank gets no FCFE row, a loss-maker gets no Graham row) and must never be stored as a zero fair value. Recomputed wholesale by POST /backfill/valuations; the compute is ~0.1s for the whole universe, so the cost is entirely the bulk read that feeds it.';
