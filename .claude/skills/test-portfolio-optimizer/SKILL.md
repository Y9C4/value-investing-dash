---
name: test-portfolio-optimizer
description: Test the portfolio optimiser (efficient frontier / tangency portfolio) across many screened stock sets, via HTTP and a real headless browser. Use when changing api/main.py's frontier code, components/efficient-frontier.tsx, or the backfills that feed them — and whenever someone reports the optimiser failing, erroring, hanging, or showing "page not working".
---

Sweeps `POST /efficient-frontier` and the `/portfolio` page across many
screened-set sizes and shapes, checks the frontier's structural invariants,
and bisects any failing ticker list down to a minimal reproducer.

## Why a sweep and not a few test cases

The optimiser's failures were never uniform. They depended on **how many**
stocks were handed over and on **what those stocks looked like** — and the two
interact:

- A per-stock weight cap `c` with `sum(w) == 1` is infeasible unless
  `c * n >= 1`. A 3% cap silently requires 34 holdings, so any smaller screened
  set had no feasible portfolio at all.
- `max_sharpe` is infeasible when no allowed portfolio out-earns the risk-free
  rate. A value screen selects on cheapness, which selects weak trailing
  returns — so the intended input was the failing input.

Random ticker samples pass both of those. That is why `buildCases` generates
**tilts** (`worst-return`, `cheapest-pe`, `most-volatile`, `best-return`,
per-sector) and not just sizes, and why a green sweep means something.

## Run

Both servers must already be up (`pnpm dev` on :3000, `uvicorn` on :8000).

```bash
node .claude/skills/test-portfolio-optimizer/sweep.mjs --quick          # ~1 min, 12 cases
node .claude/skills/test-portfolio-optimizer/sweep.mjs                  # full matrix, ~5 min
node .claude/skills/test-portfolio-optimizer/sweep.mjs --mode api       # HTTP only, no browser
node .claude/skills/test-portfolio-optimizer/sweep.mjs --mode ui        # browser only
node .claude/skills/test-portfolio-optimizer/sweep.mjs --cases 100 --seed 3
node .claude/skills/test-portfolio-optimizer/sweep.mjs --soak 600            # connection-age failures
```

| flag | meaning |
|---|---|
| `--mode api\|ui\|both` | default `both` |
| `--cases N` | cap the number of cases (default 60, or 12 with `--quick`) |
| `--seed N` | seeds the deterministic PRNG, so a failing sweep replays exactly |
| `--quick` | fewer sizes and tilts |
| `--soak N` | after the matrix, repeat one ordinary request `N` times (default 0 = skip) |
| `--concurrency N` | parallel requests during the soak (default 6) |

Env: `WEB_URL` (default `http://localhost:3000`), `API_URL` (default
`http://127.0.0.1:8000`). The API sweep deliberately goes **through the Next
route**, not straight to FastAPI, so the proxy layer is covered too.

## Reading the output

Three outcomes, and only one of them is a failure:

- `pass` — solved, and every invariant held.
- `decl` — **refused with a reason** (HTTP 422 carrying a `detail`). Correct
  behaviour: "only 4 of your 5 tickers have enough price history" is a real
  answer to a real request. Does not fail the sweep.
- `FAIL` — a 5xx, an unreadable body, a broken invariant, or a page that died.
  The API sweep then bisects the ticker list and prints the smallest set that
  still reproduces it.

Invariants checked on every solved frontier (`checkInvariants`):

- returns increase monotonically along the envelope
- every point is finite, volatility non-negative
- the tangency portfolio is at least as good as every plotted point — otherwise
  the capital market line visibly cuts through the curve it should touch
- weights sum to 1 and none exceeds the reported cap
- the CML is present exactly when `tangency_beats_risk_free` is true

The UI sweep additionally asserts no page errors, that a chart rendered, and
that when a solve is refused the stale chart is **disclaimed** — otherwise a
red error line sits directly above a perfectly plausible curve, and the curve
is the thing people believe.

Two further browser phases run in `ui`/`both` mode: `runHandoffCheck` (the
screener's own link) and `runControlsCheck` (the optimiser's exposed
constraints). Both are described below.

## Why there is a soak as well as a matrix

The matrix varies **what** is asked. The soak varies **how many times**, and it
exists because one entire class of failure had nothing to do with the request.

The Supabase client holds a single pooled HTTP/2 connection, and PostgREST
retires it with GOAWAY after a few hundred streams. Whichever request was in
flight at that moment died with `RemoteProtocolError` and a 500. Every case in
the matrix passed the whole time this was happening, because each case is a
handful of requests against a young connection — only volume surfaces it.

It is worth knowing how this was reported, because the shape recurs: *"19
stocks works, 20 or more always fails, no matter which 20."* There was no
threshold. The nineteen-stock run landed on a young connection and the
twenty-stock runs landed on an old one, so connection age looked exactly like
an arithmetic limit in the optimiser. **When a bug is described as a clean
threshold that the matrix cannot reproduce, soak before you believe the
threshold.**

Roughly 400 requests crosses the boundary from a cold start; `--soak 600`
leaves margin.

## The screener handoff is checked separately

The API and UI phases both build their own URLs, so neither exercised the link
the screener actually renders. That link was where the worst bug lived.

