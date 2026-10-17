import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DRAWIO_VERSION } from "../src/assets.ts";
import { dirProblem, ensureRunDir, isLoopback, listInstances, newAgentToken, parseInstance, proof, registerInstance, runDir } from "../src/instances.ts";
import { startServer } from "../src/server.ts";
import { createMcp } from "../src/mcp.ts";

const posix = process.platform !== "win32";
const base = mkdtempSync(join(tmpdir(), "dwio-inst-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const freshDir = () => join(base, `run${++n}`);

describe("where the folder is", () => {
  test("by platform and environment", () => {
    expect(runDir({ DWIO_RUN_DIR: "/x" }, "linux", 1000)).toBe("/x");
    expect(runDir({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux", 1000)).toBe("/run/user/1000/dwio");
    expect(runDir({ XDG_STATE_HOME: "/s" }, "linux", 1000)).toBe("/s/dwio/run");
    expect(runDir({}, "linux", 1000)).toMatch(/\.local\/state\/dwio\/run$/);
    expect(runDir({}, "darwin", 501)).toMatch(/dwio-501$/);
    expect(runDir({ LOCALAPPDATA: "C:\\L" }, "win32", undefined)).toContain("dwio");
  });
});

describe("a folder is trusted only if it is private", () => {
  const ok = { isDirectory: true, isSymbolicLink: false, uid: 1000, mode: 0o40700 };
  test("rules", () => {
    expect(dirProblem(ok, 1000)).toBeNull();
    expect(dirProblem({ ...ok, isSymbolicLink: true }, 1000)).toMatchObject({ fixable: false });
    expect(dirProblem({ ...ok, isDirectory: false }, 1000)).toMatchObject({ fixable: false });
    expect(dirProblem({ ...ok, uid: 0 }, 1000)).toMatchObject({ problem: "belongs to another user", fixable: false });
    expect(dirProblem({ ...ok, mode: 0o40755 }, 1000)).toMatchObject({ fixable: true });
    expect(dirProblem({ ...ok, mode: 0o40707 }, 1000)).toMatchObject({ fixable: true });
    expect(dirProblem({ ...ok, uid: 0, mode: 0o40777 }, undefined)).toBeNull(); // no uid (Windows): not checked
  });
  test.skipIf(!posix)("ensureRunDir makes a 0700 folder, tightens an open one, and refuses a link", () => {
    const d = freshDir();
    ensureRunDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    chmodSync(d, 0o777);
    ensureRunDir(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    const target = freshDir();
    mkdirSync(target);
    const link = freshDir();
    symlinkSync(target, link);
    expect(() => ensureRunDir(link)).toThrow(/symbolic link/);
  });
});

describe("the instance file", () => {
  const info = (extra = {}) => ({ pid: process.pid, file: "/p/a.drawio", port: 4000, agentToken: newAgentToken(), ...extra });
  test.skipIf(!posix)("is private, readable back, and removed on request", () => {
    const d = freshDir();
    const i = info();
    const remove = registerInstance(i, d);
    const path = join(d, `${process.pid}.json`);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(d).mode & 0o777).toBe(0o700);
    expect(parseInstance(JSON.parse(readFileSync(path, "utf8")))).toMatchObject({ pid: process.pid, file: "/p/a.drawio", port: 4000 });
    expect(readdirSync(d).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    remove();
    remove(); // twice is fine
    expect(existsSync(path)).toBe(false);
  });
  test("junk is not an instance", () => {
    const good = { v: 1, pid: 5, file: "/a", port: 80, agentToken: "a".repeat(48) };
    expect(parseInstance(good)).not.toBeNull();
    for (const bad of [null, "x", {}, { ...good, v: 2 }, { ...good, pid: -1 }, { ...good, pid: 1.5 }, { ...good, port: 0 }, { ...good, port: 70000 }, { ...good, file: "" }, { ...good, agentToken: "short" }, { ...good, agentToken: "Z".repeat(48) }]) expect(parseInstance(bad)).toBeNull();
  });
  test("the proof depends on every input", () => {
    const base = proof("t".repeat(48), "nonce123", 1, "/f");
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(proof("u".repeat(48), "nonce123", 1, "/f")).not.toBe(base);
    expect(proof("t".repeat(48), "nonce124", 1, "/f")).not.toBe(base);
    expect(proof("t".repeat(48), "nonce123", 2, "/f")).not.toBe(base);
    expect(proof("t".repeat(48), "nonce123", 1, "/g")).not.toBe(base);
  });
  test("loopback addresses", () => {
    expect([isLoopback("127.0.0.1"), isLoopback("::1"), isLoopback("::ffff:127.0.0.1")]).toEqual([true, true, true]);
    expect([isLoopback("192.168.1.5"), isLoopback("::ffff:10.0.0.1"), isLoopback(undefined)]).toEqual([false, false, false]);
  });
});

describe("listing instances", () => {
  const webapp = join(base, "webapp");
  mkdirSync(webapp);
  writeFileSync(join(webapp, "index.html"), "<html></html>");
  const diagram = join(base, "d.drawio");
  writeFileSync(diagram, "<mxfile/>");

  test("a real server is recognised through the challenge", async () => {
    const srv = await startServer({ file: diagram, webapp });
    try {
      const d = freshDir();
      registerInstance({ pid: process.pid, file: srv.file, port: srv.port, agentToken: srv.agentToken }, d);
      const list = await listInstances({ dir: d });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ file: realpathSync(diagram), port: srv.port, pid: process.pid });
    } finally {
      await srv.close();
    }
  });
  test("the ping route needs a challenge and gives only a proof, never the token", async () => {
    const srv = await startServer({ file: diagram, webapp });
    try {
      const base = `http://127.0.0.1:${srv.port}/api/agent/ping`;
      expect((await fetch(base)).status).toBe(400);
      expect((await fetch(`${base}?n=short`)).status).toBe(400);
      const res = await fetch(`${base}?n=abcdefgh12345678`);
      const text = await res.text();
      expect(JSON.parse(text).proof).toBe(proof(srv.agentToken, "abcdefgh12345678", process.pid, srv.file));
      expect(text).not.toContain(srv.agentToken);
      expect(text).not.toContain(srv.token);
      expect((await fetch(`http://127.0.0.1:${srv.port}/api/agent/other`)).status).toBe(404);
    } finally {
      await srv.close();
    }
  });
  test("a dead process: the file is removed", async () => {
    const d = freshDir();
    ensureRunDir(d);
    writeFileSync(join(d, "999999.json"), JSON.stringify({ v: 1, pid: 999999, file: "/x", port: 4000, agentToken: newAgentToken() }));
    expect(await listInstances({ dir: d })).toEqual([]);
    expect(existsSync(join(d, "999999.json"))).toBe(false);
  });
  test("a live process whose port answers nothing: not listed, file kept (it may only be busy)", async () => {
    const d = freshDir();
    registerInstance({ pid: process.pid, file: "/x", port: 1, agentToken: newAgentToken() }, d);
    expect(await listInstances({ dir: d, timeoutMs: 300 })).toEqual([]);
    expect(existsSync(join(d, `${process.pid}.json`))).toBe(true);
  });
  test("another program on that port gives a wrong proof: not listed, file removed", async () => {
    const impostor = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ proof: "0".repeat(64) }) });
    try {
      const d = freshDir();
      registerInstance({ pid: process.pid, file: "/x", port: impostor.port!, agentToken: newAgentToken() }, d);
      expect(await listInstances({ dir: d })).toEqual([]);
      expect(existsSync(join(d, `${process.pid}.json`))).toBe(false);
    } finally {
      impostor.stop(true);
    }
  });
  test("an impostor that answers without a proof is not listed either", async () => {
    const impostor = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ hello: "world" }) });
    try {
      const d = freshDir();
      registerInstance({ pid: process.pid, file: "/x", port: impostor.port!, agentToken: newAgentToken() }, d);
      expect(await listInstances({ dir: d })).toEqual([]);
    } finally {
      impostor.stop(true);
    }
  });
  test.skipIf(!posix)("hostile files are ignored: wrong names, links, huge files, bad JSON", async () => {
    const d = freshDir();
    ensureRunDir(d);
    const good = { v: 1, pid: process.pid, file: "/x", port: 1, agentToken: newAgentToken() };
    writeFileSync(join(d, "notes.json"), JSON.stringify(good));
    writeFileSync(join(d, "7.json"), JSON.stringify(good)); // name and pid disagree
    writeFileSync(join(d, "8.json"), "{ not json");
    writeFileSync(join(d, "9.json"), JSON.stringify({ ...good, pid: 9, junk: "x".repeat(10000) })); // too large
    writeFileSync(join(base, "outside.json"), JSON.stringify({ ...good, pid: 10 }));
    symlinkSync(join(base, "outside.json"), join(d, "10.json")); // a link
    expect(await listInstances({ dir: d, timeoutMs: 200 })).toEqual([]);
    expect(lstatSync(join(d, "10.json")).isSymbolicLink()).toBe(true); // never followed, never touched
  });
  test.skipIf(!posix)("a folder that is a link is not read at all", async () => {
    const real = freshDir();
    ensureRunDir(real);
    const link = freshDir();
    symlinkSync(real, link);
    registerInstance({ pid: process.pid, file: "/x", port: 1, agentToken: newAgentToken() }, real);
    expect(await listInstances({ dir: link, timeoutMs: 200 })).toEqual([]);
  });
});

