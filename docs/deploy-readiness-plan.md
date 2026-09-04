# Getting Margin deployed

A plan to take the project from "runs on my laptop" to "a recruiter opens the
link at 3am and it works" — without spending money, and without weakening the
thing the project is actually about.

- **Status:** Phase 0, Phase 1, Phase 1B and Phase 1C are done and verified
  against the two running dev services. Phase 2 (deploy) and Phase 3 (good to
  great) are not started.

  Deferred out of 1B, deliberately: **sparklines in the screener** (§1B.2) —
  they need ~40 downsampled closes per ticker in the universe snapshot and an
  eighth column in a table that had four columns clipped off the right until
  this pass, so the column budget is the binding constraint rather than the
  payload size. **Mobile** (§1B.8) is deprioritised by the project owner; it
  was checked for regressions at 390px (no document overflow, no console
  errors, tables scroll inside their own container) but not designed for.
- **Written:** 2026-09-04
- **Targets:** Vercel (dashboard) · Google Cloud Run (solver) · Supabase (warehouse)
- **Hard constraint:** every database change lands in **one batch, before
  anything deploys**. The live database is shared with the running dev services.

---

## Context

The code is strong. The valuation models refuse rather than guess, the frontier
is traced as N real QPs instead of blending two anchors, the palette is
CVD-validated, and the migrations carry better commentary than most production
repos. `pnpm lint` is clean.

What is missing is entirely operational. Measured against the two running dev
services on 2026-09-04:

| | Measured |
|---|---|
| `POST /backfill/*` on a public URL | **No authentication.** Anyone can trigger a 10-minute ingest, pin the CPU, and burn the Supabase egress quota |
| `POST /efficient-frontier` | **No limit on cost.** 500 stocks × 200 points is one unauthenticated request costing 37s of 2-vCPU time; a bash loop exhausts the monthly free tier in hours |
| Full-index frontier, 100 points | **20.5s warm CPU**, 53.6s cold — and "Optimise all 448 matches" is the screener's primary CTA |
| Full-index frontier, 200 points | 37.2s warm |
| Frontier, 20 names / 60 points | 0.25s warm, **6.8s cold** — 6.5s of it is the Supabase price read, not the solve |
| `GET /valuations` | **349 KB, 2.4s warm**, 4.2s cold, five full-table reads, no gzip |
| `/data` | A public **"Refresh everything"** button on a site with no accounts |
| `app/api/backfill/all/route.ts` | `maxDuration = 800` **exceeds Vercel Hobby's 300s ceiling** — clamped or rejected in production |
| Every public table | **RLS disabled**; views are implicitly `SECURITY DEFINER` |
| `lib/supabase.ts` | Dead code — the only consumer of the root `.env` `NEXT_PUBLIC_*` vars, imported nowhere |
| `app/layout.tsx` | **Geist Sans is downloaded on every page and never used** — `--font-sans` maps to Raleway, `--font-mono` to Geist Mono, nothing reads `--font-geist-sans` |
| `app/favicon.ico`, `public/*.svg` | Still create-next-app scaffold files; no OG image, so shared links preview as nothing |
| `Stock.marketCap` | Populated by the API, rendered in no component |
| `run-value-investing-dash/SKILL.md` | Documents a `/dashboard` page and a "Stock Ticker" input that no longer exist; claims `pnpm lint` fails (it passes) and that "no code talks to Supabase" |

The 20.5s figure is the one that decides everything downstream. It is pure CPU,
and it rules out every shared-nano free tier.

---

## Decisions taken

- **Google Cloud Run** for the solver. The free tier genuinely covers this
  workload (~7%, worked through below), 2 vCPU halves the solve, Cloud Scheduler
  handles the backfills, and it reads as real infrastructure. Render's free tier
  was ruled out deliberately: 0.1 CPU turns the 20.5s solve into roughly three
  minutes.
- **A snapshot table**, so Next reads the warehouse directly and the screener no
  longer depends on the solver being awake.
- **Full scope**, including the good-to-great work — but sequenced so deployment
  is not gated on it.
- **No Jupyter notebooks.** The in-app backtest (Phase 3.2.1) answers the same
  question in a place that is far more convincing than a static PNG.

---

## Phase 0 — Database, all at once, before any deploy

One migration file: `supabase/migrations/20260904000000_deploy_readiness.sql`.
Everything in it is additive or invisible to the currently running code, so the
dev services keep working after it is applied.

### 0.1 Snapshot tables

