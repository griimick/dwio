import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../install.sh", import.meta.url).pathname;
const source = readFileSync(script, "utf8");
const asset = `dwio-${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const SIZE = 2_500_000;
const posix = process.platform === "linux" || process.platform === "darwin";
const hasPty = process.platform === "linux" && Bun.which("script") !== null; // util-linux `script -qec`

// A fake release: a tiny program padded to 2.5 MB, served slowly so the loader has time to draw.
const program = Buffer.concat([Buffer.from('#!/bin/sh\necho "0.0.0 (test)"\nexit 0\n'), Buffer.alloc(SIZE, 0x23)]);
const sums = (hash: string) => `${hash}  ${asset}\n`;
const goodHash = new Bun.CryptoHasher("sha256").update(program).digest("hex");
let server: ReturnType<typeof Bun.serve>;
let missing = false; // when true the program answers 404
let wrongSum = false;
const root = mkdtempSync(join(tmpdir(), "dwio-inst-sh-"));

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === `/${asset}`) {
        if (missing) return new Response("nope", { status: 404 });
        const headers = { "content-length": String(program.length) };
        if (req.method === "HEAD") return new Response(null, { headers });
        let at = 0;
        return new Response(new ReadableStream({
          async pull(c) {
            if (at >= program.length) return c.close();
            c.enqueue(program.subarray(at, at + 100_000));
            at += 100_000;
            await Bun.sleep(20); // 25 chunks: about half a second
          },
        }), { headers });
      }
      if (p === "/SHA256SUMS") return new Response(sums(wrongSum ? "0".repeat(64) : goodHash));
      return new Response("no", { status: 404 });
    },
  });
});
afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

let n = 0;
function env(extra: Record<string, string> = {}) {
  const dir = join(root, `inst${++n}`);
  return { dir, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TERM: "xterm-256color", DWIO_BASE_URL: `http://127.0.0.1:${server.port}`, DWIO_INSTALL_DIR: dir, ...extra } };
}
const run = (cmd: string, args: string[], e: Record<string, string>) =>
  new Promise<{ out: string; code: number | null }>((resolve) => {
    const c = spawn(cmd, args, { env: e, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ out, code }));
  });
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const pty = (e: Record<string, string>) => run("script", ["-qec", `sh ${script}`, "/dev/null"], e);

