---
name: run-value-investing-dash
description: Build, run, and drive value-investing-dash (the Next.js stock-valuation dashboard). Use when asked to start the app, run its dev server, lint/build it, take a screenshot of the dashboard, or verify a UI change actually renders.
---

Next.js 16 (App Router, Turbopack) app. Drive it by starting `pnpm dev`
and scripting a headless Chromium session against it with
`.claude/skills/run-value-investing-dash/driver.mjs` (a small Playwright
runner committed in this skill dir — `chromium-cli` is not available in
this environment, so this driver stands in for it).

All paths below are relative to the repo root.

## Prerequisites

Node.js and pnpm (`pnpm@10.13.1`, pinned via `packageManager` in
`package.json`) must be installed. This repo already has `playwright`
as a devDependency; if it's missing, add it and download the browser:

```bash
pnpm add -D playwright
npx playwright install chromium
```

(`npx playwright install chromium` must be run *after* `pnpm install` —
running it first errors out looking for a project-local Playwright.)

## Setup

```bash
pnpm install
```

No env vars are required to run the app locally. (There's a `supabase/`
directory with a `config.toml` but no code currently talks to Supabase —
nothing to configure for the dashboard to render.)

## Run (agent path)

1. Start the dev server in the background and wait for it to serve:

```bash
pnpm dev &
timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'
```

Stop it when done by killing whatever is listening on port 3000
(`pnpm dev` wraps `next dev`, which doesn't die from killing the pnpm
wrapper's `$!` alone):

```bash
# Windows/Git Bash:
netstat -ano | grep ':3000' | grep LISTENING   # note the PID in the last column
taskkill //F //PID <pid>
# Linux/macOS:
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill
```

2. Write a small command script (one command per line) and run it
   through the driver:

```bash
cat > /tmp/smoke.txt <<'EOF'
nav /dashboard
wait placeholder=Stock Ticker
screenshot dashboard
fill placeholder=Stock Ticker|AAPL
click text=View
screenshot dashboard-after-click
console
EOF

node .claude/skills/run-value-investing-dash/driver.mjs /tmp/smoke.txt /tmp/shots
```

Screenshots land in the output dir you pass as the 2nd arg (`/tmp/shots`
above); the driver prints the path of each one as it's taken, and
prints any browser console errors it saw at the end.

Driver commands:

| command | what it does |
|---|---|
| `nav <path-or-url>` | navigate; bare paths resolve against `http://localhost:3000` (override with `BASE_URL` env var) |
| `wait <selector>` | wait for a selector to become visible |
| `waittext <text>` | wait for text to appear anywhere on the page |
| `click <selector>` | click; selector can be CSS, `text=...`, `placeholder=...`, or Playwright engine syntax like `role=button[name="..."]` |
| `fill <selector>\|<text>` | fill an input — selector and value are separated by a literal `\|` |
| `press <key>` | press a key on the focused element |
| `screenshot <name>` | full-page PNG to `<outDir>/<name>.png` |
| `console` | print browser console errors collected so far |
| `sleep <ms>` | raw wait — use only when no selector-based wait applies |

## Run (human path)

```bash
pnpm dev
```

Opens a dev server at http://localhost:3000. `/` is the stock create-next-app
placeholder page; `/dashboard` is the actual app (ticker input + View
button + dark-mode toggle). Ctrl-C to stop.

## Test / Lint / Build

```bash
pnpm lint    # currently FAILS — see Gotchas
pnpm build   # not verified by this skill; not exercised above
```

---

## Gotchas

- **`pnpm lint` currently fails** on `components/theme-toggle.tsx:20`
  (`react-hooks/set-state-in-effect`: calling `setState` synchronously
  inside a `useLayoutEffect`). This is pre-existing app code, not a
  driver/skill issue — don't treat a red `pnpm lint` as the driver being
  broken.
- **Selectors with spaces need the `placeholder=`/`text=` prefixes**,
  not raw CSS attribute selectors — the driver's line parser splits
  commands on the first space, so `input[placeholder="Stock Ticker"]`
  as a bare CSS string breaks mid-token. Use `placeholder=Stock Ticker`
  instead (see driver's `locatorFor`).
- **`npx playwright install` before `pnpm install`** prints a warning
  and resolves browser binaries from a global cache path rather than
  the project — run `pnpm install` (or at least `pnpm add -D playwright`)
  first so the install is tied to this project's Playwright version.
- **This repo has no `AGENTS.md`-documented custom Next.js behavior**
  beyond the standard docs bundled at `node_modules/next/dist/docs/` —
  nothing in the current `/` or `/dashboard` pages relies on
  Next.js APIs that diverge from upstream docs.