```sql
create table public.universe_snapshot (
  id          int primary key default 1 check (id = 1),
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);

create table public.frontier_snapshot (
  cache_key   text primary key,   -- hash of (universe fingerprint, constraints)
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);
```

`universe_snapshot.payload` is exactly what `api/universe.py:scored()` already
returns, so the shaping logic stays in Python and is not duplicated in
TypeScript. `frontier_snapshot` holds the precomputed default-settings
full-index solve.

### 0.2 The price index

```sql
create index if not exists daily_close_prices_ticker_date_idx
  on public.daily_close_prices (ticker, date desc) include (close);
```

The primary key is `(date, ticker)`, so every read filtered by ticker — both
`market.prices_df`'s `.in_("ticker", chunk).order("date")` and the
`latest_close_prices` view's `distinct on (ticker) … order by ticker, date desc`
— currently goes through the single-column ticker index and then out to the heap.
This composite makes both index-only scans, and it is the cheapest fix for the
6.5s cold read that dominates a small solve.

About 250k rows. A plain `create index` locks writes for a second or two;
`concurrently` would not work inside a migration transaction anyway.

### 0.3 RLS and view security

```sql
alter table public.daily_close_prices      enable row level security;
alter table public.company_profile         enable row level security;
alter table public.quarterly_fundamentals  enable row level security;
alter table public.dividend_history        enable row level security;
alter table public.factor_returns          enable row level security;
alter table public.valuations              enable row level security;
alter table public.ticker_statistics       enable row level security;
alter table public.universe_snapshot       enable row level security;
alter table public.frontier_snapshot       enable row level security;

-- Only the two snapshot tables are readable by the browser-safe key.
create policy "anon reads universe snapshot"
  on public.universe_snapshot for select to anon using (true);
create policy "anon reads frontier snapshot"
  on public.frontier_snapshot for select to anon using (true);

alter view public.daily_log_returns       set (security_invoker = true);
alter view public.daily_excess_returns    set (security_invoker = true);
alter view public.average_risk_free_rate  set (security_invoker = true);
alter view public.ttm_fundamentals        set (security_invoker = true);
alter view public.latest_close_prices     set (security_invoker = true);
```

**Why this is safe against the live database today.** The Python service
authenticates with the service role key, which bypasses RLS entirely, so nothing
in `api/` changes behaviour. The anon key is used by exactly one file,
`lib/supabase.ts`, which is imported nowhere. Enabling RLS now breaks nothing,
and it is a precondition for Phase 1.6 — which is why it belongs in this batch
rather than after.

It also clears every finding Supabase's security advisor currently raises, which
is a dashboard a recruiter could plausibly be shown.

### 0.4 The gate

```bash
supabase db push
curl -s http://127.0.0.1:8000/valuations -o /dev/null -w "%{http_code} %{time_total}\n"
curl -s -X POST "http://127.0.0.1:8000/efficient-frontier?n_portfolios=60&tickers=AAPL,MSFT,KO,PEP,XOM,CVX,JNJ,PFE,T,VZ" \
     -o /dev/null -w "%{http_code} %{time_total}\n"
node .claude/skills/test-portfolio-optimizer/sweep.mjs --quick
```

All three must behave exactly as before, and the small-set solve should get
*faster* on a cold cache. Nothing else touches the database until this passes.

---

## Phase 1 — Safe and fast enough to deploy

### 1.1 Authenticate the write endpoints

`api/config.py` gains `BACKFILL_TOKEN = os.environ.get("BACKFILL_TOKEN")`.
`api/main.py` gains one dependency, applied to the six `POST /backfill/*` routes:

```python
def require_backfill_token(x_backfill_token: str = Header(default="")) -> None:
    if not config.BACKFILL_TOKEN:
        raise HTTPException(503, "BACKFILL_TOKEN is not configured.")
    if not secrets.compare_digest(x_backfill_token, config.BACKFILL_TOKEN):
        raise HTTPException(401, "Invalid or missing backfill token.")
```

`secrets.compare_digest`, not `==` — a timing-safe comparison is the correct
idiom and worth having right in a repo people read. CORS does not protect these
routes; curl ignores it entirely.

Read endpoints stay public.

### 1.2 Response compression

`app.add_middleware(GZipMiddleware, minimum_size=1000)`. `/valuations` goes
349 KB → 61 KB. One line, 5.7×, and directly relevant to Cloud Run's 1 GiB
free-egress allowance.

### 1.3 Frontier resolution — the real cost lever

