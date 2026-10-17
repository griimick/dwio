// Browser round-trip check of the editor page. Not part of `bun run check`: needs the playwright package and a
// browser (do not commit them):
//   bun add -d playwright && bunx playwright install chromium && bun scripts/e2e.mjs
// Set DWIO_BIN to test a compiled binary instead of the source.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "dwio-e2e-"));
const file = join(dir, "e2e.drawio");
const cell = (id, label, x) =>
  `<mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="120" height="60" as="geometry"/></mxCell>`;
const mx = (...cells) => `<mxfile><diagram id="d" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
writeFileSync(file, mx(cell("A", "A0", 40), cell("B", "B0", 240)));

const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const [cmd, args] = process.env.DWIO_BIN ? [process.env.DWIO_BIN, []] : [process.execPath, [cli]];
const proc = spawn(cmd, [...args, file, "--no-open", "--json", "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
const browser = await chromium.launch();
try {
  const { url } = JSON.parse(await new Promise((r) => proc.stdout.once("data", (d) => r(d.toString()))));
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const last = (v, timeout = 15000) => page.waitForFunction((x) => window.__dwio.last.startsWith(x), v, { timeout });
  const frame = () => page.frames().find((f) => f.url().includes("/drawio/"));
  const read = () => readFileSync(file, "utf8");

  await page.goto(url);
  await last("loaded", 30000);

  // The editor fills the page; sync state is shown in draw.io's own menu bar.
  const bar = await frame().locator(".geMenubarContainer").innerText();
  assert.match(bar, /e2e\.drawio/, "file name in the menu bar");
  assert.equal(await page.title(), "e2e.drawio | dwio", "tab title is the file name and the program name");

  // 1. Editing in the browser reaches the file.
  await page.mouse.dblclick(273 + 60, 109 + 30);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("A-local");
  await page.mouse.click(700, 500);
  await last("saved");
  assert.ok(read().includes("A-local"), "label edit saved to disk");

  // 2. Clean tab: an outside change replaces the diagram exactly (also a reset to an older version).
  const reloaded = last("reloaded");
  writeFileSync(file, mx(cell("A", "A0", 40), cell("B", "B-ext", 240)));
  await reloaded;
  assert.ok(!(await page.evaluate(() => window.__dwio.dirty)));
  assert.ok((await frame().locator(".geDiagramContainer").innerText()).includes("B-ext"), "clean tab shows the disk version");
  assert.ok(!(await frame().locator(".geDiagramContainer").innerText()).includes("A-local"), "reset removes the saved local edit");

  // 3. Dirty tab: local edit (held back from saving) and an outside edit are merged, then saved.
  await page.evaluate(() => (window.__dwio.holdSaves = true));
  await page.mouse.dblclick(273 + 60, 109 + 30);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("A-mine");
  await page.mouse.click(700, 500);
  await page.waitForFunction(() => window.__dwio.last === "dirty");
  assert.equal(await page.title(), "● e2e.drawio | dwio", "unsaved edits show a dot in the tab title");
  writeFileSync(file, mx(cell("A", "A0", 40), cell("B", "B-other", 240)));
  await page.getByText("Merged changes from disk").waitFor({ timeout: 15000 });
  await page.evaluate(() => (window.__dwio.holdSaves = false));
  await last("saved");
  assert.equal(await page.title(), "e2e.drawio | dwio", "the dot goes away after saving");
  const merged = read();
  assert.ok(merged.includes("A-mine") && merged.includes("B-other"), "both the local and the outside edit survive");

  await page.screenshot({ path: join(dir, "page.png") });
  console.log("e2e ok");
} finally {
  await browser.close();
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
}
