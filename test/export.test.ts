import { afterAll, describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser, type FinderEnv } from "../src/browser.ts";
import { exportDiagram, formatFromPath, parseFormat, planOutputs, pngSize, selectPages, svgSize } from "../src/export.ts";
import { listPages } from "../src/format.ts";
import { cacheRoot, isInstalled, webappDir } from "../src/assets.ts";

const pages = listPages('<mxfile><diagram id="a" name="Overview"/><diagram name="Fish &amp; Chips" id="b"/><diagram id="c"/></mxfile>');

test("listPages reads id and name in any attribute order, decodes entities, names unnamed pages", () => {
  expect(pages.map((p) => [p.index, p.id, p.name])).toEqual([
    [1, "a", "Overview"],
    [2, "b", "Fish & Chips"],
    [3, "c", "Page-3"],
  ]);
});

test("selectPages: default is page 1; accepts number or exact name; rejects unknown", () => {
  expect(selectPages(pages, undefined, false).map((p) => p.index)).toEqual([1]);
  expect(selectPages(pages, "2", false).map((p) => p.id)).toEqual(["b"]);
  expect(selectPages(pages, "Fish & Chips", false).map((p) => p.id)).toEqual(["b"]);
  expect(selectPages(pages, undefined, true)).toHaveLength(3);
  expect(() => selectPages(pages, "9", false)).toThrow(/Pages: 1=Overview/);
});

test("format parsing", () => {
  expect(formatFromPath("a/b.PNG")).toBe("png");
  expect(formatFromPath("x.drawio.svg")).toBe("drawio.svg");
  expect(formatFromPath("x.svg")).toBe("svg");
  expect(formatFromPath("x.txt")).toBeNull();
  expect(parseFormat("xmlsvg")).toBe("drawio.svg");
  expect(() => parseFormat("gif")).toThrow(/unknown format/);
});

describe("planOutputs", () => {
  const one = [pages[0]!];
  test("defaults next to the input and swaps the extension", () => {
    expect(planOutputs("/d/a.drawio.svg", undefined, "png", one)[0]!.path).toBe("/d/a.png");
    expect(planOutputs("/d/a.drawio", undefined, "pdf", one)[0]!.path).toBe("/d/a.pdf");
  });
  test("explicit output wins for one page; numbers files for many", () => {
    expect(planOutputs("/d/a.drawio", "/o/x.png", "png", one)[0]!.path).toBe("/o/x.png");
    expect(planOutputs("/d/a.drawio", "/o/x.png", "png", pages).map((p) => p.path)).toEqual(["/o/x-1.png", "/o/x-2.png", "/o/x-3.png"]);
  });
  test("- means stdout and allows one page only", () => {
    expect(planOutputs("/d/a.drawio", "-", "png", one)[0]!.path).toBeNull();
    expect(() => planOutputs("/d/a.drawio", "-", "png", pages)).toThrow(/one page only/);
  });
});

test("image size helpers", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(300, 16);
  png.writeUInt32BE(200, 20);
  expect(pngSize(png)).toEqual({ width: 300, height: 200 });
  expect(pngSize(Buffer.from("nope"))).toBeNull();
  expect(svgSize('<svg width="122px" height="61.2px">')).toEqual({ width: 122, height: 62 });
  expect(svgSize('<svg viewBox="0 0 50 40">')).toEqual({ width: 50, height: 40 });
});

describe("findBrowser", () => {
  const fake = (files: string[], env: Record<string, string> = {}): FinderEnv => ({ env, exists: (p) => files.includes(p), readdir: () => [], home: "/h" });
  test("an explicit path wins and never falls back when it is missing", () => {
    expect(findBrowser("/x/chrome", fake(["/x/chrome", "/usr/bin/chromium"], { PATH: "/usr/bin" })).path).toBe("/x/chrome");
    const miss = findBrowser("/x/nope", fake(["/usr/bin/chromium"], { PATH: "/usr/bin" }));
    expect(miss.path).toBeNull();
    expect(miss.tried[0]).toContain("/x/nope");
  });
  test("DWIO_BROWSER, then PATH", () => {
    expect(findBrowser(undefined, fake(["/b"], { DWIO_BROWSER: "/b" })).path).toBe("/b");
    expect(findBrowser(undefined, fake(["/usr/bin/chromium"], { PATH: "/usr/bin" })).path).toBe("/usr/bin/chromium");
  });
  test("nothing found lists what was tried", () => {
    const r = findBrowser(undefined, fake([], { PATH: "/usr/bin" }));
    expect(r.path).toBeNull();
    expect(r.tried.join(" ")).toContain("PATH");
  });
});

// Real browser round trip. Skipped when no browser or no downloaded draw.io editor is available.
const browser = findBrowser().path;
const canRun = browser !== null && isInstalled();
describe.skipIf(!canRun)("exportDiagram (real browser)", () => {
  const example = new URL("../examples/flow.drawio", import.meta.url).pathname;
  const dir = mkdtempSync(join(tmpdir(), "dwio-export-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (out: string, extra = {}) => exportDiagram({ file: example, webapp: webappDir(), out: join(dir, out), ...extra });

  test("png has the expected magic bytes and scales with --scale", async () => {
    const [a] = await run("a.png", { scale: 1 });
    const [b] = await run("b.png", { scale: 2 });
    assert.ok(a!.width && b!.width);
    expect(Math.abs(b!.width! - 2 * a!.width!)).toBeLessThanOrEqual(2);
    expect(readFileSync(join(dir, "a.png")).subarray(1, 4).toString()).toBe("PNG");
  }, 60000);

  test("svg and drawio.svg contain the diagram, and drawio.svg stays editable", async () => {
    await run("a.svg");
    expect(readFileSync(join(dir, "a.svg"), "utf8")).toContain("<svg");
    await run("a.drawio.svg");
    expect(readFileSync(join(dir, "a.drawio.svg"), "utf8")).toContain("content=");
  }, 60000);

  test("pdf is a PDF", async () => {
    await run("a.pdf");
    expect(readFileSync(join(dir, "a.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
  }, 60000);
});

describe("cacheRoot (XDG and platform defaults)", () => {
  const home = "/home/u";
  test("explicit variable beats XDG beats platform default", () => {
    expect(cacheRoot({ DWIO_CACHE_DIR: "/c", XDG_CACHE_HOME: "/x" }, "linux", home)).toBe("/c");
    expect(cacheRoot({ XDG_CACHE_HOME: "/x" }, "darwin", home)).toBe("/x/dwio");
    expect(cacheRoot({}, "linux", home)).toBe("/home/u/.cache/dwio");
    expect(cacheRoot({}, "darwin", home)).toBe("/home/u/Library/Caches/dwio");
    expect(cacheRoot({ LOCALAPPDATA: "C:\\L" }, "win32", home)).toContain("dwio");
  });
});
