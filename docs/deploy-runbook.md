# Deploying Margin

The concrete procedure for Phase 2 of `deploy-readiness-plan.md`. Every command
is meant to be pasted in order; where a step needs a value from an earlier step,
it says so.

Three services, and only one of them is interesting:

- **Supabase** holds the warehouse. Already live; nothing to deploy.
- **Cloud Run** holds the solver. This is the whole of the work below.
- **Vercel** holds the dashboard. Connect the repo and set five variables.

The dependency between the last two runs both ways, which is why the deploy
happens in two passes: Cloud Run needs Vercel's URL for `ALLOWED_ORIGINS`, and
Vercel needs Cloud Run's URL for `MARKET_DATA_API_URL`. Deploy Cloud Run with a
placeholder, deploy Vercel, then come back and close the loop.

---

## 0. What you need in hand

```bash
gcloud --version          # install: https://cloud.google.com/sdk/docs/install
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
export PROJECT=$(gcloud config get-value project)
export REGION=us-central1
```

**On the region.** `us-central1` is the default in the plan and is fine. The one
argument for changing it is Supabase: every backfill and every uncached solve
reads prices across that link, so if the Supabase project sits in `us-east-1`,
then `us-east1` here saves ~20ms a round trip on a job that makes hundreds. The
Cloud Run always-free allowance is the same in either. Check the region under
Supabase → Project Settings → General.

Two secrets are needed. Generate them now, keep them somewhere you can paste
from, and use the same two values in Secret Manager and on Vercel:

```bash
export BACKFILL_TOKEN=$(python -c "import secrets;print(secrets.token_urlsafe(32))")
export MARGIN_ORIGIN_SECRET=$(python -c "import secrets;print(secrets.token_urlsafe(32))")
echo "$BACKFILL_TOKEN"; echo "$MARGIN_ORIGIN_SECRET"
```

You also need the Supabase **service role key** (Project Settings → API). It goes
into Secret Manager and nowhere else. It bypasses row-level security, so it must
never be set on Vercel and never reach a browser.

---

## 1. Turn on the APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

`cloudbuild` and `artifactregistry` are needed because `gcloud run deploy
--source` builds the image for you and pushes it to a repository it creates.

---

## 2. Store the three secrets

```bash
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | gcloud secrets create supabase-key      --data-file=-
printf '%s' "$BACKFILL_TOKEN"            | gcloud secrets create backfill-token    --data-file=-
printf '%s' "$MARGIN_ORIGIN_SECRET"      | gcloud secrets create margin-origin     --data-file=-
```

`printf` rather than `echo`, because `echo` appends a newline and the newline
becomes part of the secret. A token that fails to compare equal for an invisible
reason is a bad afternoon.

### A runtime identity that can read them

Cloud Run will otherwise run as the default compute service account, which
carries project **Editor** by default: a solver that can delete your database is
more authority than a solver needs.

```bash
gcloud iam service-accounts create margin-solver \
  --display-name "Margin solver runtime"

export RUNTIME="margin-solver@${PROJECT}.iam.gserviceaccount.com"

for s in supabase-key backfill-token margin-origin; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME}" \
    --role=roles/secretmanager.secretAccessor
done
```

That is the account's entire set of permissions: read three secrets. It reaches
Supabase over the network with a key, not with a Google identity, so it needs
nothing else.

---

## 3. First deploy, with a placeholder origin

```bash
gcloud run deploy margin-solver \
  --source api/ \
  --region "$REGION" \
  --service-account "$RUNTIME" \
  --cpu 2 --memory 2Gi \
  --min-instances 0 --max-instances 2 \
  --concurrency 4 \
  --timeout 1800 \
  --cpu-boost \
  --allow-unauthenticated \
  --set-env-vars "ALLOWED_ORIGINS=http://localhost:3000" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=supabase-key:latest,BACKFILL_TOKEN=backfill-token:latest,MARGIN_ORIGIN_SECRET=margin-origin:latest"
```

Also set `SUPABASE_URL`, which is not a secret:

```bash
gcloud run services update margin-solver --region "$REGION" \
  --update-env-vars "SUPABASE_URL=https://YOUR-PROJECT.supabase.co"
```

Then capture the URL, which every later step needs:

```bash
export SERVICE_URL=$(gcloud run services describe margin-solver \
  --region "$REGION" --format 'value(status.url)')
echo "$SERVICE_URL"
curl -s "$SERVICE_URL/health"          # {"status":"ok"}
```

**Why these flags**, beyond what the plan already says:

- **`--timeout 1800`, not 900.** The plan's 900 was written before the full
  backfill was measured end to end. It runs about ten minutes: prices ~30s,
  factors ~4s, quarterly statements ~500s, valuations ~60s. 900 leaves barely
  50% headroom on a job that talks to Yahoo several hundred times, and a Cloud
  Run timeout kills the request mid-ingest.
- **`--allow-unauthenticated`.** The service is public on purpose. `/health` and
  `/valuations` are meant to be curl-able from the README; the write routes are
  closed by `X-Backfill-Token` and the solve route by `X-Margin-Origin`, which
  is authentication at the layer that knows what it is protecting.
- **`--cpu 2`.** Clarabel solves on one thread, but OpenBLAS threads the
  covariance and the KKT assembly, and the second core absorbs the keep-warm
  ping without contending with a solve.
- **No `--no-cpu-throttling`.** That flag switches to instance-based billing and
  charges for idle time, which on a scale-to-zero service is the whole bill.

**If the build fails on permissions.** Since 2024 the `--source` build path runs
as the default compute service account, which on a new project often lacks the
builder role. The error names `cloudbuild`; the fix is one binding:

```bash
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/cloudbuild.builds.builder
```

---

## 4. Vercel

Import the repo at vercel.com. Framework detection handles the rest; the build
command and output directory need no changes.

Set these five in Project Settings → Environment Variables, for Production and
Preview both:

| variable | value |
|---|---|
| `MARKET_DATA_API_URL` | the `$SERVICE_URL` from step 3 |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable (anon) key |
| `MARGIN_ORIGIN_SECRET` | the same string as the `margin-origin` secret |
| `RATE_LIMIT_SOLVES_PER_MINUTE` | `10` |
| `RATE_LIMIT_SOLVES_PER_HOUR` | `60` |

**Leave `ENABLE_DATA_PAGE` and `BACKFILL_TOKEN` unset.** Unset is what makes
`/data` a genuine 404 and closes the six proxy backfill routes behind it. The
scheduled refreshes call Cloud Run directly and never go through Vercel.

**The service role key is not on this list and must not be added.** Anything set
on Vercel is one `NEXT_PUBLIC_` typo away from the browser bundle.

---

## 5. Close the loop

```bash
gcloud run services update margin-solver --region "$REGION" \
  --update-env-vars "ALLOWED_ORIGINS=https://YOUR-APP.vercel.app"
```

This matters less than it looks, because the browser never calls Cloud Run
directly: every solve goes to `/api/efficient-frontier` on Vercel, which calls
the service server-side. CORS governs a door nothing knocks on. Set it anyway,
so the header tells the truth about who is meant to be calling.

---

## 6. The scheduled fetches

Three jobs, which is exactly the free allowance of three per billing account.
Each carries the token as a custom header; none of them needs an identity,
because the service is public and the token is the check.