It used to be `?tickers=A,AAPL,ABBV,…`, which for a screen passing most of the
index is ~3KB. Next echoes the URL into the request line, the `Next-Url` header
**and** `Referer`, so 3KB of query string spends ~9.2KB of Node's 16KB header
budget (`--max-http-header-size`). Cookies and ordinary browser headers pushed
it past the limit and the dev server answered **431 Request Header Fields Too
Large** — which Chrome surfaces as `net::ERR_HTTP_RESPONSE_CODE_FAILURE` and a
dead page.

The set now travels as a fixed-size bitmask over the index (`lib/ticker-set.ts`),
so the link is ~110 bytes whether it carries one stock or all 503.

`runHandoffCheck` asserts the href stays under `HANDOFF_BUDGET_BYTES` and that
clicking it hands over the number of stocks the label promised. **The budget
check matters more than the click**: whether the click succeeds depends on how
many cookies the reader happens to be carrying, which is why this reproduced
for them and not in a clean headless browser. Do not replace it with "we
clicked it and it worked."

### The same bug, one layer down

Fixing the link did not fix the fetch. The page URL became a 110-byte token,
but the request that page then makes still spelled out every ticker, so
`POST /api/efficient-frontier?…` was a ~3KB URL — and a URL is a header. At
13KB of cookies on localhost the fetch answered 431 before reaching the
optimiser, and the page reported it as *the optimiser* failing:

| cookies | request URL | result |
|---|---|---|
| 12KB | 2999B | 200 |
| 13KB | 2999B | **431** |
| 13KB | 88B (after) | 200 |

The ticker list travels in the **POST body** now, and `runHandoffCheck` also
asserts the outgoing solve request stays under `REQUEST_BUDGET_BYTES`. That
check lives in the handoff phase rather than in `runControlsCheck` because only
the screener's full set reaches the worst case — a 19-stock subset is nowhere
near the limit and would pass a broken build.

**The lesson worth carrying: a URL is a header.** Anything unbounded — a ticker
list, a set of ids, a filter — belongs in a POST body, and the guard against it
drifting back is a size assertion, not a working click. When this regressed the
size check failed while the request still returned 200; only the reader with
enough cookies would have seen the 431.

## The exposed constraints are checked separately too

`/portfolio` lets the reader set the position bounds, the L2 penalty γ and the
number of frontier points. Neither of the other phases touches those controls —
the API sweep builds its own query strings and the UI sweep only clicks Run at
the defaults — so without `runControlsCheck` a control could stop reaching the
solver and every phase would still be green.

That is a worse failure than a broken page. A position-size box that silently
does nothing leaves the reader believing the portfolio was built the way the
form says it was.

Every assertion is on the **solved weights**, not on the outgoing request:

| control | what is asserted |
|---|---|
| Maximum position | no weight exceeds it, *and* the response echoes the cap |
| Minimum position | no weight below it, and every name is held |
| Negative minimum | short positions appear and respect the floor |
| γ | the solver echoes it back |
| Infeasible cap | 422 whose message names the threshold to raise it to |
| Invalid field | the Run button is disabled before anything is sent |

Two of those are deliberately paranoid. The echoed cap is checked alongside the
weights because the *automatic* cap for a 19-stock universe is ~7.9%: a solve
that ignored the bounds entirely still lands under an 8% ceiling, so the weight
check on its own passes a broken build. And γ is only checked for arrival,
because its effect on the tangency portfolio is genuinely small — see below.

**γ does not visibly change the max-Sharpe portfolio, and that is correct.**
The frontier is traced by minimising variance at a target return, so at the
tangency the return constraint is doing the binding and the penalty has little
room left. Its effect is large at the minimum-volatility end, where nothing
competes with it: over one 19-stock set, effective holdings there went 10.6 →
19.0 as γ went 0 → 5 while the tangency moved 6.8 → 7.2. Do not "fix" a γ
control that looks inert against the max-Sharpe row; look at the min-volatility
row instead.

## Gotchas

- **Run from the repo root.** `node .claude/skills/...` resolves relative to
  the current directory; from `api/` it will not find the script.
- **A cold price cache costs ~40s on the first wide case.** The service caches
  close series per ticker for 15 minutes, so a second sweep is much faster.
  A sweep straight after restarting `uvicorn` will look slow — that is the
  cache, not the solver.
- **`worst-return/5`-style cases declining is expected.** A handful of genuine
  recent spin-offs (currently `HONA`, `SNDK`, `Q`, `FDXF`) have under 90% of
  the price window and are excluded from risk modelling, which can push a
  5-ticker selection below the 5-stock minimum. That is the optimiser being
  honest, not the backfill being broken — see the root `readme.md`.
- **Do not "fix" a negative tangency Sharpe.** Over a set where nothing beats
  the T-bill, the best available Sharpe is negative and the CML is withheld on
  purpose. The sweep asserts this.
- **A stale `?set=` token is refused, not approximated.** The token carries a
  fingerprint of the ticker universe it was built against, because bit
  positions shift when a constituent is added or removed — an old shared link
  would otherwise decode into a *different* portfolio and plot it without
  complaint. `?tickers=` is still honoured for short, hand-built URLs.
- **Reads are retried, writes are not.** `_supabase_read` in `api/main.py`
  wraps every read in the request path, because re-running a read has no side
  effects. Do not extend it over an upsert or a delete without thinking about
  what a repeated write does.
- **After changing the backfills, re-run the sweep.** The optimiser reads
  whatever the price table holds; a half-populated table produces failures that
  look like solver bugs.
