# The portfolio page: infrastructure and design

Written 2026-09-05, at the end of the Cloud Run deploy. This is the page that
took the most rework during Phase 2, and most of that rework is invisible from
the screen, so this doc says what the shape is and why it is that shape.

Read alongside [deploy-runbook.md](deploy-runbook.md) (how the service got
there) and [deploy-readiness-plan.md](deploy-readiness-plan.md) (what remains).

---

## 1. What the page is

`/portfolio` is the second half of the screener. The screener narrows the index
to a set; this page asks what the best combination of that set was over the
trailing two years, under constraints the reader controls. It renders one
solved efficient frontier and about six readings of it.

Everything below the toolbar is downstream of **one solve**. That is the single
most important fact for anyone changing this page: there is no second data
source, no per-panel fetch, and no component here that talks to the network.
`PortfolioBuilder` owns the solve; every other component is presentational and
renders whatever `FrontierResponse` it is handed.

---

## 2. Where the numbers come from

### The path

```
browser
  |  POST /api/efficient-frontier?short_allowed=...&n_portfolios=...
  |       body: { tickers: [...] }            <- the list is in the BODY
  v
app/api/efficient-frontier/route.ts   (Next route handler, maxDuration 300)
  |
  |-- default request?  ---- yes --->  Supabase: frontier_snapshot
  |                                    where cache_key = 'default'
  |                                    ~0.24s, no Python involved
  |
  '-- no ------------------------->  Cloud Run: margin-solver
                                     POST /efficient-frontier
                                     header X-Margin-Origin: <secret>
```

The browser never learns the solver's URL and never holds a secret. Both are
server-only, read in `lib/market-data-service.ts`. That is the rule the whole
API surface follows, not a portfolio-specific measure.

### Why the ticker list is in the body

A URL is a header. Spelling out ~500 tickers inline made a ~3KB URL, which Next
echoes into the request line, `Next-Url` *and* `Referer` — about 9.2KB of
Node's 16KB budget. Anyone carrying ordinary cookies got a 431, which a browser
reports as a dead page. Hence two things:

- settings travel in the query string, tickers in the JSON body
  (`buildFrontierRequest` in `lib/portfolio-settings.ts`);
- the screener hands sets over as `?set=<84-char token>` — one bit per index
  constituent, fingerprinted against the universe it was built from, so a stale
  token is refused rather than quietly decoded into a different portfolio
  (`lib/ticker-set.ts`).

`PortfolioBuilder` still special-cases 431 with its own message, because that
error never reaches the optimiser and must not be reported as the optimiser
failing.

### The default fast path

A bare visit to `/portfolio` asks for the full index at default settings. That
is both the most common request and the most expensive solve, and it has
already been answered: the nightly backfill calls `precompute_default()`, which
solves it and upserts **two rows** into `frontier_snapshot`:

| `cache_key` | read by | why |
| --- | --- | --- |
| `sha256(...)` | the solver's own in-process probe | it owns the hashing function |
| `default` | the Next route, straight from Postgres | a stable key TypeScript can name without reproducing canonical JSON and a digest in a second language |

`readDefaultSnapshot()` returns `null` on every failure — unconfigured,
unreachable, empty, or a payload that is not a frontier — because the answer to
all of them is the same: ask the solver. It also rewrites `cached: true`; the
stored payload was produced by a scheduled run, which records itself as a miss
because it did the work, but from the reader's side it is unambiguously a hit.

Verified with the local solver dead: default frontier in **0.24s**,
`cached=true`, Sharpe 2.9478, 45 holdings, 3-point envelope.

A solve is real convex optimisation and cannot leave Python, so unlike the
screener and the stock pages this route cannot be made solver-independent in
general. Screened sets, changed constraints and re-runs are genuinely new work
and go to Cloud Run.

### The three budgets

They are separate on purpose and sit in series.