**Not two points.** A two-point envelope is a straight chord between the
min-volatility anchor and the maximum-return end — precisely the construction the
README's third write-up explains was wrong ("a chord across a convex set, 25–50bp
inside the real curve"). Shipping it as the default would contradict the
project's own best story, and the frontier chart is the headline screenshot.

Cost scales with the number of points *and* superlinearly with the number of
assets, so budget the product:

```python
# Each point is an independently solved QP whose cost grows with the square of
# the universe. Budget the product so a 20-name set still gets a 200-point curve
# while the full index cannot cost more than a few seconds.
POINT_BUDGET = 12_000

def resolve_point_count(requested: int, n_assets: int) -> tuple[int, bool]:
    allowed = max(MIN_ENVELOPE_POINTS,
                  min(MAX_ENVELOPE_POINTS, POINT_BUDGET // max(n_assets, 1)))
    return min(requested, allowed), requested > allowed
```

- 493 assets → 24 points, about 5s
- 100 assets → 120 points
- 20 assets → 200 points

Report the clamp in the response (`n_portfolios_requested` alongside
`n_portfolios`) and state it on the page in the voice the constraint card already
uses: *"Resolution capped to 24 — each point is a separate 493-variable QP."*

Supporting changes:

- `lib/portfolio-settings.ts`: `DEFAULT_PORTFOLIOS` 100 → **40**.
- `components/efficient-frontier.tsx`: add `type="monotone"` to the envelope
  `Line`, which is currently linear with `dot={false}`. Monotone interpolation
  renders 24 points as smoothly as 200 — this is what makes the reduction
  visually free rather than a downgrade.

### 1.4 Precompute the expensive default

The full-index, default-constraints solve changes only when prices change.
Compute it at the end of `backfill.valuations()` and write it to
`frontier_snapshot`; serve from there when the request matches.

Add an in-process LRU in `api/frontier.py` keyed on
`(sha256(sorted tickers), lower, upper, gamma, n_points)` with a 15-minute TTL,
matching the existing `_price_column_cache` and `sector_map` pattern. A recruiter
clicking the default CTA twice pays once.

### 1.5 Warm the price cache at startup

A FastAPI `lifespan` hook that kicks `market.prices_df(config.SP500_TICKERS)`
onto a background thread. This turns the cold full-index path from 53.6s into
about 20s, and the cold small-set path from 6.8s into 0.25s. It matters most on
Cloud Run, where every cold start begins with an empty cache.

### 1.6 Read path: Next → Supabase, not Next → FastAPI → Supabase

- `api/backfill.py`: at the end of `valuations()`, upsert `universe.scored()`
  into `universe_snapshot`.
- `lib/supabase.ts`: currently dead. Rewrite as a server-only client and add
  `loadUniverseFromSnapshot()`.
- `lib/universe.ts`: reorder `loadUniverse()` to try (1) `universe_snapshot` via
  Supabase, (2) `GET /valuations` on the solver, (3) `SAMPLE_UNIVERSE`. Keep the
  existing `revalidate: 3600` and `VALUATIONS_CACHE_TAG` behaviour.

**Why this matters more than it looks.** After this change the screener and every
stock page render from Supabase alone. Two of the three pages a recruiter visits
work perfectly while the solver is scaled to zero; only `/portfolio` needs Cloud
Run awake, which is exactly the surface that is genuinely CPU-bound. It is also a
better README paragraph than the one there now.

### 1.7 Close `/data` on the deployed site, keep it for local use

There are no accounts, so a public "Refresh everything" button is an open
invitation — and the route would not work in production anyway, given the
`maxDuration = 800`. The backfills belong to Cloud Scheduler.

**Nothing is deleted.** One env flag, `ENABLE_DATA_PAGE`, default off:

- `app/data/page.tsx` calls `notFound()` unless the flag is `"true"`. The file,
  its copy and the `BackfillCard` / `RefreshAllCard` components all stay in the
  repo and still work locally with the flag set. In production the route is a
  genuine 404, not a hidden page.
- The six `app/api/backfill/*/route.ts` handlers get the same guard, so
  `POST /api/backfill/all` on the deployed site 404s before reaching anything.
  This removes the `maxDuration` problem entirely rather than tuning around it.
- `components/app-shell.tsx` renders the "Data" link only when the flag is on.
- The proxy routes forward `X-Backfill-Token` from `process.env.BACKFILL_TOKEN`
  so local use still works after 1.1.

### 1.8 Abuse and cost control — four layers

Designed against the worst realistic case: someone asking for 500 portfolios over
500 stocks, by accident or on purpose. None of these layers is visible to an
ordinary reader.

