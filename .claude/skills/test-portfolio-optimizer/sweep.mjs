// Recursive sweep over the portfolio optimiser.
//
// The optimiser's failures were never uniform: they depended on how many
// stocks the screener handed over and on what those stocks looked like. A
// handful of hand-picked tickers therefore proves nothing. This sweeps the
// real screened universe across many sizes and many tilts, and when a case
// fails it bisects the ticker list to find the smallest set that still
// reproduces it.
//
// Usage:
//   node sweep.mjs [--mode api|ui|both] [--cases N] [--seed N] [--quick]
//                  [--soak N] [--concurrency N]
//
// Env: WEB_URL (default http://localhost:3000), API_URL (default http://127.0.0.1:8000)

import { chromium } from "playwright";

const WEB_URL = process.env.WEB_URL || "http://localhost:3000";
const API_URL = process.env.API_URL || "http://127.0.0.1:8000";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const MODE = flag("mode", "both");
const SEED = Number(flag("seed", 7));
const QUICK = args.includes("--quick");
const MAX_CASES = Number(flag("cases", QUICK ? 12 : 60));
// The soak is a separate axis from the case matrix. See runSoak.
const SOAK = Number(flag("soak", 0));
const CONCURRENCY = Number(flag("concurrency", 6));

// Deterministic PRNG so a failing sweep can be replayed exactly.
let seedState = SEED;
function random() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function sample(pool, n) {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function loadUniverse() {
  const res = await fetch(`${API_URL}/valuations`);
  if (!res.ok) throw new Error(`GET /valuations -> ${res.status}`);
  const body = await res.json();
  return body.stocks;
}

/**
 * The tilts matter more than the sizes. A value screen selects names on
 * cheapness, which correlates with weak trailing returns — and that is exactly
 * the input that used to leave the tangency portfolio with no feasible
 * solution. "Random" alone would have missed the bug entirely.
 */
function buildCases(stocks) {
  const byWorstReturn = [...stocks].sort(
    (a, b) => (a.realisedReturn ?? 0) - (b.realisedReturn ?? 0)
  );
  const byBestReturn = [...byWorstReturn].reverse();
  const byCheapest = [...stocks].sort(
    (a, b) => (a.peRatio ?? 1e9) - (b.peRatio ?? 1e9)
  );
  const byMostVolatile = [...stocks].sort(
    (a, b) => (b.volatility ?? 0) - (a.volatility ?? 0)
  );
  const tickers = (list, n) => list.slice(0, n).map((s) => s.ticker);

  const sizes = QUICK
    ? [5, 10, 34, 60, 200]
    : [5, 6, 8, 10, 12, 15, 20, 25, 30, 33, 34, 40, 60, 100, 200, 400, stocks.length];

  const cases = [];
  for (const size of sizes) {
    const n = Math.min(size, stocks.length);
    cases.push({ name: `worst-return/${n}`, tickers: tickers(byWorstReturn, n) });
    cases.push({ name: `cheapest-pe/${n}`, tickers: tickers(byCheapest, n) });
    cases.push({ name: `random/${n}`, tickers: sample(stocks, n).map((s) => s.ticker) });
    if (!QUICK) {
      cases.push({ name: `best-return/${n}`, tickers: tickers(byBestReturn, n) });
      cases.push({ name: `most-volatile/${n}`, tickers: tickers(byMostVolatile, n) });
    }
  }

  // Sector slices: a real screen often collapses onto one industry, which
  // makes the covariance matrix nearly singular.
  const sectors = {};
  for (const s of stocks) (sectors[s.sector] ??= []).push(s.ticker);
  for (const [sector, list] of Object.entries(sectors)) {
    if (list.length >= 5) cases.push({ name: `sector:${sector}/${list.length}`, tickers: list });
  }

  // Shape edge cases that the UI can actually produce.
  cases.push({ name: "duplicates", tickers: [...tickers(byWorstReturn, 8), ...tickers(byWorstReturn, 8)] });
  cases.push({ name: "unknown-mixed", tickers: [...tickers(byWorstReturn, 8), "ZZZZ", "NOTAREALTICKER"] });
  cases.push({ name: "below-minimum", tickers: tickers(byWorstReturn, 2), expectReject: true });

  return cases.slice(0, MAX_CASES);
}

async function callApi(tickers, { shortAllowed = false, nPortfolios = 60 } = {}) {
  const query = new URLSearchParams({
    short_allowed: String(shortAllowed),
    n_portfolios: String(nPortfolios),
    tickers: tickers.join(","),
  });
  const started = Date.now();
  const res = await fetch(`${WEB_URL}/api/efficient-frontier?${query}`, { method: "POST" });
  const raw = await res.text();
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: res.status, ms: Date.now() - started, reason: `non-JSON body: ${raw.slice(0, 120)}` };
  }
  return { ok: res.ok, status: res.status, ms: Date.now() - started, body };
}

