import { describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAWIO_VERSION } from "../src/assets.ts";
import { colorEnabled, colorHelp, hasTrueColor, makeStyle } from "../src/color.ts";

describe("colorEnabled", () => {
  test("terminal on, pipe off", () => {
    expect(colorEnabled({ env: {}, isTTY: true })).toBe(true);
    expect(colorEnabled({ env: {}, isTTY: false })).toBe(false);
  });
  test("TERM=dumb turns it off", () => {
    expect(colorEnabled({ env: { TERM: "dumb" }, isTTY: true })).toBe(false);
  });
  test("NO_COLOR beats everything; FORCE_COLOR beats the terminal check; FORCE_COLOR=0 is off", () => {
    expect(colorEnabled({ env: { NO_COLOR: "1", FORCE_COLOR: "1" }, isTTY: true })).toBe(false);
    expect(colorEnabled({ env: { FORCE_COLOR: "1" }, isTTY: false })).toBe(true);
    expect(colorEnabled({ env: { FORCE_COLOR: "0" }, isTTY: true })).toBe(false);
  });
});

test("true color is used only when the terminal says it has it", () => {
  expect([hasTrueColor({ COLORTERM: "truecolor" }), hasTrueColor({ COLORTERM: "24bit" }), hasTrueColor({ COLORTERM: "" }), hasTrueColor({})]).toEqual([true, true, false, false]);
});

describe("makeStyle", () => {
  test("disabled returns the text unchanged", () => {
    const s = makeStyle(false);
    expect([s.dim("a"), s.red("b"), s.accent("c"), s.link("d")]).toEqual(["a", "b", "c", "d"]);
  });
  test("enabled wraps in ANSI codes and resets", () => {
    const s = makeStyle(true);
    expect(s.red("x")).toBe("\x1b[0;31mx\x1b[0m");
    expect(s.dim("x")).toBe("\x1b[0;2mx\x1b[0m");
    expect(s.accent("x")).toBe("\x1b[38;5;151mx\x1b[0m"); // 256-color shade of the accent
    expect(makeStyle(true, true).accent("x")).toBe("\x1b[38;2;166;227;161mx\x1b[0m"); // Catppuccin Mocha green, #a6e3a1
    expect(s.link("x")).toBe("\x1b[0;36mx\x1b[0m");
  });
});

test("colorHelp colors headings only", () => {
  const out = colorHelp("Usage:\n  dwio <file>   does a thing\nOptions:\n", makeStyle(true));
  expect(out).toContain("\x1b[38;5;151mUsage:\x1b[0m");
  expect(out).toContain("\x1b[38;5;151mOptions:\x1b[0m");
  expect(out).toContain("\n  dwio <file>   does a thing\n");
});

describe("cli output", () => {
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "export", "/does/not/exist.drawio"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      encoding: "utf8",
    });
  test("errors are plain when piped and start with 'error:'", () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("error: /does/not/exist.drawio does not exist\n");
    expect(r.stdout).toBe("");
  });
  test("FORCE_COLOR colors stderr, never stdout", () => {
    const r = run({ FORCE_COLOR: "1" });
    expect(r.stderr).toContain("\x1b[0;31merror:\x1b[0m");
    expect(r.stdout).toBe("");
  });
  test("NO_COLOR wins over FORCE_COLOR", () => {
    expect(run({ NO_COLOR: "1", FORCE_COLOR: "1" }).stderr).not.toContain("\x1b");
  });
});

describe("editor URL on stdout", () => {
  const firstLine = async (env: Record<string, string>): Promise<string> => {
    const dir = mkdtempSync(join(tmpdir(), "dwio-color-"));
    // A fake draw.io editor in a private cache, so the test never downloads anything.
    const cache = join(dir, "cache", `webapp-${DRAWIO_VERSION}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "index.html"), "<html></html>");
    const child = spawn(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, join(dir, "t.drawio"), "--no-open", "--port", "0"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DWIO_CACHE_DIR: join(dir, "cache"), ...env },
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      return await new Promise<string>((resolve) => child.stdout.once("data", (d: Buffer) => resolve(d.toString().trim())));
    } finally {
      child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  test("is plain when piped, so scripts and agents can use it as is", async () => {
    expect(await firstLine({})).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+$/);
  });
  test("is cyan when colors are on", async () => {
    expect(await firstLine({ FORCE_COLOR: "1" })).toMatch(/^\x1b\[0;36mhttp:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+\x1b\[0m$/);
  });
});