/** The URL is printed a moment before the instance file is written, so wait for the file. */
async function waitForFile(path: string): Promise<void> {
  for (let i = 0; i < 100 && !existsSync(path); i++) await new Promise((r) => setTimeout(r, 50));
  if (!existsSync(path)) throw new Error(`${path} did not appear`);
}

describe("a real dwio process", () => {
  test("registers while running, and removes the file when it stops", async () => {
    const dir = mkdtempSync(join(base, "e2e-"));
    const cache = join(dir, "cache", `webapp-${DRAWIO_VERSION}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "index.html"), "<html></html>");
    const file = join(dir, "t.drawio");
    const run = join(dir, "run");
    const child = spawn(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, file, "--no-open", "--port", "0"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DWIO_CACHE_DIR: join(dir, "cache"), DWIO_RUN_DIR: run },
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      await new Promise((resolve) => child.stdout.once("data", resolve));
      await waitForFile(join(run, `${child.pid}.json`));
      const list = await listInstances({ dir: run });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ pid: child.pid, file: realpathSync(file) });
      const exited = new Promise((resolve) => child.on("exit", resolve));
      child.kill("SIGINT");
      await exited;
      expect(existsSync(join(run, `${child.pid}.json`))).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  }, 20000);
  test("after a crash the file stays, and the next listing cleans it up", async () => {
    const dir = mkdtempSync(join(base, "crash-"));
    const cache = join(dir, "cache", `webapp-${DRAWIO_VERSION}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, "index.html"), "<html></html>");
    const run = join(dir, "run");
    const child = spawn(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, join(dir, "t.drawio"), "--no-open", "--port", "0"], {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DWIO_CACHE_DIR: join(dir, "cache"), DWIO_RUN_DIR: run },
      stdio: ["ignore", "pipe", "ignore"],
    });
    await new Promise((resolve) => child.stdout.once("data", resolve));
    await waitForFile(join(run, `${child.pid}.json`));
    const exited = new Promise((resolve) => child.on("exit", resolve));
    child.kill("SIGKILL");
    await exited;
    expect(existsSync(join(run, `${child.pid}.json`))).toBe(true);
    expect(await listInstances({ dir: run })).toEqual([]);
    expect(existsSync(join(run, `${child.pid}.json`))).toBe(false);
  }, 20000);
});