/**
 * A 200 is necessary but not sufficient — a frontier can come back structurally
 * broken and still render as a plausible squiggle. These are the invariants the
 * chart depends on.
 */
function checkInvariants(body) {
  const problems = [];
  const env = body.envelope ?? [];
  if (env.length < 1) problems.push("empty envelope");

  const bad = env.find(
    (p) => !Number.isFinite(p.return) || !Number.isFinite(p.volatility) || p.volatility < 0
  );
  if (bad) problems.push(`non-finite/negative point ${JSON.stringify(bad)}`);

  for (let i = 1; i < env.length; i++) {
    if (env[i].return < env[i - 1].return - 1e-6) {
      problems.push(`frontier returns go backwards at ${i}`);
      break;
    }
  }

  const ms = body.max_sharpe;
  if (!ms) problems.push("no max_sharpe");
  else {
    const best = Math.max(...env.map((p) => p.sharpe));
    // The CML is drawn through the tangency point; if any plotted portfolio
    // beat it, the line would visibly cut through the curve.
    if (ms.sharpe < best - 1e-6) problems.push(`tangency (${ms.sharpe.toFixed(4)}) beaten by an envelope point (${best.toFixed(4)})`);
    const sum = Object.values(ms.weights ?? {}).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.02) problems.push(`weights sum to ${sum.toFixed(4)}`);
    const cap = body.max_stock_weight ?? 0.03;
    const over = Object.entries(ms.weights ?? {}).filter(([, w]) => Math.abs(w) > cap + 1e-3);
    if (over.length) problems.push(`${over.length} weights exceed the ${cap} cap`);
  }

  if (body.tangency_beats_risk_free === false && (body.capital_market_line ?? []).length) {
    problems.push("CML drawn despite no tangency");
  }
  if (body.tangency_beats_risk_free === true && (body.capital_market_line ?? []).length !== 2) {
    problems.push("tangency exists but CML missing");
  }
  return problems;
}

/**
 * Shrink a failing ticker list to a minimal one that still fails. Halves the
 * set, keeps whichever half reproduces, and recurses; if neither half does
 * alone the failure needs both, so the current set is already minimal.
 */
async function bisect(tickers, depth = 0) {
  if (depth > 8 || tickers.length <= 5) return tickers;
  const mid = Math.ceil(tickers.length / 2);
  for (const half of [tickers.slice(0, mid), tickers.slice(mid)]) {
    if (half.length < 5) continue;
    const result = await callApi(half);
    // Mirror the sweep's definition of failure: a reasoned 422 is not one.
    const declined = result.status === 422 && result.body?.detail;
    const failed =
      (!result.ok && !declined) ||
      (result.ok && result.body && checkInvariants(result.body).length > 0);
    if (failed) return bisect(half, depth + 1);
  }
  return tickers;
}

