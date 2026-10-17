import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableEndpoint } from "../src/stable.ts";

const dir = () => join(mkdtempSync(join(tmpdir(), "dwio-stable-")), "state");

test("same file gives the same token on every run; other files differ", () => {
  const d = dir();
  const a1 = stableEndpoint("/x/a.drawio", { dir: d })!;
  const a2 = stableEndpoint("/x/a.drawio", { dir: d })!;
  const b = stableEndpoint("/x/b.drawio", { dir: d })!;
  expect(a1.token).toMatch(/^[0-9a-f]{32}$/);
  expect(a2.token).toBe(a1.token);
  expect(b.token).not.toBe(a1.token);
});

test("the secret is private, and --new-token renews it", () => {
  const d = dir();
  const before = stableEndpoint("/x/a.drawio", { dir: d })!.token;
  if (process.platform !== "win32") expect(statSync(join(d, "secret")).mode & 0o077).toBe(0);
  expect(stableEndpoint("/x/a.drawio", { dir: d, renew: true })!.token).not.toBe(before);
});

test("a garbled secret is replaced instead of used", () => {
  const d = dir();
  stableEndpoint("/x/a.drawio", { dir: d });
  require("node:fs").writeFileSync(join(d, "secret"), "oops");
  stableEndpoint("/x/a.drawio", { dir: d });
  expect(readFileSync(join(d, "secret"), "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
});

test("remembers the last port per file", () => {
  const d = dir();
  const e = stableEndpoint("/x/a.drawio", { dir: d })!;
  expect(e.port).toBeUndefined();
  e.remember(3951);
  stableEndpoint("/x/b.drawio", { dir: d })!.remember(3960);
  expect(stableEndpoint("/x/a.drawio", { dir: d })!.port).toBe(3951);
});
