import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetName, checksumFor, compareVersions, isStandalone, latestTag, parseVersion, replaceExecutable, sha256, upgrade } from "../src/upgrade.ts";

test("versions: parse and compare", () => {
  expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
  expect(parseVersion("nope")).toBeNull();
  expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
});

test("assetName matches the install.sh file names", () => {
  expect(assetName("linux", "x64")).toBe("dwio-linux-x64");
  expect(assetName("darwin", "arm64")).toBe("dwio-darwin-arm64");
  expect(assetName("win32", "x64")).toBe("dwio-windows-x64.exe");
  expect(() => assetName("freebsd", "x64")).toThrow();
  expect(() => assetName("linux", "ia32")).toThrow();
  expect(() => assetName("win32", "arm64")).toThrow();
});

test("isStandalone is false under node and bun", () => {
  expect(isStandalone("/usr/bin/node")).toBe(false);
  expect(isStandalone("C:\\x\\bun.exe")).toBe(false);
  expect(isStandalone("/home/u/.local/bin/dwio")).toBe(true);
});

test("checksumFor finds the right line", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const sums = `${a}  dwio-linux-x64\n${b}  dwio-darwin-x64\n`;
  expect(checksumFor(sums, "dwio-darwin-x64")).toBe(b);
  expect(checksumFor(sums, "dwio-windows-x64.exe")).toBeNull();
});

// A fake release server: /latest redirects, /download/<tag>/<file> serves bytes.
function fakeReleases(tag: string, files: Record<string, Uint8Array | string>, redirect = true) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/releases/latest") return redirect ? new Response(null, { status: 302, headers: { location: `/releases/tag/${tag}` } }) : new Response("no", { status: 404 });
      const m = /^\/releases\/download\/([^/]+)\/(.+)$/.exec(path);
      if (m && m[1] === tag && files[m[2]!] !== undefined) return new Response(files[m[2]!] as BodyInit);
      return new Response("missing", { status: 404 });
    },
  });
  return { base: `http://127.0.0.1:${server.port}/releases`, stop: () => server.stop(true) };
}

describe("latestTag", () => {
  test("reads the tag from the redirect", async () => {
    const r = fakeReleases("v1.2.3", {});
    try {
      expect(await latestTag(r.base)).toBe("v1.2.3");
    } finally {
      r.stop();
    }
  });
  test("says so when there is no release", async () => {
    const r = fakeReleases("v1.2.3", {}, false);
    try {
      await expect(latestTag(r.base)).rejects.toThrow(/no release found/);
    } finally {
      r.stop();
    }
  });
});

describe("replaceExecutable", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwio-upgrade-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  test("swaps the file, keeps it executable, leaves no temp files", () => {
    const exe = join(dir, "dwio");
    writeFileSync(exe, "old");
    replaceExecutable(exe, Buffer.from("new"), { verify: () => true });
    expect(readFileSync(exe, "utf8")).toBe("new");
    expect(readdirSync(dir).filter((f) => f.startsWith("dwio."))).toEqual([]);
  });
  test("a program that does not run never replaces the old one", () => {
    const exe = join(dir, "dwio2");
    writeFileSync(exe, "old");
    expect(() => replaceExecutable(exe, Buffer.from("broken"), { verify: () => false })).toThrow(/does not run/);
    expect(readFileSync(exe, "utf8")).toBe("old");
    expect(readdirSync(dir).filter((f) => f.startsWith("dwio2."))).toEqual([]);
  });
  test("a folder without write permission gives a helpful message", () => {
    if (process.getuid?.() === 0) return; // root can write anywhere
    const ro = mkdtempSync(join(tmpdir(), "dwio-ro-"));
    const exe = join(ro, "dwio");
    writeFileSync(exe, "old");
    chmodSync(ro, 0o555);
    try {
      expect(() => replaceExecutable(exe, Buffer.from("new"), { verify: () => true })).toThrow(/cannot write to/);
    } finally {
      chmodSync(ro, 0o755);
      rmSync(ro, { recursive: true, force: true });
    }
  });
});

describe("upgrade", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwio-upgrade2-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const asset = assetName();
  const newBytes = Buffer.from("new program");
  const release = (tag: string, bytes: Buffer = newBytes, sum = sha256(bytes)) => fakeReleases(tag, { [asset]: bytes, SHA256SUMS: `${sum}  ${asset}\n` });
  const exeFile = (name: string) => {
    const p = join(dir, name);
    writeFileSync(p, "old program");
    return p;
  };

  test("same version: up to date, nothing changes", async () => {
    const r = release("v0.1.1");
    const exe = exeFile("same");
    try {
      expect(await upgrade({ current: "0.1.1", base: r.base, exePath: exe })).toEqual({ status: "up-to-date", current: "0.1.1", latest: "0.1.1" });
      expect(readFileSync(exe, "utf8")).toBe("old program");
    } finally {
      r.stop();
    }
  });
  test("--check reports an update and changes nothing, even for a non-standalone install", async () => {
    const r = release("v0.2.0");
    try {
      expect(await upgrade({ current: "0.1.1", base: r.base, checkOnly: true, exePath: "/usr/bin/node" })).toEqual({ status: "available", current: "0.1.1", latest: "0.2.0" });
    } finally {
      r.stop();
    }
  });
  test("a newer release is installed after the checksum matches", async () => {
    const r = release("v0.2.0");
    const exe = exeFile("newer");
    try {
      const res = await upgrade({ current: "0.1.1", base: r.base, exePath: exe, verify: () => true });
      expect(res).toEqual({ status: "upgraded", current: "0.1.1", latest: "0.2.0" });
      expect(readFileSync(exe, "utf8")).toBe("new program");
    } finally {
      r.stop();
    }
  });
  test("a wrong checksum stops the upgrade and keeps the old program", async () => {
    const r = release("v0.2.0", newBytes, "0".repeat(64));
    const exe = exeFile("badsum");
    try {
      await expect(upgrade({ current: "0.1.1", base: r.base, exePath: exe, verify: () => true })).rejects.toThrow(/checksum mismatch/);
      expect(readFileSync(exe, "utf8")).toBe("old program");
      expect(readdirSync(dir).filter((f) => f.startsWith("badsum."))).toEqual([]);
    } finally {
      r.stop();
    }
  });
  test("a version that is not in the release files fails clearly", async () => {
    const r = release("v0.2.0");
    try {
      await expect(upgrade({ current: "0.1.1", target: "0.9.0", base: r.base, exePath: exeFile("missing"), verify: () => true })).rejects.toThrow(/download failed: 404/);
    } finally {
      r.stop();
    }
  });
  test("a specific older version can be installed", async () => {
    const r = release("v0.0.5");
    const exe = exeFile("older");
    try {
      const res = await upgrade({ current: "0.1.1", target: "v0.0.5", base: r.base, exePath: exe, verify: () => true });
      expect(res.status).toBe("upgraded");
      expect(res.latest).toBe("0.0.5");
    } finally {
      r.stop();
    }
  });
  test("not the standalone program: explains what to do, changes nothing", async () => {
    const r = release("v0.2.0");
    try {
      await expect(upgrade({ current: "0.1.1", base: r.base, exePath: "/usr/local/bin/node" })).rejects.toThrow(/npm install -g @griimick\/dwio/);
    } finally {
      r.stop();
    }
  });
  test("exists helper sanity", () => expect(existsSync(dir)).toBe(true));
});
