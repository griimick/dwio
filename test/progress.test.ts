import { describe, expect, test } from "bun:test";
import { makeStyle } from "../src/color.ts";
import { NO_PROGRESS, createProgress, formatBytes, readWithProgress, renderProgress } from "../src/progress.ts";
import { assetName, upgrade } from "../src/upgrade.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plain = makeStyle(false);
const colored = makeStyle(true); // 256 colors
const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const base = { label: "Downloading draw.io v1", style: plain, unicode: true, frame: 0 };

test("formatBytes", () => {
  expect([formatBytes(12), formatBytes(2048), formatBytes(5 * 1048576), formatBytes(87.04 * 1048576)]).toEqual(["12 B", "2 KB", "5.0 MB", "87.0 MB"]);
});

describe("renderProgress", () => {
  test("a known total: bar, percent and sizes, half filled at 50%", () => {
    const line = renderProgress({ ...base, done: 25 * 1048576, total: 50 * 1048576, columns: 100 });
    expect(line).toContain(" 50%");
    expect(line).toContain("25.0 MB / 50.0 MB");
    const bar = line.match(/[━─]+/)![0];
    expect(bar.length).toBe(28);
    expect([...bar].filter((c) => c === "━").length).toBe(14);
  });
  test("0% and 100% fill none and all of the bar; more than the total stays at 100%", () => {
    const bar = (done: number) => renderProgress({ ...base, done, total: 100, columns: 100 }).match(/[━─]+/)![0];
    expect(bar(0)).toBe("─".repeat(28));
    expect(bar(100)).toBe("━".repeat(28));
    expect(renderProgress({ ...base, done: 500, total: 100, columns: 100 })).toContain("100%");
  });
  test("an unknown total: a spinner that turns, and the size so far", () => {
    const a = renderProgress({ ...base, done: 3 * 1048576, total: null, frame: 0 });
    const b = renderProgress({ ...base, done: 3 * 1048576, total: null, frame: 1 });
    expect(a).toContain("3.0 MB");
    expect(a).not.toBe(b);
    expect(a).not.toContain("%");
  });
  test("ASCII fallback has no unicode characters", () => {
    expect(renderProgress({ ...base, unicode: false, done: 50, total: 100, columns: 100 })).toMatch(/^[\x20-\x7e]+$/);
    expect(renderProgress({ ...base, unicode: false, done: 5, total: null, frame: 3 })).toMatch(/^[\x20-\x7e]+$/);
  });
  test("the line is never wider than the terminal", () => {
    for (const columns of [40, 50, 60, 70, 80, 100, 160]) {
      for (const total of [null, 123 * 1048576]) {
        const line = strip(renderProgress({ ...base, label: "Downloading dwio-darwin-arm64 v0.4.0", done: 123 * 1048576, total, columns }));
        expect([columns, line.length <= columns]).toEqual([columns, true]);
      }
    }
  });
  test("a terminal that reports no size (undefined or 0) is treated as 80 columns wide, not as a tiny one", () => {
    for (const columns of [undefined, 0, -1, NaN]) {
      const line = renderProgress({ ...base, label: "Downloading draw.io v32.4.1", done: 25, total: 50, columns });
      expect([columns, line]).toEqual([columns, expect.stringContaining("Downloading draw.io v32.4.1")]); // the label is whole
      expect(line).toMatch(/[━]+[─]+/); // and the bar is there
    }
  });
  test("colors: the bar is accent, the rest dim; plain style adds no escape codes", () => {
    expect(renderProgress({ ...base, style: colored, done: 50, total: 100, columns: 100 })).toContain("\x1b[38;5;151m");
    expect(renderProgress({ ...base, done: 50, total: 100, columns: 100 })).not.toContain("\x1b");
  });
});