```bash
# Prices, factors and a full revaluation, after each session closes.
gcloud scheduler jobs create http margin-daily \
  --location "$REGION" \
  --schedule "30 18 * * 1-5" \
  --time-zone "America/Toronto" \
  --uri "${SERVICE_URL}/backfill/all?skip_fundamentals=true" \
  --http-method POST \
  --headers "X-Backfill-Token=${BACKFILL_TOKEN}" \
  --attempt-deadline 1800s \
  --max-retry-attempts 1

# Everything, including quarterly statements, profiles and dividends.
gcloud scheduler jobs create http margin-weekly \
  --location "$REGION" \
  --schedule "0 7 * * 6" \
  --time-zone "America/Toronto" \
  --uri "${SERVICE_URL}/backfill/all" \
  --http-method POST \
  --headers "X-Backfill-Token=${BACKFILL_TOKEN}" \
  --attempt-deadline 1800s \
  --max-retry-attempts 1

# Keep an instance alive during the hours anyone might click Run.
gcloud scheduler jobs create http margin-warm \
  --location "$REGION" \
  --schedule "*/5 9-20 * * *" \
  --time-zone "America/Toronto" \
  --uri "${SERVICE_URL}/health" \
  --http-method GET \
  --attempt-deadline 30s \
  --max-retry-attempts 0
```

Run each one by hand before trusting it:

```bash
gcloud scheduler jobs run margin-daily --location "$REGION"
gcloud scheduler jobs describe margin-daily --location "$REGION" --format 'value(status)'
```

### Why 18:30 rather than the plan's 06:30

The plan scheduled the daily job for 06:30 Tue–Sat, refreshing each weekday's
close the following morning. **18:30 Mon–Fri is better** and it is what these
commands use: the US session closes at 16:00 ET, Yahoo's daily bar settles
within half an hour, and 18:30 leaves two hours of margin. The difference is
that someone opening the link at 9pm on a Tuesday sees Tuesday's close rather
than Monday's, and the context strip reads hours old rather than a day old. On a
site whose top strip states its own freshness, that is the difference worth
paying for.

Saturday keeps the full run, because quarterly statements change four times a
year and the pass that fetches them takes ten minutes rather than two.

### `--attempt-deadline` is the flag that would have broken this

Cloud Scheduler's default deadline for an HTTP target is **180 seconds**. The
daily backfill takes about two minutes and would mostly squeak under it; the
weekly one takes ten and would be abandoned every single week, while the ingest
carried on running invisibly on the other end and the job reported failure.
1800s is the maximum Scheduler allows for an HTTP target, and it is also why
Cloud Run's own `--timeout` is set to 1800 in step 3: the two deadlines have to
agree or the shorter one silently defines the behaviour.

`--max-retry-attempts 1` on the backfills because the stages are idempotent
upserts, so a retry is safe; `0` on the keep-warm ping because a missed ping
matters for five minutes.

### If you would rather have a fourth job

The three-job free tier is the constraint, and the keep-warm ping is the one
worth exporting. A free UptimeRobot monitor on `${SERVICE_URL}/health` does the
same work, doubles as a public uptime badge for the README, and frees the slot
for a daily `POST /backfill/company-profile` — the cheap refresh of market cap
and sector, which currently only moves on Saturdays.

---

## 7. A tripwire on spend

Google has **no hard spending cap**. A budget alert is a notification, not a
brake; the actual defences are the four layers in §1.8 of the plan. Set it
anyway, because the alert is how you find out you were wrong about the layers.

Console → Billing → Budgets & alerts → Create budget: scope it to this project,
amount $5, alert thresholds at 20% and 100%. The $1 trigger is the useful one —
at the projected usage this project should never bill a cent, so a dollar means
something has changed.

---

## 8. Verification

```bash
# The writes are closed, and open to the token.
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SERVICE_URL/backfill/valuations"
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
     -H "X-Backfill-Token: $BACKFILL_TOKEN" "$SERVICE_URL/backfill/valuations"
# expect 401 then 200

# The solve is closed to anything that is not the dashboard.
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SERVICE_URL/efficient-frontier"
# expect 401

# The reads are open and compressed.
curl -s -H "Accept-Encoding: gzip" "$SERVICE_URL/valuations" \
     -o /dev/null -w "%{size_download} bytes\n"
# expect ~66 KB

# The whole app, through the front door.
WEB_URL=https://YOUR-APP.vercel.app API_URL=$SERVICE_URL \
  node .claude/skills/test-portfolio-optimizer/sweep.mjs
```