**Layer 1 — the cost budget clamp (1.3) already answers that exact case.**
`POINT_BUDGET` means 493 assets can only ever get 24 points, so the request costs
about 5s instead of 37s no matter what is typed. Because the clamp is reported
and explained on the page, it reads as a stated engineering constraint rather
than a silent cap. A 20-name screened set — the interesting case, and the one the
project is about — still gets the full 200 points. **This layer does the real
work.**

**Layer 2 — Vercel is the only door.** The browser calls `/api/efficient-frontier`
on Vercel, which calls Cloud Run server-side, so the Cloud Run URL never reaches
the client. Make that structural: require an `X-Margin-Origin` shared secret on
`POST /efficient-frontier`, set by the Next route handler from an env var.
`/health` and `/valuations` stay open, since they are cheap and cached and a
technical reader may well want to curl them from the README.

**Layer 3 — per-IP rate limiting, in the Next route handler.** This has to live
on Vercel, not in Python: once every request arrives via the proxy, Cloud Run
sees Vercel's IP on all of them and per-IP limiting there is meaningless. The
handler reads the real client from `x-forwarded-for` and runs a token bucket —
10 solves/minute, 60/hour. In-memory per serverless instance, which is imperfect
across instances and must be commented as such; it is still enough to stop a
naive loop, and Vercel's own DDoS protection sits in front of it.

**Layer 4 — a global solve-seconds budget in the solver.** The scarce resource is
vCPU-seconds, so denominate the limit in vCPU-seconds rather than proxying it
through a request count. Track cumulative solve time over a rolling hour; past a
ceiling (600s/hour, roughly 4× a plausible busy hour and about 5% of the daily
free-tier allowance) return `429` with a `Retry-After`. Cache hits and the
precomputed default frontier are **exempt**, because they cost no CPU — which is
what keeps the headline "Optimise all 448 matches" click instant and never
rate-limited, even under load.

**Backstops.** `--max-instances 2` and `--concurrency 4` bound how much can run
at once. Set a GCP budget alert at $1 and $5 — and state plainly that Google has
**no hard spend cap by default**, so the alert is a tripwire and the app-level
limits above are the actual defence.

### 1.9 Housekeeping

- `next.config.ts` is an empty stub: add `compress: true`,
  `poweredByHeader: false`.