describe("createProgress", () => {
  const stream = (isTTY: boolean) => {
    const writes: string[] = [];
    return { isTTY, columns: 100, writes, write: (s: string) => writes.push(s) };
  };
  test("outside a terminal it is off and writes nothing", () => {
    const s = stream(false);
    const p = createProgress({ stream: s, label: "x", style: plain, env: {} });
    expect(p).toBe(NO_PROGRESS);
    p.update(1, 2);
    p.finish("done");
    expect(s.writes).toEqual([]);
    expect(createProgress({ stream: stream(true), label: "x", style: plain, env: { TERM: "dumb" } }).enabled).toBe(false);
  });
  test("in a terminal: hides the cursor, redraws one line with \\r, and puts everything back", () => {
    const s = stream(true);
    let t = 0;
    const sigint = process.listenerCount("SIGINT");
    const p = createProgress({ stream: s, label: "Downloading x", style: plain, env: { LANG: "en_US.UTF-8" }, now: () => (t += 100) });
    expect(p.enabled).toBe(true);
    p.update(10, 100);
    p.update(50, 100);
    expect(s.writes[0]).toBe("\x1b[?25l");
    expect(s.writes[1]!.startsWith("\r")).toBe(true);
    expect(s.writes[1]).toContain("10%");
    expect(s.writes[2]).toContain("50%");
    expect(process.listenerCount("SIGINT")).toBe(sigint + 1);
    p.finish("Downloaded x (1.0 MB)");
    expect(s.writes.at(-2)).toBe("\r\x1b[K\x1b[?25h"); // line cleared, cursor shown
    expect(s.writes.at(-1)).toBe("Downloaded x (1.0 MB)\n");
    expect(process.listenerCount("SIGINT")).toBe(sigint);
  });
  test("many updates in a short time do not flood the terminal, but the last one always shows", () => {
    const s = stream(true);
    const p = createProgress({ stream: s, label: "x", style: plain, env: {}, now: () => 1000 });
    for (let i = 0; i < 1000; i++) p.update(i, 1000);
    p.update(1000, 1000);
    const draws = s.writes.filter((w) => w.startsWith("\r"));
    expect(draws.length).toBeLessThanOrEqual(3);
    expect(draws.at(-1)).toContain("100%");
    p.finish();
  });
  test("finish after a failure (no summary) restores the cursor and prints nothing else", () => {
    const s = stream(true);
    const p = createProgress({ stream: s, label: "x", style: plain, env: {}, now: () => 1 });
    p.update(1, 10);
    p.finish();
    expect(s.writes.at(-1)).toBe("\r\x1b[K\x1b[?25h");
  });
  test("a fast download that never drew still prints its summary, and never touches the cursor", () => {
    const s = stream(true);
    createProgress({ stream: s, label: "x", style: plain, env: {} }).finish("Downloaded x");
    expect(s.writes).toEqual(["Downloaded x\n"]);
  });
  test("the unicode choice follows the locale", () => {
    const run = (env: Record<string, string>) => {
      const s = stream(true);
      createProgress({ stream: s, label: "x", style: plain, env, now: () => 1 }).update(5, 10);
      return s.writes.join("");
    };
    expect(run({ LANG: "en_US.UTF-8" })).toContain("━");
    expect(run({ LC_ALL: "C" })).toContain("#");
    expect(run({})).toContain("#");
  });
});

describe("readWithProgress", () => {
  const body = (chunks: number[], headers: Record<string, string> = {}) =>
    new Response(new ReadableStream({ start(c) { for (const n of chunks) c.enqueue(new Uint8Array(n).fill(n)); c.close(); } }), { headers });
  const spy = () => {
    const calls: [number, number | null][] = [];
    return { calls, enabled: true, update: (d: number, t: number | null) => void calls.push([d, t]), finish() {} };
  };
  test("reports growing byte counts with the total, and returns every byte in order", async () => {
    const p = spy();
    const out = await readWithProgress(body([3, 5, 7], { "content-length": "15" }), p);
    expect(p.calls).toEqual([[3, 15], [8, 15], [15, 15]]);
    expect(out.length).toBe(15);
    expect([out[0], out[3], out[8]]).toEqual([3, 5, 7]);
  });
  test("no content-length, or a content encoding: the total is unknown", async () => {
    const a = spy();
    await readWithProgress(body([4]), a);
    expect(a.calls).toEqual([[4, null]]);
    const b = spy();
    await readWithProgress(body([4], { "content-length": "99", "content-encoding": "gzip" }), b);
    expect(b.calls).toEqual([[4, null]]);
  });
  test("with the loader off it just reads the body", async () => {
    const out = await readWithProgress(body([2, 2]), NO_PROGRESS);
    expect(out.length).toBe(4);
  });
});

describe("dwio upgrade uses the loader for the program download", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwio-prog-"));
  const asset = assetName();
  const bytes = Buffer.from("new program");
  const sha = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/releases/latest") return new Response(null, { status: 302, headers: { location: "/releases/tag/v9.0.0" } });
      if (p.endsWith(`/${asset}`)) return new Response(bytes);
      if (p.endsWith("/SHA256SUMS")) return new Response(`${sha}  ${asset}\n`);
      return new Response("no", { status: 404 });
    },
  });
  const exe = join(dir, "dwio");
  writeFileSync(exe, "old");
  const base = `http://127.0.0.1:${server.port}/releases`;
  test("a terminal loader gets the label and a summary, and the plain line is not printed", async () => {
    const seen: string[] = [];
    const finished: (string | undefined)[] = [];
    const logs: string[] = [];
    const r = await upgrade({ current: "1.0.0", base, exePath: exe, verify: () => true, log: (m) => logs.push(m), progress: (label) => (seen.push(label), { enabled: true, update() {}, finish: (s) => void finished.push(s) }) });
    expect(r.status).toBe("upgraded");
    expect(seen).toEqual([`Downloading ${asset} v9.0.0`]);
    expect(finished[0]).toMatch(new RegExp(`^Downloaded ${asset} v9\\.0\\.0 \\(\\d+ B\\)$`));
    expect(logs.some((l) => l.startsWith("Downloading"))).toBe(false);
    expect(readFileSync(exe, "utf8")).toBe("new program");
  });
  test("without a loader the plain line is printed, as before", async () => {
    writeFileSync(exe, "old");
    const logs: string[] = [];
    await upgrade({ current: "1.0.0", base, exePath: exe, verify: () => true, log: (m) => logs.push(m) });
    expect(logs[0]).toBe(`Downloading ${asset} v9.0.0…`);
  });
  test("a failed download puts the cursor back (finish without a summary)", async () => {
    const finished: (string | undefined)[] = [];
    await expect(upgrade({ current: "1.0.0", target: "8.8.8", base, exePath: exe, verify: () => true, progress: () => ({ enabled: true, update() {}, finish: (s) => void finished.push(s) }) })).resolves.toBeDefined();
  });
  test("cleanup", () => {
    server.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