async function runApiSweep(cases) {
  const failures = [];
  console.log(`\n── API sweep (${cases.length} cases via ${WEB_URL}) ──`);
  for (const testCase of cases) {
    const result = await callApi(testCase.tickers);

    if (testCase.expectReject) {
      const ok = result.status === 422;
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${testCase.name.padEnd(28)} expected rejection, got ${result.status}`);
      if (!ok) failures.push({ ...testCase, reason: `expected 422, got ${result.status}` });
      continue;
    }

    // A 422 carrying a reason is a considered refusal, not a breakage: too few
    // usable tickers is a real answer to a real request. The bar here is that
    // the optimiser never crashes and never returns something unexplained, so
    // these are reported but do not fail the sweep. A 5xx always fails.
    if (result.status === 422 && result.body?.detail) {
      console.log(`  decl  ${testCase.name.padEnd(28)} ${String(result.body.detail).slice(0, 88)}`);
      continue;
    }

    if (!result.ok) {
      const reason = result.reason ?? result.body?.detail ?? `HTTP ${result.status}`;
      console.log(`  FAIL  ${testCase.name.padEnd(28)} ${String(reason).slice(0, 90)}`);
      const minimal = await bisect(testCase.tickers);
      failures.push({ ...testCase, reason, minimal });
      console.log(`        minimal reproducing set (${minimal.length}): ${minimal.join(",")}`);
      continue;
    }

    const problems = checkInvariants(result.body);
    const b = result.body;
    const summary =
      `n=${String(b.n_assets).padStart(3)} cap=${(b.max_stock_weight ?? 0).toFixed(3)} ` +
      `sharpe=${b.max_sharpe.sharpe.toFixed(3).padStart(7)} cml=${(b.capital_market_line ?? []).length ? "yes" : "no "} ` +
      `${String(result.ms).padStart(6)}ms`;

    if (problems.length) {
      console.log(`  FAIL  ${testCase.name.padEnd(28)} ${summary}  <- ${problems.join("; ")}`);
      failures.push({ ...testCase, reason: problems.join("; ") });
    } else {
      console.log(`  pass  ${testCase.name.padEnd(28)} ${summary}`);
    }
  }
  return failures;
}

async function runUiSweep(cases) {
  console.log(`\n── UI sweep (${cases.length} cases via ${WEB_URL}) ──`);
  const browser = await chromium.launch();
  const failures = [];

  for (const testCase of cases) {
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    try {
      const url = `${WEB_URL}/portfolio?tickers=${testCase.tickers.join(",")}`;
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

      // "This page isn't working" is what a non-2xx navigation looks like.
      if (response && response.status() >= 400) {
        throw new Error(`navigation returned HTTP ${response.status()}`);
      }

      const button = page.getByRole("button", { name: /Run optimisation/i });
      await button.waitFor({ state: "visible", timeout: 30_000 });

      // Wait on the request itself, not on the button's label. A click that
      // lands before hydration does nothing at all, and label-watching reads
      // that as "already finished" — which reported a hydration race as an
      // optimiser failure. Arming the listener before clicking also closes the
      // gap where a fast solve returns before we start waiting.
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes("/api/efficient-frontier"),
        { timeout: 280_000 }
      );
      await button.click();
      await responsePromise;

      // Then let React settle the result into the DOM.
      await page.waitForFunction(
        () => {
          const b = [...document.querySelectorAll("button")].find((el) =>
            /Run optimisation|Optimising/.test(el.textContent ?? "")
          );
          return b && !/Optimising/.test(b.textContent ?? "");
        },
        { timeout: 30_000 }
      );

      const errorText = await page
        .locator("p.text-destructive")
        .first()
        .textContent()
        .catch(() => null);
      const hasChart = (await page.locator("svg.recharts-surface").count()) > 0;
      const stillBaseline = await page
        .getByText("Showing an illustrative baseline frontier")
        .isVisible()
        .catch(() => false);

      // Same distinction the API sweep makes: a stated refusal is a correct
      // outcome, as long as the page says so rather than dying or quietly
      // passing the baseline chart off as the answer.
      const declined =
        errorText && /can be optimised|Need at least/.test(errorText);

      const problems = [];
      if (errorText && !declined) problems.push(`error shown: ${errorText.trim().slice(0, 100)}`);
      if (!hasChart) problems.push("no chart rendered");
      if (stillBaseline && !declined) problems.push("still showing the baseline — live solve did not land");
      if (pageErrors.length) problems.push(`page error: ${pageErrors[0].slice(0, 100)}`);
      if (declined) {
        const disclaimed = await page
          .getByText("not a result for this set")
          .isVisible()
          .catch(() => false);
        if (!disclaimed) problems.push("refusal shown but the stale chart is not disclaimed");
      }

      if (problems.length) {
        console.log(`  FAIL  ${testCase.name.padEnd(28)} ${problems.join("; ")}`);
        failures.push({ ...testCase, reason: problems.join("; ") });
      } else if (declined) {
        console.log(`  decl  ${testCase.name.padEnd(28)} refused with a reason, stale chart disclaimed`);
      } else {
        console.log(`  pass  ${testCase.name.padEnd(28)} chart rendered, no errors`);
      }
    } catch (err) {
      console.log(`  FAIL  ${testCase.name.padEnd(28)} ${String(err.message).slice(0, 110)}`);
      failures.push({ ...testCase, reason: err.message });
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return failures;
}

/**
 * Repeat one ordinary request until something breaks.
 *
 * Not redundant with the case matrix. The matrix varies *what* is asked; this
 * varies *how many times*, because one whole class of failure had nothing to
 * do with the request at all. The Supabase client holds a single pooled HTTP/2
 * connection, and PostgREST retires it with GOAWAY after a few hundred
 * streams. Whichever request was in flight at that moment died with
 * `RemoteProtocolError` and a 500.
 *
 * Every case in the matrix passed throughout, because each one is a handful of
 * requests against a young connection. What surfaced it was volume. The
 * failure is also why the bug was mis-reported as a ticker-count threshold:
 * the reader's nineteen-stock run happened to land early and their twenty-stock
 * runs happened to land late, so the connection's age looked like the
 * optimiser's arithmetic.
 *
 * Roughly 400 requests is enough to cross the GOAWAY boundary on a cold start.
 */
async function runSoak(stocks, n) {
  const tickers = sample(stocks.map((s) => s.ticker), 20);
  console.log(`
── soak (${n} requests, concurrency ${CONCURRENCY}) ──`);
  console.log(`  ${tickers.length} tickers, watching for connection-age failures`);

  const failures = [];
  const seen = new Map();
  let issued = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (issued < n) {
        const index = ++issued;
        const result = await callApi(tickers).catch((err) => ({
          ok: false,
          status: "throw",
          reason: String(err),
        }));
        if (result.status === 200) continue;
        const key = `${result.status} ${String(result.body?.detail ?? result.reason ?? "").slice(0, 90)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (failures.length === 0) {
          failures.push({
            name: `soak/${tickers.length}`,
            reason: `failed at request ~${index} of ${n}: ${key}`,
          });
        }
      }
    })
  );

  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (failures.length === 0) {
    console.log(`  pass  ${n} requests, 0 failures, ${secs}s`);
  } else {
    for (const [key, count] of seen) console.log(`  FAIL  x${count} ${key}`);
  }
  return failures;
}

