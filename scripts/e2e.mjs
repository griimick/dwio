// Browser round-trip check of the editor page. Not part of `bun run check`: needs the playwright package and a
// browser (do not commit them):
//   bun add -d playwright && bunx playwright install chromium && bun scripts/e2e.mjs
// Set DWIO_BIN to test a compiled binary instead of the source.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Zoom and scroll away from the default view, edit, wait for the save: the shape must not move, and undo must still work. */
async function viewStaysPut(kind) {
  const d = mkdtempSync(join(tmpdir(), "dwio-view-"));
  const f = join(d, kind === "svg" ? "v.drawio.svg" : "v.drawio");
  if (kind === "svg") copyFileSync(new URL("../examples/flow.drawio.svg", import.meta.url).pathname, f);
  else writeFileSync(f, mx(cell("A", "A0", 40), cell("B", "B0", 240)));
  const p = spawn(cmd, [...args, f, "--no-open", "--json", "--port", "0"], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const { url } = JSON.parse(await new Promise((r) => p.stdout.once("data", (x) => r(x.toString()))));
    const pg = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await pg.goto(url);
    await pg.waitForFunction(() => window.__dwio.last.startsWith("loaded"), null, { timeout: 30000 });
    const fr = pg.frames().find((x) => x.url().includes("/drawio/"));
    await fr.locator(".geDiagramContainer svg rect").first().waitFor({ timeout: 30000 });
    await pg.waitForTimeout(1200);
    const shape = () => fr.evaluate(() => {
      const r = [...document.querySelectorAll(".geDiagramContainer svg rect[width]")].find((e) => +e.getAttribute("width") > 20).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width };
    });
    for (let i = 0; i < 2; i++) await fr.locator('[title^="Zoom In"]').first().click();
    await pg.waitForTimeout(500);
    const p0 = await shape();
    await fr.evaluate(([dx, dy]) => { const c = document.querySelector(".geDiagramContainer"); c.scrollLeft += dx; c.scrollTop += dy; }, [p0.x - 420, p0.y - 220]);
    await pg.waitForTimeout(500);
    const before = await shape();
    await pg.mouse.dblclick(before.x + before.w / 2, before.y + 20);
    await pg.keyboard.press("Control+A");
    await pg.keyboard.type("Edited");
    await pg.mouse.click(850, 600);
    await pg.waitForFunction(() => window.__dwio.last.startsWith("saved"), null, { timeout: 15000 });
    await pg.waitForTimeout(1500);
    const after = await shape();
    assert.ok(Math.abs(after.x - before.x) < 1 && Math.abs(after.y - before.y) < 1, `${kind}: the view moved by (${after.x - before.x}, ${after.y - before.y}) px after the save`);
    assert.ok(readFileSync(f, "utf8").includes("Edited"), `${kind}: the edit is in the file`);
    await pg.keyboard.press("Control+Z");
    await pg.waitForTimeout(600);
    assert.ok(!(await fr.locator(".geDiagramContainer").innerText()).includes("Edited"), `${kind}: undo works after a save`);
    await pg.close();
  } finally {
    p.kill();
    rmSync(d, { recursive: true, force: true });
  }
}

try {
  const { url } = JSON.parse(await new Promise((r) => proc.stdout.once("data", (d) => r(d.toString()))));
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  const last = (v, timeout = 15000) => page.waitForFunction((x) => window.__dwio.last.startsWith(x), v, { timeout });
  const frame = () => page.frames().find((f) => f.url().includes("/drawio/"));
  const read = () => readFileSync(file, "utf8");
  // What the tab icon shows: the colour of the pixel where the status dot goes, and whether the corner is still transparent.
  const icon = () =>
    page.evaluate(async () => {
      const link = document.querySelector('link[rel="icon"][sizes="64x64"]');
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = link.href; });
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const [r, g, b] = ctx.getImageData(46, 46, 1, 1).data;
      return { href: link.href, color: r > 180 && g < 90 && b < 90 ? "red" : b > 180 && r < 80 ? "blue" : "none", cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3] };
    });

  await page.goto(url);
  await last("loaded", 30000);

  // The editor fills the page; sync state is shown in draw.io's own menu bar.
  const bar = await frame().locator(".geMenubarContainer").innerText();
  assert.match(bar, /e2e\.drawio/, "file name in the menu bar");
  assert.equal(await page.title(), "e2e.drawio | dwio", "tab title is the file name and the program name");
  const plainIcon = await icon();
  assert.equal(plainIcon.color, "none", "no dot while everything is saved");
  assert.equal(plainIcon.cornerAlpha, 0, "the icon background is transparent");

  await frame().locator(".geDiagramContainer svg rect").first().waitFor({ timeout: 30000 }); // the shapes are drawn, so a click lands on them

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
  assert.equal(await page.title(), "e2e.drawio | dwio", "the tab title does not change while editing; the tab icon shows the state");
  await page.waitForFunction(() => window.__dwio.dot === "blue");
  await page.waitForTimeout(300); // the icon is drawn after its image loads
  const blue = await icon();
  assert.equal(blue.color, "blue", "unsaved edits put a blue dot on the tab icon");
  assert.equal(blue.cornerAlpha, 0, "the icon is still transparent around the picture");
  writeFileSync(file, mx(cell("A", "A0", 40), cell("B", "B-other", 240)));
  await page.getByText("Merged changes from disk").waitFor({ timeout: 15000 });
  await page.evaluate(() => (window.__dwio.holdSaves = false));
  await last("saved");
  await page.waitForFunction(() => window.__dwio.dot === "");
  assert.deepEqual(await icon(), plainIcon, "after saving, the tab icon is exactly the original again");
  const merged = read();
  assert.ok(merged.includes("A-mine") && merged.includes("B-other"), "both the local and the outside edit survive");

  await page.screenshot({ path: join(dir, "page.png") });
  // Saving must not move the view or wipe the undo history, for both file types.
  for (const kind of ["drawio", "svg"]) await viewStaysPut(kind);

  // A short loss of the connection: red dot, and after it comes back the tab recovers by itself.
  // (An open event stream cannot be cut from outside, so this calls the page's own error and open handlers.)
  await page.evaluate(() => events.dispatchEvent(new Event("error")));
  await page.getByText("Lost connection").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.__dwio.dot === "red");
  await page.waitForTimeout(300);
  assert.equal((await icon()).color, "red", "a lost connection puts a red dot on the tab icon");
  await page.evaluate(() => events.dispatchEvent(new Event("open")));
  await page.waitForFunction(() => window.__dwio.dot === "", null, { timeout: 30000 });
  assert.deepEqual(await icon(), plainIcon, "after the connection is back, the icon has no dot");

  // The server goes away for good: a red dot again, so a pinned tab shows the problem too.
  proc.kill();
  await page.getByText("Lost connection").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.__dwio.dot === "red");
  await page.waitForTimeout(300);
  assert.equal((await icon()).color, "red", "a lost connection puts a red dot on the tab icon");
  console.log("e2e ok");
} finally {
  await browser.close();
  proc.kill();
  rmSync(dir, { recursive: true, force: true });
}