describe.skipIf(!posix)("install.sh", () => {
  test("without a terminal: plain lines, no escape codes, no carriage returns", async () => {
    const { dir, env: e } = env();
    const { out, code } = await run("sh", [script], e);
    expect(code).toBe(0);
    expect(out).toContain(`Downloading ${asset}…`);
    expect(out).toContain("Installed dwio 0.0.0 (test)");
    expect(out).not.toContain("\x1b");
    expect(out).not.toContain("\r");
    expect(spawnSync(join(dir, "dwio"), ["--version"], { encoding: "utf8" }).stdout).toContain("0.0.0 (test)");
  });

  test.skipIf(!hasPty)("on a terminal: a bar is drawn in place, and the cursor is hidden and then shown again", async () => {
    const { env: e } = env({ LANG: "en_US.UTF-8" });
    const { out, code } = await pty(e);
    expect(code).toBe(0);
    expect(out.indexOf("\x1b[?25l")).toBeGreaterThanOrEqual(0);
    expect(out.lastIndexOf("\x1b[?25h")).toBeGreaterThan(out.indexOf("\x1b[?25l"));
    expect(out).toContain("\r");
    expect(out).toContain("━"); // the filled part of the bar
    expect(out).toMatch(/\d+%/);
    expect(out).toContain("MB /"); // sizes, so the total was found through the HEAD request
    expect(out).toContain("\x1b[38;5;151m"); // the green accent (256-color shade), not opencode's gold (38;5;214)
    expect(out).not.toContain("38;5;214");
    expect(strip(out)).toContain(`Downloaded ${asset} (2.4 MB)`);
    expect(out).toContain("Installed");
    // the loader line is gone from the final screen: the last cursor sequence comes before "Installed"
    expect(out.lastIndexOf("\x1b[?25h")).toBeLessThan(out.indexOf("Installed"));
  });

  test.skipIf(!hasPty)("with a true color terminal the accent is exactly Catppuccin Mocha green", async () => {
    const { env: e } = env({ COLORTERM: "truecolor" });
    const { out } = await pty(e);
    expect(out).toContain("\x1b[38;2;166;227;161m");
    expect(out).not.toContain("38;5;151");
  });

  test.skipIf(!hasPty)("a terminal without a size still shows the whole label and a bar", async () => {
    const { env: e } = env({ LANG: "en_US.UTF-8" });
    // `script` gives the program a terminal of size 0 x 0, like some SSH and CI sessions
    const { out } = await pty(e);
    expect(strip(out)).toContain(`Downloading ${asset}`);
    expect(out).toContain("━");
  });

  test.skipIf(!hasPty)("in a C locale the bar uses plain ASCII", async () => {
    const { env: e } = env({ LANG: "C", LC_ALL: "C" });
    const { out } = await pty(e);
    expect(out).not.toContain("━");
    expect(strip(out)).toMatch(/#+-*\s+\d+%/);
  });

  test.skipIf(!hasPty)("NO_COLOR keeps the loader but removes the colors", async () => {
    const { env: e } = env({ NO_COLOR: "1" });
    const { out } = await pty(e);
    expect(out).toContain("\r");
    expect(out).not.toMatch(/\x1b\[(0;2|0;31|38;5;\d+)m/);
  });

  test.skipIf(!hasPty)("a failed download restores the cursor, says why, and installs nothing", async () => {
    missing = true;
    try {
      const { dir, env: e } = env();
      const { out, code } = await pty(e);
      expect(code).not.toBe(0);
      expect(out).toContain("error:");
      expect(out).toContain("could not download");
      expect(out.lastIndexOf("\x1b[?25h")).toBeGreaterThan(out.lastIndexOf("\x1b[?25l"));
      expect(existsSync(join(dir, "dwio"))).toBe(false);
    } finally {
      missing = false;
    }
  });

  test("a wrong checksum still stops the install", async () => {
    wrongSum = true;
    try {
      const { dir, env: e } = env();
      const { out, code } = await run("sh", [script], e);
      expect(code).not.toBe(0);
      expect(out).toContain("checksum mismatch");
      expect(existsSync(join(dir, "dwio"))).toBe(false);
    } finally {
      wrongSum = false;
    }
  });

  test.skipIf(!hasPty)("Ctrl+C while downloading kills the download and shows the cursor again", async () => {
    const { dir, env: e } = env();
    const c = spawn("script", ["-qec", `sh ${script}`, "/dev/null"], { env: e, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    await new Promise<void>((resolve) => { const t = setInterval(() => out.includes("\r") && (clearInterval(t), resolve()), 10); });
    c.stdin.write("\x03"); // Ctrl+C, typed into the terminal
    await new Promise((resolve) => c.on("close", resolve));
    expect(out.lastIndexOf("\x1b[?25h")).toBeGreaterThan(out.lastIndexOf("\x1b[?25l"));
    expect(out).not.toContain("Installed");
    expect(existsSync(join(dir, "dwio"))).toBe(false);
  });

  test("a download that is cut off at any line runs nothing", () => {
    // Nothing may happen before the last line: every earlier line is a definition. A cut-off script either defines
    // functions and stops, or fails to parse. It must never install, download, or touch the install folder.
    const lines = source.split("\n");
    const { dir, env: e } = env({ DWIO_BASE_URL: "http://127.0.0.1:9" }); // nothing listens there
    for (let cut = 1; cut < lines.length - 2; cut++) {
      const r = spawnSync("sh", ["-s"], { input: lines.slice(0, cut).join("\n") + "\n", env: e, encoding: "utf8", timeout: 5000 });
      // a shell syntax error is fine ("sh: ... end of file"); anything dwio would print is not
      expect([cut, r.stdout, /Installed|Downloading|Downloaded|^error:/m.test(r.stderr)]).toEqual([cut, "", false]);
    }
    expect(existsSync(dir)).toBe(false);
  });

  test("main is the last line, and no other command runs at the top level", () => {
    const nonEmpty = source.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
    expect(nonEmpty.at(-1)).toBe('main "$@"');
    // top-level lines (not indented, not inside a function body) other than function headers, closers, set and REPO
    const top = nonEmpty.filter((l) => !/^\s/.test(l) && l !== "}");
    const allowed = /^(set -eu|REPO=|[a-z_]+\(\) \{|main "\$@")/;
    expect(top.filter((l) => !allowed.test(l))).toEqual([]);
  });
});
