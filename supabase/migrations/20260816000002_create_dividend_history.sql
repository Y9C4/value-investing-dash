create table if not exists public.dividend_history (
  ticker      text not null,
  ex_date     date not null,
  amount      numeric(14, 6) not null,
  created_at  timestamptz not null default now(),
  primary key (ticker, ex_date)
);

create index if not exists dividend_history_ticker_idx
  on public.dividend_history (ticker);

comment on table public.dividend_history is
  'Per-share cash dividends by ex-dividend date, from yfinance .dividends. Feeds DDM growth estimation. Absence of rows for a ticker is meaningful — it identifies a non-payer, which must produce NO DDM verdict rather than a zero fair value. Dividends are immutable once paid, so upserts use ignore_duplicates=true.';
