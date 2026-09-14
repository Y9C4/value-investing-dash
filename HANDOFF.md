# Handoff — deploy readiness

**As of 2026-09-09. Branch `master`, clean at `b78f5d6`.**

Margin is three services: a Next.js 16 dashboard (Vercel), a FastAPI solver
(Cloud Run, `margin-solver`), and Supabase Postgres. The long-form architecture
write-up is `docs/deploy-runbook.md` § "The API end to end"; this file is only
what changed recently and what is still open.

---

## Where things stand

| | |
|---|---|
| `pnpm build` | passes, 16 routes |
| `pnpm lint`, `tsc --noEmit` | clean |
| Cloud Run | `margin-solver-00007-mt8`, healthy, scale-to-zero |
| Scheduler | all three jobs firing; `margin-daily` last ran 09-08 22:32 UTC |
| Snapshots | universe + frontier current to the 09-08 close |
| Vercel | **not deployed yet** — the bundle-size failure below was the blocker |

---

## What happened this session

### The build was broken and would have failed on Vercel

`pnpm build` failed with 15 TypeScript errors, all on
`FrontierResponse.market`, which is optional by design — absent when the index
has no usable price history for the window. Two were live bugs, not type noise:

- **`portfolio-builder.tsx` guarded one level too deep.** It tested
  `data.market.sharpe === undefined`, which dereferences `data.market` in order
  to ask whether it exists. An absent index threw rather than degrading. The
  "vs S&P" hints now drop out entirely when there is no index — a comparison
  with nothing behind it is a fabricated one, not a zero.
- **`portfolio-list.tsx` had four `<td>` outside any row**, sitting after
  `</TableBody>` as direct children of `<Table>`, which the browser hoists out
  of the table. Rebuilt as a real `<TableFooter>`: the index is what the column
  above is measured against, not another portfolio you can select, and `tfoot`
  is the part of a table that stays put when the body scrolls.

Row tone classes were also interpolated (`` text-${cond ? "a" : "b"} ``), which
Tailwind cannot match — they rendered only because the same literals appear in
`portfolio-builder.tsx`. Written out whole so the colours no longer depend on
another file. Committed as `9a1db69`.

### Vercel rejected the deploy over Python

```
Error: Total bundle size (508.69 MB) exceeds the maximum function size (500 MB)
```

Vercel treats a top-level `api/` directory as its serverless-functions
directory regardless of language. It found `api/requirements.txt`, decided you
wanted Python functions, and bundled cvxpy + numpy + scipy + pandas. Nothing
asked for that — the directory name alone triggered it.

**You do not need Python on Vercel.** The solver runs on Cloud Run; Vercel only
talks to it over HTTPS via `MARKET_DATA_API_URL`.

The `vercel.json` attempt did not work and it is worth knowing why:
`{"functions": {"api/**": {"excludeFiles": ["**/*"]}}}` prunes files *from* a
function's bundle but does not stop the function being created, so the Python
runtime still installed. The fix was renaming `api/` → `python-api/` so the
convention never fires (`58e1dba`), plus the import path and eslint ignore that
followed it (`32c1737`). `vercel.json` was deleted; none is needed.

### Data repairs

Ran the daily backfill against the deployed solver (same path Cloud Scheduler
uses) and then a full price refetch: **505/505 tickers, 251,276 rows, zero
failures**.

That was chasing a real bug. `^IRX` — the 13-week T-bill behind your risk-free
rate — had been frozen at 2026-08-14 for three weeks while every equity stayed
current. The trap is structural: the incremental window anchors to the
**global** newest stored date, so once one ticker falls behind, the days it
missed sit outside every future window permanently.
`_needing_full_history()` cannot see it either, because `^IRX` did trade on the
earliest stored date and so reads as fully tracked.

Rate corrected **3.6921% → 3.6707%**. Small, as a 252-day average should be,
but now computed over a complete window.

**This has since regressed — see open items.**

### Backfill token rotated

I leaked the old `BACKFILL_TOKEN` into the session transcript by dumping
`httpTarget.headers` from the Scheduler config. Rotated: new Secret Manager
version, revision `00007-mt8`, both token-carrying Scheduler jobs, and both
local `.env` files. Verified — old token 401, new token 200.

---

## Key decisions

**Vercel never runs Python.** Enforced by directory name rather than config,
because the `api/` convention has no off switch that a `vercel.json` can reach.

**Two of three pages render with the solver scaled to zero.** `/screener` and
`/stocks/[ticker]` read Supabase directly; only `/portfolio` needs Cloud Run,
and only for non-default requests. Verified the anon `daily_close_prices`
policy is live, so this genuinely holds.