describe("MCP: list_open_diagrams and the default file", () => {
  const proj = join(base, "mcpproj");
  mkdirSync(proj);
  const open = (file: string) => ({ v: 1 as const, pid: 1, file, port: 1, agentToken: "a".repeat(48), startedAt: "2026-10-17T14:02:03.000Z" });
  const make = (instances: ReturnType<typeof open>[]) => createMcp({ version: "0", cwd: proj, openDiagrams: async () => instances });
  const call = async (m: ReturnType<typeof make>, name: string, args: object = {}) => ((await m.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any).result;
  const text = (r: any) => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  const xml = `<mxfile><diagram id="p" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
  const a = join(realpathSync(proj), "a.drawio");
  const b = join(realpathSync(proj), "b.drawio");
  writeFileSync(a, xml);
  writeFileSync(b, xml);

  test("lists what is open inside the folder, with short paths, and counts the rest without naming them", async () => {
    const r = await call(make([open(a), open("/somewhere/else/secret.drawio")]), "list_open_diagrams");
    expect(text(r)).toContain("a.drawio (open since 14:02:03 UTC)");
    expect(text(r)).toContain("1 more diagram is open outside the allowed folder");
    expect(text(r)).not.toContain("secret");
  });
  test("says so when nothing is open", async () => {
    expect(text(await call(make([]), "list_open_diagrams"))).toBe("No diagram is open in the dwio editor.");
  });
  test("with exactly one open diagram, 'file' can be left out and the answer says which file was used", async () => {
    const r = await call(make([open(a)]), "get_diagram");
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("Using the diagram that is open in the editor: a.drawio");
    expect(text(r)).toContain("a.drawio (.drawio)");
  });
  test("with none or several open, leaving 'file' out is an error that explains why", async () => {
    expect(text(await call(make([]), "get_diagram"))).toContain("no diagram is open");
    expect(text(await call(make([open(a), open(b)]), "get_diagram"))).toMatch(/2 diagrams are open: a\.drawio, b\.drawio\. Say which one/);
  });
  test("an open diagram outside the allowed folder is never used as the default", async () => {
    expect(text(await call(make([open("/somewhere/else/x.drawio")]), "get_diagram"))).toContain("no diagram is open");
  });
  test("an explicit file always wins, and create_diagram never guesses", async () => {
    const m = make([open(a)]);
    expect(text(await call(m, "get_diagram", { file: "b.drawio" }))).not.toContain("Using the diagram");
    expect(text(await call(m, "create_diagram", {}))).toContain('"file" is required');
  });
});