The sweep drives dozens of solves from one address, which is exactly what the
per-IP limiter exists to refuse. Set `RATE_LIMIT_SOLVES_PER_MINUTE=0` and
`RATE_LIMIT_SOLVES_PER_HOUR=0` on a Vercel **preview** deployment and sweep that,
rather than turning the limit off in production. `0` is the only value that
disables the limiter; blank now reads as unset and falls back to 10 and 60.

Then, in Cloud Run → Metrics, confirm the instance count returns to zero between
the keep-warm pings, and check the billing page after 48 hours.

---

## Notes from the first real run (2026-09-05)

Deployed to `value-investing-dash` (project number 161934570551), region
us-central1. Service URL:
`https://margin-solver-161934570551.us-central1.run.app`.

Four things the procedure above did not predict:

**`gcloud builds list` is empty for a `--source` deploy.** Source deploys run
through Cloud Build v2, which that command does not read, so it reports nothing
while the build is plainly running. `gcloud run operations` does not exist
either. The reliable "did the build finish" probe is the image itself:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$PROJECT/cloud-run-source-deploy
```

and then `gcloud run services list --region us-central1`, which stays blank
until a revision is serving. The whole build took about 3.5 minutes, nearly all
of it pip compiling scipy, cvxpy and clarabel.

**A revision goes Ready a second or two after the URL resolves.** Curling
`/health` at `07:31:47` returned 404; the Ready condition flipped at
`07:31:48`. A 404 straight after a deploy means "not yet", not "broken" — wait
and repeat before diagnosing anything.

**Cloud Scheduler's job status lags several minutes on a newly created job.**
A forced `jobs run` showed `status: {code: -1}` with no `lastAttemptTime` and
nothing in either service's logs for about four minutes, then the request
appeared at Cloud Run with a 200 and the status filled in. `code: -1` on a fresh
job is "no attempt recorded yet", not a failure.

**The Supabase key may be the short format.** `SUPABASE_SERVICE_ROLE_KEY` here
is an `sb_secret_…` string of 41 characters, not a ~220-character service-role
JWT. Both are valid; check it against PostgREST rather than by length:

```bash
curl -s -o /dev/null -w "%{http_code}" -H "apikey: $KEY" \
  "$SUPABASE_URL/rest/v1/company_profile?select=ticker&limit=1"
