"""The valuation-signal backtest. Plan: python-api/notebooks/backtests.md.

Stage 0 (`load`) pulls a frozen dataset into the local database's `backtest`
schema; `pit` is the only sanctioned way to read it back, because it is where
the point-in-time rules are enforced. Nothing here is imported by the service.
"""