- Root `.env` holds a `supabase_password` key nothing reads — remove it.
- `.env.example` gains `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `BACKFILL_TOKEN`,
  `MARGIN_ORIGIN_SECRET`, `ENABLE_DATA_PAGE`.
- `api/.env.example` gains `BACKFILL_TOKEN`, `MARGIN_ORIGIN_SECRET`.
- `api/Dockerfile`: run as a non-root user; `.dockerignore` drops `api/.venv`
  (613 MB on its own), `api/notebooks` and `docs/`.

---

## Phase 1B — Make it read as a real investing dashboard

All pre-deploy, and all inside the existing design language: square corners,
hairline borders, Raleway uppercase tracked-wide labels, mono tabular figures,
the three-hue categorical set and the diverging valuation scale. Nothing here
introduces a new visual idea — it applies the ones already there more completely.

### 1B.1 The market context bar

A hairline strip across the top of the main column, above the page header, on
every page:

```
S&P 500  6,412.30  ▲0.41%   ·   13W T-BILL  3.69%   ·   VALUED  AUG 26 2026   ·   SOURCE  yfinance / Ken French
```

Uppercase tracked labels, mono figures, a `--series-*` direction arrow,
`border-b border-border`. Every one of those numbers is already in the payload:
`^GSPC` is in `daily_close_prices`, the T-bill rate is on every response, and
`computed_at` is on the universe.

Real dashboards state their as-of state globally. This is the single change that
most separates "a terminal" from "a demo". Colour the `VALUED` date with
`--status-warning` past 48 hours — an operational-awareness signal a recruiter
will notice.

### 1B.2 Sparklines in the screener table

The visual signature of every professional screener. A 60×16px single-stroke SVG
in `--series-1`: one column, no axes, no dots.

Needs about 40 downsampled closes per ticker in the universe snapshot. Rounded to
2dp that is roughly 493 × 40 floats — **measure the payload before committing.**
If it pushes the snapshot past ~600 KB raw, drop to 30 points or fetch sparklines
lazily for visible rows only. Gzip should land near 100 KB, which is fine, but
measure rather than assume.

### 1B.3 Table craft

- **Sticky header row.** Scrolling 448 rows currently loses every column label —
  the cheapest large usability win on the page.
- **Whole-row click-through.** Only the ticker cell links to `/stocks/[ticker]`
  today. Make the row the target with a hover state, keeping the checkbox as its
  own hit area.
- **Add the market cap column.** `Stock.marketCap` is populated and rendered
  nowhere. Format it as `$4.52T` / `$43.7B`, not a raw float in billions.
- **Align the sign column** so `+9.4%` and `+99.4%` line up on the decimal.
  `tabular-nums` is already on `td`/`th`; give the sign its own fixed slot.
- **Export CSV** on the screener and the holdings table. A `Blob` and an
  `<a download>` — maybe fifteen lines, and it reads as product maturity.

### 1B.4 Stable loading and empty states

Skeletons that keep the exact grid and border geometry rather than collapsing to
a line of text. This matters most on `/portfolio`, where the solve runs 5–20s:
show `Solving 40 portfolios…` with the real count, which the response already
reports.

### 1B.5 Identity and share surface

- **Drop Geist Sans.** Downloaded on every page load, consumed by nothing. One
  less webfont, zero visual change.
- **Delete the create-next-app leftovers**: `public/next.svg`, `vercel.svg`,
  `file.svg`, `globe.svg`, `window.svg`, and the default `app/favicon.ico`. A
  recruiter browsing the repo currently sees scaffold files.
- **A real favicon and `app/opengraph-image.tsx`.** Next generates the OG image
  at build time. Recruiters share links; right now they preview as nothing. The
  "Margin" wordmark over the frontier curve is enough.

### 1B.6 The two structural page changes

**A landing page at `/`.** Currently `redirect("/screener")`, so the first screen
is a 448-row table with no statement of what any of it is. Build a compact `/`
carrying the one-paragraph thesis already written in the README, the three-step
strip, a live frontier thumbnail and a "Start screening" CTA. **This is the
highest-leverage change in the project**, and it is pre-deploy work.

**Give the screener a page header.** Every other page has the eyebrow + title +
description treatment ("STEP THREE / PORTFOLIO BUILDER"); the most-visited page
has none. Add "STEP ONE / SCREENER" with the value-first framing.

### 1B.7 Palette: separate chrome from data

The CVD-validated palette stays — it is unusual work and the README should say
so. One change: `--primary` sits in the same blue neighbourhood as `--series-1`
and `--seq-3`, so the "Optimise all 448 matches" button competes with the
frontier line for the same meaning. Move primary actions to a distinct accent —
near-black ink in light mode, `--series-3` green in dark — so no hue ever means
both "click me" and "this data series".

### 1B.8 Mobile

The 20rem filter rail and the wide tables overflow on a phone, and recruiters do
open links on phones. Wrap every table in `overflow-x-auto`, collapse the filter
rail into a sheet under `lg`, and check the sidebar's horizontal-strip mode still
reaches the theme toggle now that the Data link is gone.

---

## Phase 1C — The owner's pass

Changes asked for after walking the built app, all pre-deploy.

### 1C.1 No landing page

`/` is a `redirect("/screener")` again. The workflow is screen → analyse →
optimise and a landing page is a page you have to leave before any of it can
start; the screener's own header and the context strip above it already say
what the app is. The route survives as a redirect because `/` is what gets
pasted into a message and `opengraph-image.tsx` still hangs off its metadata.

### 1C.2 Typefaces

Both were wrong for a page that is mostly numbers.

**Raleway → Inter** for `--font-sans`. Raleway is a display face: geometric,
small-bodied figures, a single-storey `1` a stroke away from a lowercase `l`.
It set every figure not in a mono column — the match count, the stat readouts,
the weights on the portfolio page.

**Geist Mono → JetBrains Mono** for `--font-mono`, which is most of what is on
screen. Geist Mono's digits are narrow with a small aperture: fine in an editor
at one figure per line, costly in a 450-row column read by scanning down it.
JetBrains Mono has a taller x-height, a slashed zero and a `1` with a base
serif.

Table headers lost a tracking step and gained a weight step at the same time —
uppercase at 12px is the hardest thing on the page to read, and wide tracking
on top of it had pushed the letters far enough apart to stop reading as words.

### 1C.3 Scrollbars

The app is full of them: two panes on the screener, a table that scrolls in
both axes, a rail scrolling inside a fixed height. A default OS scrollbar reads
as part of the operating system rather than the page. Thin, square, on a
`--scrollbar` token a step darker than `--axis`, declared in both the standard
and `::-webkit` syntaxes because Chromium 121+ honours the former and ignores
the latter.

### 1C.4 A taller screener table

Row count at 1440x900 went from 9 to 14 — a 55% gain, all of it from chrome:

| | before | after |
|---|---|---|
| Ticker cell | ticker over name, two lines | one line, name truncated |
| Row height | 55px | 38px |
| Distribution | bordered card, ~130px | strip, ~40px |
| Page header | `py-8`, `gap-2` | `py-5`, `gap-1.5` |
| Cell padding | `p-3` | `px-3 py-2` |

The two-line identity cell was the expensive one: it set the height of every
row in a table whose total height is fixed at the window, and the truncation it
avoided was already there.

### 1C.5 One rating rule, not two

The "valued by at least N models" floor is gone. It made the same claim twice —
which models may speak is already the model selection, and a second number
modifying it meant two controls had to be reasoned about together to know what
a row's band meant. A stock is now rated when any selected model valued it, and
the per-row `n/m` count in the margin column carries the agreement information,
which is the more honest place for it: it is per-row, and the floor was not.

### 1C.6 A default that is a screen

`marginRange` was `[-1, 1]` and `maxBeta` was `3` — not a default so much as the
absence of one, since every rated stock passes. Now **-25%** and **1.50**, both
read off the distribution rather than picked for roundness: -25% sits just
inside the `undervalued` band's -26% cut, so the default keeps the cheaper two
quintiles; 1.50 trims the volatile tail without touching the market-tracking
middle.

**166 of 493**, down from 459. Everything downstream reads the filtered set, so
this is also what the primary call to action now hands the optimiser.

### 1C.7 `/stocks` is a router

The parent route used to render AAPL's charts on arrival — a page about a
company nobody asked about, and the same content at two URLs, one of which
could not be linked to. It is now the search box alone; every stock lives at
`/stocks/[ticker]`, which grew the same search strip in the same position.

Resolution happens in the browser against the universe already in memory,
because the destination's only recourse is a 404. A company name works as well
as a ticker, and an unmatched query is answered in place.

### 1C.8 `job_runs`, and saying when data was gathered

**New migration:** `20260904010000_track_job_runs.sql`. The Phase 0 constraint
still holds — this lands before anything deploys.

The strip said `VALUED SEP 04`, which was `universe_snapshot.computed_at`: when
the models last ran. That is not the question a reader is asking. The models
recompute in sixty seconds over whatever the feeder tables hold, so a valuations
pass on a fortnight-old price table stamps itself fresh and is not.

`job_runs` records one row per scheduled ingest — job, three-state status,
started/finished, duration, rows, and the stage's own error list as `jsonb`.
Three states rather than two because the backfills are deliberately
partial-tolerant: a run that loses eleven tickers out of 493 still refreshed the
table and is not a failure, but calling it a success hides a provider outage
eating a slice of the universe every night. The default-frontier precompute is
deliberately **not** recorded — it is a derived solve over data the other rows
already cover, and recording it would put the newest timestamp in the table on
the one job that fetched nothing.

`api/jobs.py` writes the rows and reads `latest_job_runs` back into the universe
snapshot, so the front end gets freshness on a payload it already reads rather
than paying a round trip for one line of chrome. The strip now reads
`COLLECTED SEP 04, 2026 · 02:43 EDT`, to the minute and in market time, with a
per-stage breakdown behind it. `isStale` moved onto the gathered timestamp, so
stale inputs under a fresh recompute now trip the warning that previously could
not see them.

---

## Phase 2 — Deploy

### 2.1 Cloud Run

```bash
gcloud run deploy margin-solver \
  --source api/ \
  --region us-central1 \
  --cpu 2 --memory 2Gi \
  --min-instances 0 --max-instances 2 \
  --concurrency 4 \
  --timeout 900 \
  --cpu-boost \
  --allow-unauthenticated \
  --set-env-vars "ALLOWED_ORIGINS=https://<your-app>.vercel.app" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest,BACKFILL_TOKEN=backfill-token:latest,MARGIN_ORIGIN_SECRET=margin-origin:latest"