```

**Verified after deploy:** `/health` 200; `POST /backfill/*` 401 without a token
and 200 with the one in Secret Manager; `POST /efficient-frontier` 403 without
`X-Margin-Origin` and 200 with it; `/valuations` 200 at 66.7 KB gzipped; a
Cloud Scheduler ping reaching `/health` with a 200.

---

## What lives where, in one table

| variable | Cloud Run | Vercel | local |
|---|---|---|---|
| `SUPABASE_URL` | yes | — | `api/.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | **never** | `api/.env` |
| `NEXT_PUBLIC_SUPABASE_URL` | — | yes | `.env` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | — | yes | `.env` |
| `MARKET_DATA_API_URL` | — | yes | `.env` |
| `BACKFILL_TOKEN` | secret | unset | both |
| `MARGIN_ORIGIN_SECRET` | secret | yes | blank in both |
| `ALLOWED_ORIGINS` | yes | — | defaults |
| `ENABLE_DATA_PAGE` | — | unset | `true` |
| `RATE_LIMIT_SOLVES_PER_*` | — | 10 / 60 | `0` for the sweep |

`MARGIN_ORIGIN_SECRET` is the one that appears on both sides, and it has to be
the same string: Vercel sends it as `X-Margin-Origin`, Cloud Run compares it.
Locally both sides are blank, which makes the check a no-op so the sweep can
call the solver directly on :8000.

---

## One honest caveat about the warm cache

The `lifespan` hook pulls the full price frame onto a background thread at
startup, which locally turns a 6.8s cold solve into 0.25s. On Cloud Run with
request-based billing it will help less than that: CPU is allocated **during
requests**, and throttled to a trickle between them, so a thread started at boot
makes progress mainly while some other request happens to be in flight. A
0.1-second health ping grants it very little.

This is not worth engineering around, for one reason: the full-index solve that
a bare `/portfolio` visit asks for is served from `frontier_snapshot`, written by
the nightly job, and needs no price read at all. It comes back in about 0.25s
cold. The path that does pay is a *screened* set arriving from the screener's
call to action, which misses both the snapshot and the in-process cache — the
gap already noted in §1C.10 of the plan. If that turns out to be the common
arrival in practice, the fix is to precompute the screened default too, not to
fight the CPU throttle.

---

# The API end to end: a handoff

Everything above is how the solver got deployed. This is how it is *wired* —
what each page needs from it, what happens when it is asleep, how to push a
change to either side, and the six things that will bite you.

## 1. The shape

```
                 ┌──────────────────────────────┐
   browser ────► │  Vercel (Next.js App Router) │
                 │  · server components         │
                 │  · /api/* route handlers     │
                 └───────┬──────────────┬───────┘
                         │              │
              anon key   │              │  X-Margin-Origin
              + RLS      │              │  X-Backfill-Token
                         ▼              ▼
              ┌────────────────┐   ┌──────────────────┐
              │ Supabase       │◄──┤ Cloud Run        │
              │ Postgres       │   │ margin-solver    │
              └────────────────┘   └──────────────────┘
                                            ▲
                            Cloud Scheduler ─┘  (3 jobs)
```

**Two rules hold the whole design together.**

*The browser never learns the Cloud Run URL.* `MARKET_DATA_API_URL` is read
only inside route handlers and server components — never in a `"use client"`
file, never behind a `NEXT_PUBLIC_` prefix. That is what makes
`X-Margin-Origin` meaningful: the secret can only be attached by code running
on Vercel, so a request without it did not come from the dashboard.

*The dashboard reads Postgres directly wherever the answer is already stored.*
Next talks to Supabase with the publishable (anon) key over plain PostgREST
`fetch`, and row-level security is what makes that safe — `anon` may SELECT
`universe_snapshot`, `frontier_snapshot` and `daily_close_prices`, and nothing
else. `valuations`, `ticker_statistics`, `quarterly_fundamentals` and
`company_profile` all return `[]` to that key. The service role key, which
bypasses RLS entirely, exists only in `api/.env` and Secret Manager.

## 2. What each page actually needs

The important property, and the one worth protecting in any future change:
**two of the three pages render completely with Cloud Run scaled to zero.**

### `/screener` — never touches the solver

`app/screener/page.tsx` calls `loadUniverse()` (`lib/universe.ts`), which tries
three sources in order:

1. `universe_snapshot` row `id=1` via `selectSnapshotRow` — the normal path.
   One indexed row holding the whole scored payload the valuations backfill
   assembled: ~500 stocks, every verdict, `risk_free_rate`,
   `expected_market_return`, the `^GSPC` index level and the `job_runs`
   freshness block.
2. `GET /valuations` on Cloud Run — only if the snapshot row is missing.
3. `SAMPLE_UNIVERSE` — labelled "illustrative" on every surface that renders it.

Caching: `revalidate` 3600 in production, **0 in development**. The dev zero is
deliberate. In production nothing purges the tag — the snapshot is written by
Cloud Scheduler calling the service directly, with no Next in the chain to call
`revalidateTag` — so an hour is the true staleness window; locally that window
hides a backfill you just ran.

`selectSnapshotRow` retries once with `cache: "no-store"` when the first read
comes back **empty**. An empty result is a legitimate 200, so Next would
otherwise cache "there is no snapshot" for the full hour if one request landed
mid-write.

### `/stocks/[ticker]` — never touches the solver in practice

Server render: the same `loadUniverse()` call, which supplies the verdicts,
`beta`, `realisedReturn`, `riskFreeRate` and `marketReturn`.

Client fetch: `components/ticker-history.tsx` calls
`GET /api/close-history/[ticker]`, which reads the last 252 rows of
`daily_close_prices` straight from Postgres (`order=date.desc&limit=252`, then
reversed). Cloud Run's `GET /returns/{ticker}` is the fallback for the case the
anon path cannot cover — no Supabase credentials, or a database the solver can
reach and Vercel cannot.

This route used to proxy the solver unconditionally, which is why a
scaled-to-zero service produced a 502 on the price chart. The response now
carries closes and nothing else: every other figure the panel prints already
arrived with the server render, and fetching them twice let the two copies
disagree.

### `/portfolio` — the only page that needs the solver, and only sometimes

Server render: `loadUniverse()` again, for the valuations joined against the
holdings.

Client fetch: `POST /api/efficient-frontier`. That handler splits the traffic:

- **The default request** — no ticker list, `short_allowed=false`, blank
  min/max weight, gamma 0, and `n_portfolios` either absent or exactly
  `DEFAULT_PORTFOLIOS` — is answered from the `frontier_snapshot` row under the
  fixed key `"default"`, written nightly by `frontier.precompute_default()`.
  Measured at **0.24 s** with the solver dead. Before this path existed the same
  click cost **64.7 s** on Cloud Run.
- **Everything else** — any screened set, any changed constraint, any re-run —
  goes to Cloud Run. That is the right division: those are genuinely new work.

The stored payload is rewritten on the way out: `cached` is forced to `true`
(the scheduled run recorded it as a miss, because it did the work) and
`resolution_capped` to `false`.

## 3. Every route, and what guards it

| Next route | upstream | guard |
|---|---|---|
| `POST /api/efficient-frontier` | `frontier_snapshot`, else Cloud Run | per-IP rate limit, then `X-Margin-Origin` |
| `GET /api/close-history/[ticker]` | `daily_close_prices`, else Cloud Run | none needed — anon-readable, cached |
| `POST /api/backfill/*` (6) | Cloud Run | `ENABLE_DATA_PAGE`, then `X-Backfill-Token` |

`GET /api/valuations` and `GET /api/history/[ticker]` used to sit here too:
unguarded passthroughs left from before the snapshot read path, forwarding no
origin header and taking no rate limit. Nothing called either. **Both deleted**
— the whole Next surface that reaches Cloud Run is now the two rows above.

On the Python side (`api/main.py`):

| endpoint | guard |
|---|---|
| `GET /health`, `/valuations`, `/returns/{t}`, `/history/{t}`, `/quote/{t}`, `/info/{t}` | open, on purpose — cheap, cacheable, curl-able from the README |
| `POST /efficient-frontier` | `require_margin_origin` → 403 |
| `POST /backfill/*` (6) | `require_backfill_token` → 401, or 503 if the token is unset |

Both guards use `secrets.compare_digest`, and both are **no-ops when their
secret is unset** — which is what lets `pnpm dev` and the sweep script call a
local service with no configuration. That also means a Cloud Run deploy that
loses `MARGIN_ORIGIN_SECRET` silently opens the solve endpoint to the world
rather than failing loudly. Check it after any `--set-env-vars` edit, which
*replaces* rather than merges.

### The four cost layers, in the order a request meets them

1. **Per-IP rate limit** (`lib/rate-limit.ts`, on Vercel) — 10 solves/minute,
   60/hour, keyed off `x-forwarded-for`. In-memory per serverless instance, so
   imperfect across instances; Vercel's own DDoS protection sits in front.
   `0` disables it; blank falls back to the defaults rather than reading as
   zero, which is the bug that silently disabled the whole limiter once.
2. **The default-snapshot short circuit** — the most common request never
   reaches the solver at all.
3. **`POINT_BUDGET = 12_000`** (`api/frontier.py`) — points × assets. 499 names
   can only ever get ~24 points however many are asked for; a 20-name screened
   set still gets the full 200. Reported back as `n_portfolios_requested` and
   `resolution_capped`, and shown on the page.
4. **`SOLVE_BUDGET_SECONDS = 600` per rolling hour** — past it the solver
   answers 429 with `Retry-After`, which the Next route forwards verbatim.
   Cache hits and the precomputed default are exempt, because they cost no CPU.

## 4. How data reaches the warehouse

Cloud Scheduler → `POST /backfill/all` on Cloud Run → `backfill.everything()`,
which runs the stages in dependency order and does **not** stop when one fails
(the report says what happened to each), except that valuations are skipped when
every feeder failed.

```
daily_close_prices      ~30 s
factor_returns          ~4 s
quarterly_fundamentals  ~500 s   (skipped when skip_fundamentals=true)
valuations              ~60 s
  ├─ write_universe_snapshot()     → universe_snapshot   (id=1)
  └─ frontier.precompute_default() → frontier_snapshot   (2 rows)
```

`precompute_default()` writes the **same payload twice**: once under the hashed
cache key the solver's own probe looks up, once under the literal `"default"`
key the dashboard reads. The hash is a SHA-256 of canonical JSON; asking
TypeScript to reproduce it would be a contract in two languages that breaks
silently the first time either side reorders a field.

Every stage logs to `job_runs`, and `write_universe_snapshot()` bakes that table
into its payload — which is why the valuations run records itself *before*
writing the snapshot, or its own row would not appear until the next day.

## 5. Pushing a change

### To the solver

```bash
gcloud run deploy margin-solver --source api/ --region us-central1
```

Nothing else. Flags, secrets, service account and env vars are properties of the
service and survive a redeploy — **do not repeat `--set-env-vars`**, which
replaces the whole set rather than merging into it. Use
`--update-env-vars KEY=value` to change one.

Takes ~3.5 minutes, nearly all of it pip building scipy, cvxpy and clarabel.
`gcloud builds list` stays empty throughout (source deploys use Cloud Build v2,
which that command does not read) and `gcloud run operations` does not exist.
The reliable probe:

```bash
gcloud run services describe margin-solver --region us-central1 \
  --format 'value(status.latestReadyRevisionName)'
```

Traffic moves to the new revision automatically. A 404 on `/health` in the first
second or two after the URL resolves means "not Ready yet", not "broken".

**A code change alone does not update what the pages read.** The snapshots are
written by the backfill, so anything touching valuation logic, the universe
payload or the frontier defaults needs a run afterwards:

```bash
curl -s -X POST -H "X-Backfill-Token: $BACKFILL_TOKEN" \
     "$SERVICE_URL/backfill/valuations"      # ~60 s, rewrites both snapshots
```

That is the cheap one. `POST /backfill/all` is ten minutes and is only needed
when the *inputs* are stale.

### To the dashboard

`git push` — Vercel builds from the repo. Env changes take effect on the next
deploy, not immediately: a variable edited in the dashboard needs a redeploy to
be picked up.

### To the database

Migrations live in `supabase/migrations/`. The live database is shared with the
running dev servers, so additive-only during a session, and check the anon
surface after anything touching RLS:

```bash
# Must return rows
curl -s -H "apikey: $ANON" "$URL/rest/v1/universe_snapshot?select=id&limit=1"
# Must return []
curl -s -H "apikey: $ANON" "$URL/rest/v1/valuations?select=ticker&limit=1"
```

### The constants that must move together

| one side | the other |
|---|---|
| `ENVELOPE_POINTS` (`api/frontier.py`) | `DEFAULT_PORTFOLIOS` (`lib/portfolio-settings.ts`) |
| `MIN`/`MAX_ENVELOPE_POINTS` | `MIN`/`MAX_PORTFOLIOS` |
| `RETURNS_LOOKBACK_DAYS` (`api/market.py`) | `LOOKBACK_DAYS` (close-history route) |
| Cloud Run `--timeout 1800` | Scheduler `--attempt-deadline 1800s` |
| `MARGIN_ORIGIN_SECRET` on Cloud Run | the same string on Vercel |
| `maxDuration = 300` (frontier route) | `AbortSignal.timeout(280_000)` inside it |

The first row has already caused an outage-shaped bug twice, and it is the
subject of the first item below.

## 6. What to watch out for

**The default-frontier cache key is built from the *resolved* point count.**
Change `DEFAULT_PORTFOLIOS` without changing `ENVELOPE_POINTS`, redeploying and
re-running the backfill, and every default `/portfolio` visit either misses the
snapshot and pays a full solve, or — worse — hits it and renders a curve at the
wrong resolution while claiming to be the default.

**This is live right now.** Both constants read 10 in the repo, but the deployed
revision `margin-solver-00004-nz8` was built at 3, so the stored row is a
3-point curve:

```
frontier_snapshot['default']  n_portfolios=3  envelope=3  computed_at 11:09 UTC
POST /api/efficient-frontier?n_portfolios=10  →  n_portfolios 3, envelope 3, cached true
```

The page asks for 10, is served 3, and nothing on screen says why —
`resolution_capped` is forced false by the snapshot reader. It clears itself the
moment the solver is redeployed and `POST /backfill/valuations` re-runs. Until
then the default curve is coarser than the rail claims.

**The same redeploy owes a second debt.** `build()` now keeps each envelope
point's weights and risk decomposition instead of discarding them — the change
that lets `/portfolio` describe any portfolio on the curve rather than only its
two ends. Nothing new is computed for it; `trace_frontier` already solved those
weights, and the response is a few hundred KB larger for carrying them. Until
the deploy lands, the frontend degrades exactly as designed: the anchors stay
selectable, every point between them renders disabled, and no error is shown.
The stored snapshot needs the backfill afterwards for the same reason the
resolution does — the row is a payload, so a code change alone does not move it.
Both debts clear in one motion:

```bash
gcloud run deploy margin-solver --source api/ --region us-central1
curl -s -X POST -H "X-Backfill-Token: $BACKFILL_TOKEN" \
     "$SERVICE_URL/backfill/valuations"

# Then confirm both at once: 10 points, and weights on a point that is not an anchor.
curl -s -X POST -H 'content-type: application/json' -d '{}' \
     "http://localhost:3000/api/efficient-frontier?n_portfolios=10" |
  python -c "import json,sys; d=json.load(sys.stdin); e=d['envelope']; \
print('points', len(e), 'weighted', sum(1 for p in e if p.get('weights')))"
# expect: points 10 weighted 10
```

**`--set-env-vars` replaces; `--update-env-vars` merges.** The former is how you
lose `SUPABASE_URL` or, quietly, `MARGIN_ORIGIN_SECRET` — and an unset origin
secret does not fail, it turns the guard off.

**~~`SUPABASE_SERVICE_ROLE_KEY` is in the root `.env` and nothing reads it.~~**
**Removed.** `grep -rn SERVICE_ROLE app lib components` was already empty —
`lib/supabase.ts` uses only the two `NEXT_PUBLIC_` values — so the line was
harmless on disk and catastrophic on Vercel, one careless "copy my .env into
the project settings" away. `api/.env` keeps its own copy, which is the only
place the Python side ever read it from. Keep it that way: the root `.env` is
the file that gets pasted into a hosting dashboard.

**Local dev now points at Cloud Run.** `MARKET_DATA_API_URL` in `.env` is the
deployed service, so every screened solve from `localhost:3000` spends the live
hourly compute budget and counts against the free tier. Point it back at
`http://127.0.0.1:8000` whenever the local solver is running.

**The keep-warm ping buys less than it looks.** With request-based billing CPU
is throttled between requests, so the `lifespan` price-cache thread makes
progress mainly while some other request is in flight, and a 0.1-second health
ping grants it very little. This does not matter for the default frontier, which
needs no price read, and does matter for a screened set arriving from the
screener's CTA — which misses both the snapshot and the in-process cache. If
that becomes the common arrival, precompute the screened default too rather than
fighting the throttle.

**`margin-weekly` has not yet been observed completing.** It fires `0 7 * * 6`
America/Toronto (11:00 UTC Saturday) and is the only ten-minute request in the
system, so it is the one job whose `--attempt-deadline` has never been tested
against a real run.