/**
 * The screener's own handoff link, which no other phase touches.
 *
 * Both other phases build their URLs themselves, so both missed this: the
 * screener used to hand over `?tickers=A,AAPL,ABBV,…`, and a screen that
 * passes most of the index made that ~3KB. Next echoes the URL into the
 * request line, `Next-Url` and `Referer`, so 3KB of query string spends ~9.2KB
 * of Node's 16KB header budget; cookies pushed it over and the server answered
 * 431, which the browser renders as a dead page.
 *
 * The budget check is the regression guard. It is deliberately about the size
 * of the link rather than about whether the click happened to work, because
 * whether it works depends on how many cookies the reader is carrying — the
 * bug reproduced for them and not in a clean browser.
 */
const HANDOFF_BUDGET_BYTES = 512;
/**
 * The same budget, for the *outgoing solve request* rather than the link.
 *
 * Fixing the link left the identical bug one layer down: the page URL became a
 * 110-byte token, but the fetch it triggers still spelled out every ticker, so
 * `POST /api/efficient-frontier?…` was a ~3KB URL. A URL is a header — it sits
 * in the request line and counts against the same 16KB budget as cookies — so
 * at ~13KB of cookies on localhost the request 431'd before reaching the
 * optimiser, and the page reported it as the optimiser failing.
 *
 * The ticker list travels in the POST body now. This budget is what keeps it
 * there: any attempt to put an unbounded list back in the query string fails
 * here rather than in someone's browser six months later.
 */
const REQUEST_BUDGET_BYTES = 256;