```

- **2 vCPU** — the solve is single-threaded in Clarabel, but OpenBLAS threads the
  covariance and KKT assembly, and the second core absorbs the keep-warm ping.
- **`--cpu-boost`** — full CPU during container start, which is where the ~3s
  `cvxpy` import lands.
- **`--min-instances 0`** — scale to zero. A single idle instance would blow the
  free tier on its own: 720 hours a month against a 50 vCPU-hour allowance.
- **`--concurrency 4`**, not the default 80 — a CPU-bound solve must not share an
  instance with 79 other requests.
- **Default request-based billing.** Do *not* pass `--no-cpu-throttling`; that
  switches to instance-based billing and charges for idle time.

### 2.2 Vercel

`MARKET_DATA_API_URL` → the Cloud Run URL. `NEXT_PUBLIC_SUPABASE_URL` and the
publishable key → the Supabase project. `MARGIN_ORIGIN_SECRET` → matching Cloud
Run. `ENABLE_DATA_PAGE` unset. The service role key **never** reaches Vercel.

---

## Scheduling, and the free-tier arithmetic

Three Cloud Scheduler jobs — exactly the free allowance of 3 per billing account.
Each sends `X-Backfill-Token` as a custom header.

| job | cron (America/Toronto) | target | duration |
|---|---|---|---|
| `margin-daily` | `30 6 * * 2-6` | `POST /backfill/all?skip_fundamentals=true` | ~2 min |
| `margin-weekly` | `0 7 * * 6` | `POST /backfill/all` | ~10 min |
| `margin-warm` | `*/5 9-20 * * *` | `GET /health` | ~0.1s |

**Tue–Sat** for the daily job, because it refreshes *after* each Mon–Fri close.
The weekly run is the only one that re-pulls quarterly statements, which change
once a quarter.

**The keep-warm window is 09:00–21:00, not 24/7.** After 1.6 the screener and
stock pages never touch Cloud Run, so the service only needs to be warm when
someone might click "Run optimisation" — and nobody reviews a portfolio at 4am.
This is the main lever for minimising usage, and it costs a third of what
round-the-clock pinging would.

### Does it fit? Comfortably — about 7%

Cloud Run always-free per month: **180,000 vCPU-s**, **360,000 GiB-s**,
**2M requests**, **1 GiB North-America egress**.

| workload | vCPU-seconds / month |
|---|---|
| Keep-warm, 144 pings/day × 0.1s × 2 vCPU | 864 |
| Daily backfill, 22 runs × 120s × 2 vCPU | 5,280 |
| Weekly backfill, 4 runs × 600s × 2 vCPU | 4,800 |
| Visitor solves, ~200/month × 5s × 2 vCPU | 2,000 |
| **Total** | **≈12,900 of 180,000 — 7%** |

Memory tracks the same ratio (≈12,900 of 360,000 GiB-s, 4%). Requests ≈4,500 of
2,000,000. Egress: frontier responses are ~15 KB, so a few megabytes — the 349 KB
`/valuations` payload leaves Cloud Run's budget entirely once Next reads the
snapshot from Supabase.

Even at a 1-minute keep-warm interval running 24/7 this lands near 13%. There is
no realistic traffic level at which a portfolio project exceeds this.

**The other quota that matters:** the Supabase free tier **pauses a project after
7 days of inactivity**, and allows 5 GB egress/month. The nightly job writes
daily, so it never pauses. Next's hourly ISR revalidation of a 349 KB snapshot is
about 250 MB/month, 5% of the allowance. Keep the `revalidate: 3600`.

---

## Phase 3 — Good to great

Not a deploy blocker. Sequenced after Phase 2 so shipping is not gated on it.

### 3.1 Remaining UI work

**Rebalance the stock detail page.** The left column ends after Key Statistics
while the right column runs long, leaving a large dead area bottom-left. Move the
discount-rate panel into the left column, or grow the price chart to fill it.

**A command palette, doubling as the company picker.** `/stocks` hardcodes
`initialTicker="AAPL"` behind a free-text input that can 404. Replace it with a
⌘K palette searching the universe already in memory, and bind `/` to focus the
screener search. Terminal-like, cheap, and the kind of thing a technical reader
tries on instinct.

### 3.2 Functional additions, in value order

1. **Does the screen actually work?** The app makes a claim — value-filter first,
   then optimise — and cannot currently evidence it. Equal-weight the top decile
   by consensus margin at the start of the price window; plot cumulative return
   against `^GSPC` and against the unscreened tangency portfolio. This is the
   first question a finance recruiter will ask, it reuses the price frame already
   in memory, and it is the strongest single addition available.

2. **Surface the model disagreement.** The README's best statistic — the models
   disagree on direction for 278 of the 468 stocks two or more can value — has no
   UI at all. A panel on each stock page plotting the five fair values against the
   current price makes the point instantly.

3. **Discount-rate sensitivity.** One line chart on the stock page: fair value as
   a function of cost of equity and terminal growth. Shows you understand that a
   DCF is a lever, not a measurement — and the rates are already stored per ticker
   from migration `20260821000000`.

4. **Explain the refusals inline.** `VALUATION_METHODS[].refusesWhen` already
   holds the exact conditions. "Does not apply" should be hoverable and say
   *which* condition fired.

5. **Sector heatmap on the screener** — median consensus margin by sector, so the
   shape of the screen is visible before any filtering.

### 3.3 Documentation

The README is excellent and mostly needs updating rather than rewriting: the
deployment section becomes concrete (Cloud Run, Scheduler, the free-tier table
above), the architecture diagram gains the snapshot read path, and the
"Performance work" row gains the new numbers. Add a live demo link and an
UptimeRobot status badge — a free monitor on `/health` doubles as a second
keep-warm source and as a recruiter-facing uptime signal.

### 3.4 Agent docs — currently wrong

- **`.claude/skills/run-value-investing-dash/SKILL.md`** is stale to the point of
  being misleading: it documents a `/dashboard` route and a "Stock Ticker" input
  that no longer exist, states `pnpm lint` fails (it passes), and says "no code
  currently talks to Supabase". Rewrite against the real routes (`/screener`,
  `/stocks/[ticker]`, `/portfolio`, `/data`), and record that both dev servers are
  already running on :3000 and :8000 and must be attached to rather than started
  or killed.
- **`AGENTS.md`** carries only the auto-generated Next.js block. Add project
  guidance below it, preserving that block verbatim: the two-service split,
  British spelling and the explanatory comment style, the no-border-radius house
  rule, the "a model returns `None` rather than a wrong number" invariant, the
  `pnpm dev` / never-`pnpm build` preference, and the fact that the database is
  live and shared.
- **`.claude/skills/test-portfolio-optimizer/SKILL.md`** needs the new
  `n_portfolios` clamp documented, or the sweep's invariant checks will read a
  correct clamp as a failure.

---

## Verification

**After Phase 0** — the gate before any other work: see 0.4.

**After Phase 1:**

```bash
# Writes are closed
curl -s -X POST http://127.0.0.1:8000/backfill/valuations -w "\n%{http_code}\n"   # 401
curl -s -X POST -H "X-Backfill-Token: $BACKFILL_TOKEN" \
     http://127.0.0.1:8000/backfill/valuations -w "\n%{http_code}\n"              # 200