**An absent index degrades rather than throws.** Everywhere `market` is
optional, the comparison is dropped instead of computed against a zero.

**`/` still redirects to `/screener`.** The plan called for a landing page; the
code documents the reversal deliberately. Left alone.

**Snapshot resolution.** `ENVELOPE_POINTS = 10` yields 9 stored points — one QP
in the sweep returns `None` and is dropped at `python-api/frontier.py:516`. The
count reported is the true count, so this is honest, not a bug.

---

## Open items

### 1. `^IRX` regressed — this is the real one

Stuck at **09-04** while AAPL is at **09-08**. Yahoo *has* the data (verified
directly; 09-07 was Labor Day, so the 09-04→09-08 gap is correct), so this is
our fetch dropping it, not a source gap. `daily_close_prices` is back to
`partial`.

My fix last session repaired the *data*; it did not fix the *code*. The failure
is `^IRX: 'Close'` — a `KeyError` in `_close_rows()` at
`python-api/backfill.py:111`, meaning the per-ticker sub-frame came back without
a `Close` column. I could not reproduce it in a 50-ticker batch by hand, so it
is intermittent or specific to the incremental window shape.

Still recoverable right now: the window start (newest − 5 days = 09-03) still
covers 09-04. **In a few days it will not be**, and you will need another full
refetch. Two things worth fixing:

- The `KeyError` itself, so `^IRX` stops failing.
- The structural trap — anchor the incremental window per-ticker, or have
  `_needing_full_history()` catch a ticker whose own newest date lags the
  global one. Without this, any ticker that ever fails is permanently gapped.

### 2. Stale `api/` paths in the docs

The reorg left `docs/deploy-runbook.md` and `docs/deploy-readiness-plan.md`
pointing at `api/`. Most of it is prose, but three of them are commands that
will now fail:

```
gcloud run deploy margin-solver --source api/     # → --source python-api/
```

runbook lines 109, 616, 716. Also `api/.env` → `python-api/.env` throughout,
and `.claude/skills/test-portfolio-optimizer/SKILL.md` line 3.

### 3. Vercel deploy itself

Env vars needed: `MARKET_DATA_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `MARGIN_ORIGIN_SECRET` (must equal
Secret Manager `margin-origin`). Leave `ENABLE_DATA_PAGE` and `BACKFILL_TOKEN`
**unset** — that is what 404s `/data` and all six backfill proxies in
production. The service role key must never reach Vercel.

### 4. After the deploy

- `ALLOWED_ORIGINS` on Cloud Run is still `http://localhost:3000`. Harmless —
  the browser never calls Cloud Run and server-to-server fetch ignores CORS —
  but close it once you have the domain.
- The $5 GCP budget alert (Billing → Budgets & alerts) is still a manual step.
  Google has no hard spend cap; the alert is a tripwire, the app-level limits
  are the actual defence.

### 5. Minor, non-blocking

- `clear_price_cache()` clears the price cache but not `_risk_free_rate`, which
  keeps its own 15-minute TTL despite being derived from those same prices. It
  self-heals; stage ordering makes it harmless in the daily job. It is why a
  price backfill needs a wait before recomputing snapshots.
- `valuations` will always report `partial`: `^IRX` is in the valuation request
  list, so an index gets asked for an earnings-based fair value and correctly
  refuses. The freshness badge therefore never reads fully green. The other
  refusals (TSLA, INTC, COIN, CRWD, DDOG, MRNA, AZO, plus two delisted tickers)
  are the models declining rather than guessing — intended behaviour.

---

## Corrections to things I reported earlier

Two of my own claims last session were wrong, and both could mislead:

- I said **`maxDuration` is 300** across the backfill routes. I had checked only
  `valuations/route.ts` and generalised. Three others were still at `800`, above
  Vercel Hobby's ceiling. You caught and fixed them in `b78f5d6`; all seven read
  300 now.
- I said `^IRX` was **"fixed at the source"**. I had repaired the data, not the
  fetch. It has regressed, and it is open item 1 above.

---

## Working notes

- Both dev servers are expected to already be running on `:3000` and `:8000` —
  attach, do not start or kill them. `:8000` was down for most of last session,
  so backfills went against the deployed solver instead.
- Prefer `pnpm lint` plus the running dev server over a full build per change.
- Never print `.env` or `python-api/.env`. Mask with
  `sed 's/\(=\).\+/\1<set>/'`. **Do not dump `httpTarget.headers` from
  `gcloud scheduler jobs describe`** — that is how the token leaked.
- The database is live and shared with the running dev services.