| Limit | Where | Value | What it protects |
| --- | --- | --- | --- |
| Requests per client | `lib/rate-limit.ts` | 10/min, 60/hr | the Next function |
| Points x assets per request | `api/frontier.py` `POINT_BUDGET` | 12,000 | one caller's single solve |
| vCPU-seconds per hour, all callers | `api/frontier.py` `SOLVE_BUDGET_SECONDS` | 600s / 3600s window | the free-tier bill |

`POINT_BUDGET` is deliberately not a rate limit: it is a statement about what a
frontier costs, applied identically to everyone. It leaves a screened set of a
few dozen names at full resolution while capping the full index at about 24
points. The hourly budget is denominated in seconds rather than requests
because a 20-name solve and a full-index solve are not the same thing; when it
fires the service answers 429 with `Retry-After`, and the route forwards that
header rather than flattening it to a bare 429.

Beware the empty-string trap that bit the rate limiter:
`Number(process.env.X ?? 10)` does not catch `""`, and `Number("") === 0`,
which is the documented way to *disable* the limiter. `limit()` in
`lib/rate-limit.ts` now trims and falls back.

### Deployed infrastructure

- Cloud Run service `margin-solver`, region `us-central1`, project
  `value-investing-dash` (161934570551). One service, not five.
- Three Cloud Scheduler jobs, all America/Toronto:
  `margin-daily` `30 18 * * 1-5` (prices, factors, revaluation, then
  `precompute_default()`), `margin-weekly` `0 7 * * 6` (everything, including
  quarterly statements), `margin-warm` `*/5 9-20 * * *` (keeps an instance
  alive during clicking hours).
- Secrets in Secret Manager, read by a dedicated `margin-solver` runtime
  service account. Write them with `printf '%s'`, never `echo` — a trailing
  newline inside a secret is a very quiet failure.

---

## 3. The one invariant that will break this page again

```
lib/portfolio-settings.ts   DEFAULT_PORTFOLIOS = 4
api/frontier.py             ENVELOPE_POINTS    = 4
```

**These must be the same number.** The cache key is built from the *resolved*
point count. When they drifted (defaults changed to 8 while the precompute
still stored 100 -> resolved 22), every single default visit missed the
snapshot and paid a live solve: measured on Cloud Run at **64.7s** against
0.3s for a hit. The route's `isDefaultRequest` predicate compares
`n_portfolios` against `DEFAULT_PORTFOLIOS` for the same reason.