async function runHandoffCheck() {
  console.log(`
── screener handoff (${WEB_URL}/screener) ──`);
  const failures = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${WEB_URL}/screener`, { waitUntil: "networkidle", timeout: 90_000 });
    const link = page.locator('a[href*="/portfolio?"]').filter({ hasText: /Optimise all/i }).first();
    await link.waitFor({ state: "attached", timeout: 20_000 });
    const href = await link.getAttribute("href");
    const label = (await link.innerText()).trim().replace(/\s+/g, " ");

    if (href.length > HANDOFF_BUDGET_BYTES) {
      console.log(`  FAIL  ${label} -> href is ${href.length}B (budget ${HANDOFF_BUDGET_BYTES}B)`);
      failures.push({
        name: "screener-handoff",
        reason: `handoff href is ${href.length}B, over the ${HANDOFF_BUDGET_BYTES}B budget; a large screen will 431`,
      });
    } else {
      console.log(`  pass  ${label} -> href ${href.length}B, within budget`);
    }

    // The link must also still carry the right set through a reload.
    await link.click();
    await page.waitForTimeout(2500);
    const handed = await page.locator("text=/stocks handed over/i").first().innerText().catch(() => "");
    const count = Number(handed.match(/(\d+)\s+stocks/)?.[1] ?? 0);
    const expected = Number(label.match(/(\d+)/)?.[1] ?? -1);
    if (count !== expected) {
      console.log(`  FAIL  handed over ${count} stocks, link promised ${expected}`);
      failures.push({ name: "screener-handoff", reason: `decoded ${count} stocks, expected ${expected}` });
    } else {
      console.log(`  pass  handed over ${count} stocks, matching the link`);
    }

    // Solving the widest set the app can produce is the only place the request
    // URL reaches its worst case, so the size guard lives here rather than in
    // runControlsCheck, which works from a 19-stock subset.
    await page.locator("#n-portfolios").fill("10");
    let requestUrl = "";
    page.on("request", (r) => {
      if (r.url().includes("/api/efficient-frontier")) requestUrl = r.url();
    });
    const pending = page.waitForResponse(
      (r) => r.url().includes("/api/efficient-frontier"),
      { timeout: 280_000 }
    );
    await page.getByRole("button", { name: /Run optimisation/i }).click();
    const solve = await pending;
    const urlBytes = new URL(requestUrl).pathname.length + new URL(requestUrl).search.length;
    if (urlBytes > REQUEST_BUDGET_BYTES || solve.status() !== 200) {
      console.log(`  FAIL  solve request URL ${urlBytes}B (budget ${REQUEST_BUDGET_BYTES}B), HTTP ${solve.status()}`);
      failures.push({
        name: "solve-request-size",
        reason: `request URL is ${urlBytes}B over ${count} stocks; a reader with ~13KB of cookies will get 431`,
      });
    } else {
      console.log(`  pass  solve request URL ${urlBytes}B over ${count} stocks, HTTP 200`);
    }
  } catch (err) {
    console.log(`  FAIL  ${String(err.message).slice(0, 110)}`);
    failures.push({ name: "screener-handoff", reason: err.message });
  } finally {
    await browser.close();
  }
  return failures;
}

/**
 * The optimiser's exposed constraints, driven through the real controls.
 *
 * Neither other phase touches them: the API sweep sends its own query strings,
 * and the UI sweep only clicks Run at the defaults. So nothing else notices if
 * a control stops reaching the solver — and a position-size box that silently
 * does nothing is worse than one that is missing, because the reader believes
 * the portfolio was built the way the form says it was.
 *
 * Every assertion is on the *solved weights*, not on the request. Checking
 * that the query string carried `max_weight=0.08` proves the form works and
 * says nothing about whether the constraint was enforced.
 */
async function runControlsCheck(stocks) {
  const subset = stocks.slice(0, 19).map((s) => s.ticker);
  const url = `${WEB_URL}/portfolio?tickers=${subset.join(",")}`;
  console.log(`\n── optimiser controls (${subset.length} stocks) ──`);

  const failures = [];
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const record = (ok, label, detail) => {
    console.log(`  ${ok ? "pass" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push({ name: `controls/${label}`, reason: detail ?? label });
  };

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page.locator("#n-portfolios").fill("25");

    const run = async () => {
      const pending = page.waitForResponse(
        (r) => r.url().includes("/api/efficient-frontier"),
        { timeout: 280_000 }
      );
      await page.getByRole("button", { name: /Run optimisation/i }).click();
      const res = await pending;
      await page
        .getByRole("button", { name: /Run optimisation/i })
        .waitFor({ timeout: 60_000 });
      return { status: res.status(), body: await res.json().catch(() => null) };
    };
    const weightsOf = (body) => Object.values(body.max_sharpe.weights);

    let r = await run();
    record(r.status === 200, "defaults solve", `HTTP ${r.status}`);
    const rc = r.body?.max_sharpe?.risk_contributions ?? {};
    const rcSum = Object.values(rc).reduce((a, b) => a + b, 0);
    record(
      Object.keys(rc).length > 0 && Math.abs(rcSum - 1) < 0.01,
      "risk contributions sum to 1",
      rcSum.toFixed(4)
    );
    record(
      Object.keys(r.body?.sectors ?? {}).length > 0,
      "sectors present for the holdings"
    );

    // The echoed cap is checked alongside the weights because the automatic
    // cap for this universe is ~7.9%: a solve that ignored the box entirely
    // still lands under 8%, so the weight check alone passes a broken build.
    await page.locator("#max-weight").fill("8");
    r = await run();
    const largest = Math.max(...weightsOf(r.body));
    record(
      largest <= 0.0801 && r.body?.max_stock_weight === 0.08,
      "max position enforced",
      `largest ${(largest * 100).toFixed(2)}%, cap ${r.body?.max_stock_weight}`
    );

    await page.locator("#min-weight").fill("2");
    await page.locator("#max-weight").fill("12");
    r = await run();
    const smallest = Math.min(...weightsOf(r.body));
    record(
      smallest >= 0.0199 && Object.keys(r.body.max_sharpe.weights).length === r.body.n_assets,
      "min position holds every name",
      `smallest ${(smallest * 100).toFixed(2)}%`
    );

    await page.locator("#min-weight").fill("-3");
    r = await run();
    const shorts = weightsOf(r.body).filter((w) => w < 0);
    record(
      shorts.length > 0 && Math.min(...weightsOf(r.body)) >= -0.0301,
      "negative bound opens short positions",
      `${shorts.length} short`
    );

    await page.locator("#min-weight").fill("");
    await page.locator("#max-weight").fill("20");
    await page.locator("#gamma").fill("2");
    r = await run();
    record(r.body?.l2_gamma === 2, "gamma reaches the solver", `echoed ${r.body?.l2_gamma}`);

    // An infeasible cap must come back as a stated refusal naming the number
    // to change, not as a dead page or a stale chart passed off as an answer.
    await page.locator("#gamma").fill("0");
    await page.locator("#max-weight").fill("1");
    r = await run();
    const detail = await page.locator("p.text-destructive").first().textContent().catch(() => "");
    record(
      r.status === 422 && /Raise it to at least/.test(detail ?? ""),
      "infeasible cap is refused with a threshold",
      `HTTP ${r.status}`
    );

    // And the browser must not even send a request it can already tell is bad.
    await page.locator("#n-portfolios").fill("999");
    record(
      await page.getByRole("button", { name: /Run optimisation/i }).isDisabled(),
      "invalid field blocks the run"
    );
  } catch (err) {
    console.log(`  FAIL  ${String(err.message).slice(0, 110)}`);
    failures.push({ name: "controls", reason: err.message });
  } finally {
    await browser.close();
  }
  return failures;
}

const stocks = await loadUniverse();
console.log(`universe: ${stocks.length} screened stocks`);
const cases = buildCases(stocks);

let failures = [];
if (MODE === "api" || MODE === "both") failures.push(...(await runApiSweep(cases)));
if (SOAK > 0) failures.push(...(await runSoak(stocks, SOAK)));
if (MODE === "ui" || MODE === "both") failures.push(...(await runHandoffCheck()));
if (MODE === "ui" || MODE === "both") failures.push(...(await runControlsCheck(stocks)));
if (MODE === "ui" || MODE === "both") {
  // The UI path is slow, so it runs a representative slice rather than all of
  // them; the API sweep above already covers the full matrix.
  const uiCases = cases.filter((c) => !c.expectReject).slice(0, QUICK ? 3 : 8);
  failures.push(...(await runUiSweep(uiCases)));
}

console.log(`\n${"=".repeat(60)}`);
if (failures.length === 0) {
  console.log(`ALL PASS — ${cases.length} cases, no failures.`);
} else {
  console.log(`${failures.length} FAILURE(S):`);
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.reason}`);
    if (f.minimal) console.log(`      minimal: ${f.minimal.join(",")}`);
  }
  process.exitCode = 1;
}