# Compression, and the clamp against the worst case
curl -s -H "Accept-Encoding: gzip" http://127.0.0.1:8000/valuations \
     -o /dev/null -w "%{size_download}\n"                                         # ~61 KB
curl -s -X POST "http://127.0.0.1:8000/efficient-frontier?n_portfolios=200" \
     -o /dev/null -w "%{time_total}\n"   # full index: < 8s, n_portfolios=24 in body

# The rate limiter fires and says so
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code} " -X POST \
    "http://localhost:3000/api/efficient-frontier?n_portfolios=40"
done; echo                                # 200s then 429s, with Retry-After

pnpm lint
node .claude/skills/test-portfolio-optimizer/sweep.mjs      # full matrix
```

The sweep runs through the Next proxy, so **raise or disable the per-IP limit for
it** via an env-var ceiling the sweep sets — otherwise a green sweep becomes a
wall of 429s and the limiter looks like a regression.

With `ENABLE_DATA_PAGE` unset, `/data` and `POST /api/backfill/all` must both
return 404, and the "Data" link must be absent from the sidebar.

Then, **with the solver stopped**, load `/screener` and a stock page. Both must
render live data from the snapshot with **no** "illustrative sample" banner. That
is the assertion that proves 1.6 did what it was for.

**After Phase 2:** run the sweep against the deployed pair (`WEB_URL=…
API_URL=…`), trigger each Scheduler job by hand, confirm in Cloud Run metrics
that the instance count returns to zero between requests, and check the billing
page after 48 hours to confirm $0.

**Standing preference:** run `pnpm dev` only, never `pnpm build`, and attach to
the dev servers already listening on :3000 and :8000 rather than starting or
killing them.

---

## Open questions

- **Sparklines and payload size (1B.2).** The highest-impact table change is also
  the only item that grows the snapshot. Measure first; if the snapshot passes
  ~600 KB raw, fetch sparklines lazily for visible rows instead.
- **Whether `/valuations` stays public (1.8, Layer 2).** Keeping it open lets a
  technical reader curl the API from the README, which is a small but real part of
  the project's appeal. Closing it is one line if that stops feeling worth it.