Four, not three, is the floor. A request for N returns N-1 points over the full
index, because the maximum-return target is infeasible under the weight cap. At
3 the envelope is two points — a straight chord, not a curve — and the tangency
comes back at Sharpe 2.8014 against 2.9478 from 4 upwards, converged and
identical at 6, 8 and 22. The one-line revert to 3 is at
[lib/portfolio-settings.ts:31](../lib/portfolio-settings.ts#L31) if a straight
chord is preferred to a wrong Sharpe.

---

## 4. The design

### Two panes, the same as the screener

Constraints on the left, results owning the width. The rail is sticky and
`self-start` because the results column is several screens tall and the rail is
not; without it the controls scroll away and the reader is left with a column
of nothing beside the charts.

`RAIL_BREAKPOINT = 1280` — narrower than the screener's 1700, because these
results are charts that reflow rather than a table with a fixed natural width.
Below it the rail starts collapsed and the toolbar's **Settings** button opens
it. `railOpen` starts as `null` — meaning "whatever CSS chose for this
viewport" — which is what keeps the first paint free of a layout flash; the
first press reads `window.innerWidth` once and takes over.

### Panel, not Card

`components/ui/panel.tsx` is the chrome the screener settled on, extracted so
the rest of the app could wear it. `Card` — 32px padding, 18px title, shadow,
ring — reads as a *document*, and it is why the analysis and portfolio pages
felt like a brochure while the screener felt like a terminal. A panel is a
hairline box with a two-line header strip and a dense body: ~90px of vertical
chrome per panel becomes ~30px, and a page of panels reads as one instrument
rather than a stack of cards. `Card` is still right for the intro dialog and
the `/data` backfill cards, which really are documents.

`StatStrip` is the same argument at readout scale: six bordered tiles is six
borders saying nothing. One strip, hairline-divided, at a third of the height,
with exactly one `size="lead"` figure — a headline is only a headline while the
things around it are not.

### The run button is not in the rail

It sits in the results toolbar, above the chart it changes. That keeps it on
screen while the rail scrolls and reachable when the rail is collapsed. The
rail holds constraints; the toolbar holds actions and state.

### Honesty rules

This is where most of the page's complexity lives, and each rule exists because
the page could otherwise make a claim that is not true.

- **`isBaseline`.** The page seeds from `BASELINE_FRONTIER`, a shipped
  precomputed curve, so it is never blank. Every surface showing it says so.
  The baseline deliberately omits `risk_contributions`: a risk decomposition is
  a measurement, not an illustration, and should not be invented.
- **`dirty`.** Settings changed since the displayed solve was produced are
  called out in the toolbar. Without it the page shows a frontier that no
  longer matches the dials beside it, which is the one way a control panel can
  lie.
- **Constraints applied.** The rail's second panel is the settings *as the
  service resolved them*, and the two disagree often: a 3% cap comes back
  widened when the set is too small to spread it; a 200-point request comes
  back at 24. Put anywhere else that reads as trivia; put directly under the
  control that was overridden it reads as an answer.
- **Errors keep the previous render.** A failed solve does not blank the page —
  but the red block explicitly says whether what is below is the illustrative
  baseline or the last successful solve, because the curve is the thing people
  believe.
- **Excluded names are listed**, with the reason (listed part-way through the
  window, so the covariance estimator would see a fraction of their true
  volatility).
- **Scope is repeated.** Every readout from the stat strip down describes *one
  point* on the frontier. The header names it once and the three composition
  panels repeat it in their own `PanelMeta`, because a reader who scrolls past
  the strip would otherwise have no way to tell.

### Layout decisions that were bugs first

- **Anchor portfolios is full width.** Five numeric columns plus a name need
  ~470px; a half-width panel gives 290px at 1280 and 450px at 1600, so the
  table was scrolling its last two columns out of sight below 1920.
- **Two columns of stacked panels, not a grid of rows.** A row grid aligns
  cells at the top and leaves the shorter one trailing dead space — a 160px
  hole under every short panel. Distributing panels between two columns lets
  them balance by height.
- **Effective holdings, not a count.** `1 / sum(w^2)`, the reciprocal
  Herfindahl. A sixty-name portfolio with fifty-five at a rounding error is not
  a sixty-name portfolio.
- **Weight beside risk contribution.** A weight table cannot show that 3% in a
  volatile, everything-correlated name carries several times the risk of 3% in
  a defensive one. The two bars are the gap between what the portfolio owns and
  what it is exposed to.
- **Holdings tickers are links.** A portfolio you cannot interrogate name by
  name is a list of symbols.

### Colour and identity

Three series identities is the all-pairs cap for a scatter — any two marks can
end up adjacent — so the palette is validated with `--pairs all`. The two
anchors are additionally separated by *shape* (star, diamond) and a surface
ring, so identity never rests on hue alone. Tokens are `--color-series-*` and
`--color-seq-*` in `app/globals.css`; both themes are defined, and nothing here
hardcodes a hex.

### A solve survives navigation

`lib/portfolio-cache.ts`, `sessionStorage`, key `margin.portfolio.solve.v1`.
A solve is 5-20 seconds of real work, and the guaranteed reader behaviour is
optimise, look up a holding, come back — which used to reinstate the
illustrative baseline at the worst possible moment.

- `sessionStorage`, not `localStorage`: a frontier is a reading of prices on a
  particular afternoon and should not come back next week claiming to be
  current. It also never leaves the browser.
- Restored in an effect, not a `useState` initialiser: `sessionStorage` does
  not exist during the server render, and seeding from it would make the first
  client render disagree with the HTML that was sent. A `useRef` guard keeps it
  to once.
- **Settings restore across scopes** (they are the reader's preferences).
  **The solved frontier restores only onto the universe it was solved for** — a
  frontier over 32 screened names shown under the index's heading is a false
  claim.
- Arriving from the screener with a set starts a solve immediately: someone
  picked names and pressed optimise, so answering with the shipped baseline and
  a button makes them ask twice. A bare `/portfolio` visit is *not* a request
  and keeps the baseline — it is the browsing entry point and must not spend
  solver time on someone who came to look.

### Export

`lib/portfolio-export.ts` writes three blocks in one CSV — run metadata,
anchors, holdings — separated by blank lines with their own header rows, which
is what a spreadsheet needs to see them as separate tables and what `pandas`
needs for `skiprows`. The run block carries the constraint set, the as-of, and
`source`, which says out loud whether the numbers came from a real solve or the
shipped baseline. Weights with no constraints and no as-of are not a portfolio.

---

## 5. File map

| File | Role |
| --- | --- |
| `app/portfolio/page.tsx` | server component; decodes `?set=`/`?tickers=`, nothing else |
| `components/portfolio-builder.tsx` | the only stateful piece; owns the solve, the cache, the layout |
| `components/portfolio-controls.tsx` | the constraint rail (sliders, number fields, toggle) |
| `components/efficient-frontier.tsx` | `FrontierChart`, `SharpeCurve`, `hasTangency` — presentational |
| `components/portfolio-composition.tsx` | `HoldingsChart`, `HoldingsTable`, `SectorExposure` — presentational |
| `lib/portfolio-settings.ts` | parsing, validation, request building, `effectiveHoldings` |
| `lib/portfolio-cache.ts` | the session-scoped solve |
| `lib/ticker-set.ts` | the bitmask token |
| `lib/baseline-frontier.ts` | the shipped illustrative curve and the response types |
| `lib/portfolio-export.ts` | CSV |
| `app/api/efficient-frontier/route.ts` | rate limit, snapshot fast path, proxy |
| `api/frontier.py` | the solver: budgets, cache, `trace_frontier`, `precompute_default` |

Settings are strings, not numbers, throughout the client: a controlled numeric
input has to hold `""`, `"-"` and `"0."` mid-typing. Parsing happens once, in
`lib/portfolio-settings.ts`.

---

## 6. State and open items

**Verified working.** Default frontier served from Postgres in 0.24s with the
solver dead. Playwright sweep 24/24 (2 cases x 2 viewports), settling in
1.5-1.8s. `pnpm lint` clean. Committed as `549a68d api deployment`.

**Security — action required.** `SUPABASE_SERVICE_ROLE_KEY` is now present in
the root `.env`. Nothing in the Next app reads it: `lib/supabase.ts` uses only
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and no
file under `app/`, `lib/` or `components/` mentions `SERVICE_ROLE`. It is
unused there and **must not be copied into Vercel's environment variables** —
only the Python service uses that key. Deleting it from the root `.env` costs
nothing.

**Open.**

1. Vercel deploy, then swap `ALLOWED_ORIGINS` off the `http://localhost:3000`
   placeholder and re-check the `X-Margin-Origin` handshake.
2. The $5 budget alert in Billing -> Budgets & alerts.
3. Confirm `margin-weekly` after its first 11:00 UTC firing — it is the
   ten-minute request nothing has exercised yet.
4. `precompute_default()` warms only the full-index solve. A screened set
   arriving from the screener CTA misses both caches and pays a live solve
   (plan section 1C.10).
5. Parallel pagination of the Supabase reads (`recent_prices_df`,
   `db.fetch_all_rows`) is measured and specified but not implemented. The
   valuations cost is network round trips, not compute — and note that bounding
   the factor read would silently corrupt every cost of equity, because the
   Fama-French premia are estimated over the *full* history.
6. `^IRX` fails on every price backfill. Pre-existing, and the risk-free rate
   has a fallback.
