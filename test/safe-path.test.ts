import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutsideRootError, isInside, realpathLoose, resolveInside } from "../src/safe-path.ts";

const base = mkdtempSync(join(tmpdir(), "dwio-safe-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const real = (p: string) => realpathSync(p);

// base/proj (the allowed root), base/proj/sub, base/secret (outside), plus links between them.
const proj = join(base, "proj");
const secret = join(base, "secret");
mkdirSync(join(proj, "sub"), { recursive: true });
mkdirSync(secret);
writeFileSync(join(secret, "x.drawio"), "outside");
writeFileSync(join(proj, "a.drawio"), "inside");
symlinkSync(secret, join(proj, "link-to-secret")); // folder link that leaves the root
symlinkSync(join(secret, "x.drawio"), join(proj, "file-link.drawio")); // file link that leaves the root
symlinkSync(join(proj, "a.drawio"), join(proj, "ok-link.drawio")); // link that stays inside
mkdirSync(join(base, "proj-evil")); // a folder whose name starts like the root

const go = (input: string, roots = [proj]) => resolveInside(roots, proj, input);

describe("isInside", () => {
  test("the root itself and its children, not look-alikes", () => {
    expect(isInside("/a/proj", "/a/proj")).toBe(true);
    expect(isInside("/a/proj", "/a/proj/x/y")).toBe(true);
    expect(isInside("/a/proj", "/a/proj-evil/x")).toBe(false);
    expect(isInside("/a/proj", "/a/other")).toBe(false);
    expect(isInside("/a/proj", "/a")).toBe(false);
  });
  test("a name that merely starts with two dots is inside", () => {
    expect(isInside("/a/proj", "/a/proj/..notes/x")).toBe(true);
  });
});

describe("resolveInside", () => {
  test("allows relative and absolute paths inside the root, and new files", () => {
    expect(go("a.drawio")).toBe(real(join(proj, "a.drawio")));
    expect(go(join(proj, "sub", "new.drawio"))).toBe(join(real(proj), "sub", "new.drawio"));
    expect(go("brand/new/dirs/d.drawio")).toBe(join(real(proj), "brand/new/dirs/d.drawio"));
    expect(go("..notes.drawio")).toBe(join(real(proj), "..notes.drawio"));
  });
  test("rejects .. and absolute paths that leave the root", () => {
    expect(() => go("../secret/x.drawio")).toThrow(OutsideRootError);
    expect(() => go(join(secret, "x.drawio"))).toThrow(OutsideRootError);
    expect(() => go("sub/../../secret/x.drawio")).toThrow(OutsideRootError);
    expect(() => go("../proj-evil/x.drawio")).toThrow(OutsideRootError);
    expect(() => go("/etc/passwd.svg")).toThrow(OutsideRootError);
  });
  test("rejects links that lead out, for existing and for new files", () => {
    expect(() => go("link-to-secret/x.drawio")).toThrow(OutsideRootError);
    expect(() => go("link-to-secret/brand-new.drawio")).toThrow(OutsideRootError);
    expect(() => go("link-to-secret/deeper/new.drawio")).toThrow(OutsideRootError);
    expect(() => go("file-link.drawio")).toThrow(OutsideRootError);
  });
  test("a link that stays inside is fine and resolves to the real file", () => {
    expect(go("ok-link.drawio")).toBe(real(join(proj, "a.drawio")));
  });
  test("a root that is itself reached through a link still works", () => {
    const viaLink = join(base, "root-link");
    symlinkSync(proj, viaLink);
    expect(resolveInside([viaLink], viaLink, "a.drawio")).toBe(real(join(proj, "a.drawio")));
    expect(() => resolveInside([viaLink], viaLink, "../secret/x.drawio")).toThrow(OutsideRootError);
  });
  test("several roots: a path in any of them is allowed", () => {
    expect(resolveInside([proj, secret], proj, join(secret, "x.drawio"))).toBe(real(join(secret, "x.drawio")));
    expect(() => resolveInside([proj, secret], proj, "/etc/hosts.svg")).toThrow(/these folders/);
  });
  test("the message names the folder and the way to allow another one", () => {
    expect(() => go("../secret/x.drawio")).toThrow(new RegExp(`outside the folder ${proj}.*--root`, "s"));
  });
  test("nothing is created while checking", () => {
    try {
      go("link-to-secret/new-dir/new.drawio");
    } catch {}
    expect(existsSync(join(secret, "new-dir"))).toBe(false);
  });
});

test("realpathLoose handles a missing path under an existing folder", () => {
  expect(realpathLoose(join(proj, "no", "such", "file.drawio"))).toBe(join(real(proj), "no", "such", "file.drawio"));
});
