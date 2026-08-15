// Minimal Playwright driver for value-investing-dash.
// Usage: node driver.mjs <script.txt> [outDir]
//   script.txt: one command per line (blank lines / lines starting with # ignored)
// Commands:
//   nav <path-or-url>                 navigate (bare path resolves against BASE_URL, default http://localhost:3000)
//   wait <selector>                   wait for selector to be visible (no spaces; use placeholder=/text= below for those)
//   waittext <text>                   wait for text to be visible anywhere on page
//   click <selector>                  click selector (CSS, or text=..., or role=button[name="..."])
//   placeholder=<placeholder text>    as a selector arg: resolves via page.getByPlaceholder()
//   fill <selector>|<text>            fill input; selector and text separated by a pipe "|"
//   press <key>                       press key on focused element
//   screenshot <name>                 save PNG to outDir/name.png
//   console                           print any page console errors seen so far
//   sleep <ms>                        raw wait, use sparingly
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const [, , scriptPath, outDirArg] = process.argv;
if (!scriptPath) {
  console.error("usage: node driver.mjs <script.txt> [outDir]");
  process.exit(1);
}
const outDir = outDirArg || "./shots";
fs.mkdirSync(outDir, { recursive: true });

const lines = fs
  .readFileSync(scriptPath, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

function splitOnce(s) {
  const i = s.indexOf(" ");
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

function locatorFor(selector) {
  if (selector.startsWith("placeholder=")) {
    return page.getByPlaceholder(selector.slice("placeholder=".length));
  }
  if (selector.startsWith("text=")) {
    return page.getByText(selector.slice("text=".length));
  }
  return page.locator(selector);
}

try {
  for (const line of lines) {
    const [cmd, rest] = splitOnce(line);
    switch (cmd) {
      case "nav": {
        const url = /^https?:\/\//.test(rest) ? rest : BASE_URL + rest;
        await page.goto(url, { waitUntil: "domcontentloaded" });
        break;
      }
      case "wait":
        await locatorFor(rest).first().waitFor({ state: "visible", timeout: 15000 });
        break;
      case "waittext":
        await page.getByText(rest).first().waitFor({ state: "visible", timeout: 15000 });
        break;
      case "click":
        await locatorFor(rest).first().click({ timeout: 15000 });
        break;
      case "fill": {
        const sepIdx = rest.indexOf("|");
        const sel = rest.slice(0, sepIdx);
        const text = rest.slice(sepIdx + 1);
        await locatorFor(sel).first().fill(text, { timeout: 15000 });
        break;
      }
      case "press":
        await page.keyboard.press(rest);
        break;
      case "screenshot": {
        const file = path.join(outDir, `${rest || "screenshot"}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`screenshot -> ${file}`);
        break;
      }
      case "console":
        console.log("console errors so far:", JSON.stringify(consoleErrors, null, 2));
        break;
      case "sleep":
        await page.waitForTimeout(Number(rest));
        break;
      default:
        console.error(`unknown command: ${cmd}`);
    }
  }
  if (consoleErrors.length) {
    console.log("=== console errors ===");
    console.log(consoleErrors.join("\n"));
  } else {
    console.log("=== no console errors ===");
  }
} finally {
  await browser.close();
}
