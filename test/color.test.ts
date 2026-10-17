import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { colorEnabled, colorHelp, makeStyle } from "../src/color.ts";

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

describe("makeStyle", () => {
  test("disabled returns the text unchanged", () => {
    const s = makeStyle(false);
    expect([s.dim("a"), s.red("b"), s.accent("c")]).toEqual(["a", "b", "c"]);
  });
  test("enabled wraps in ANSI codes and resets", () => {
    const s = makeStyle(true);
    expect(s.red("x")).toBe("\x1b[0;31mx\x1b[0m");
    expect(s.dim("x")).toBe("\x1b[0;2mx\x1b[0m");
    expect(s.accent("x")).toBe("\x1b[38;5;214mx\x1b[0m");
  });
});

test("colorHelp colors headings only", () => {
  const out = colorHelp("Usage:\n  dwio <file>   does a thing\nOptions:\n", makeStyle(true));
  expect(out).toContain("\x1b[38;5;214mUsage:\x1b[0m");
  expect(out).toContain("\x1b[38;5;214mOptions:\x1b[0m");
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
