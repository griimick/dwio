// Browser round-trip check: open a file, add a shape, assert it hit disk, then edit externally and assert reload.
// Not part of `npm run check` (needs Playwright + a browser):  npx -p playwright node scripts/e2e.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const file = join(mkdtempSync(join(tmpdir(), "drawio-e2e-")), "e2e.drawio.svg");
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const proc = spawn("node", [cli, file, "--no-open", "--json"], { stdio: ["ignore", "pipe", "inherit"] });
const browser = await chromium.launch();
try {
  const { url } = JSON.parse(await new Promise((r) => proc.stdout.once("data", (d) => r(d.toString()))));
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const status = (prefix, timeout = 15000) =>
    page.waitForFunction((p) => document.querySelector("#status").textContent.startsWith(p), prefix, { timeout });

  await page.goto(url);
  await status("loaded", 30000);
  await page.frameLocator("#editor").locator(".geSidebar a.geItem").first().click();
  await status("saved");
  const svg = readFileSync(file, "utf8");
  assert.match(svg, /<svg[^>]*content="/);
  assert.ok(svg.includes("vertex=&quot;1&quot;"), "shape persisted as uncompressed XML");

  const reloaded = status("loaded", 10000);
  writeFileSync(file, svg + "\n");
  await reloaded;
  console.log("e2e ok");
} finally {
  await browser.close();
  proc.kill();
}
