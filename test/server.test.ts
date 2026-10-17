import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyFile } from "../src/format.ts";
import { startServer, type RunningServer } from "../src/server.ts";

let dir: string;
let file: string;
let srv: RunningServer;
let base: string;

const H = () => ({ "x-drawio-token": srv.token });

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "dwio-test-"));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "app", "index.html"), "<html>fake</html>");
  file = join(dir, "d.drawio.svg");
  writeFileSync(file, emptyFile("svg"));
  srv = await startServer({ file, webapp: join(dir, "app") });
  base = `http://127.0.0.1:${srv.port}`;
});
after(() => srv.close());

test("rejects requests without token", async () => {
  assert.equal((await fetch(`${base}/api/file`)).status, 401);
  assert.equal((await fetch(`${base}/`)).status, 401);
});

test("rejects foreign Host header (DNS rebinding)", async () => {
  // fetch() forbids overriding Host, so use a raw request
  const status = await new Promise<number>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: srv.port, path: "/api/file", headers: { ...H(), host: "evil.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 403);
});

test("rejects foreign Origin", async () => {
  const r = await fetch(`${base}/api/file`, { headers: { ...H(), origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});

test("serves host page and static webapp, blocks traversal", async () => {
  assert.equal((await fetch(`${base}/?t=${srv.token}`)).status, 200);
  assert.equal(await (await fetch(`${base}/drawio/index.html`)).text(), "<html>fake</html>");
  const r = await fetch(`${base}/drawio/..%2f..%2fetc%2fpasswd`);
  assert.ok(r.status === 403 || r.status === 404);
});

test("GET /api/file extracts embedded mxfile", async () => {
  const body = await (await fetch(`${base}/api/file`, { headers: H() })).json();
  assert.equal(body.kind, "svg");
  assert.match(body.xml, /^<mxfile>/);
});

test("PUT writes atomically, leaves no temp files, detects conflicts", async () => {
  const { hash } = await (await fetch(`${base}/api/file`, { headers: H() })).json();
  const next = emptyFile("svg").replace("1px", "2px");
  const ok = await fetch(`${base}/api/file`, { method: "PUT", headers: { ...H(), "x-base-hash": hash }, body: next });
  assert.equal(ok.status, 200);
  assert.equal(readFileSync(file, "utf8"), next);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes(".tmp-")), []);

  writeFileSync(file, emptyFile("svg").replace("1px", "3px")); // external edit
  const stale = await fetch(`${base}/api/file`, { method: "PUT", headers: { ...H(), "x-base-hash": hash }, body: next });
  assert.equal(stale.status, 409);

  const forced = await fetch(`${base}/api/file`, { method: "PUT", headers: H(), body: next });
  assert.equal(forced.status, 200);
});

test("PUT rejects bodies of the wrong shape", async () => {
  const r = await fetch(`${base}/api/file`, { method: "PUT", headers: H(), body: "nope" });
  assert.equal(r.status, 400);
});

test("SSE announces external changes but not our own writes", async () => {
  const res = await fetch(`${base}/api/events`, { headers: H() });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let seen = "";
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      seen += dec.decode(value);
    }
  })();

  await fetch(`${base}/api/file`, { method: "PUT", headers: H(), body: emptyFile("svg").replace("1px", "5px") });
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(!seen.includes("event: changed"), "own write must not echo");

  writeFileSync(file, emptyFile("svg").replace("1px", "9px"));
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(seen.includes("event: changed"), "external write must be announced");

  await reader.cancel();
  await pump.catch(() => {});
});

test("--host 0.0.0.0: reachable by IP, still rejects hostnames and bad origins, token still required", async () => {
  const open = await startServer({ file, webapp: join(dir, "app"), host: "0.0.0.0" });
  try {
    assert.ok(open.urls.length > 0 && open.urls.every((u) => u.includes(open.token)));
    const ip = open.urls[0]!.match(/^http:\/\/([^/]+)\//)![1]!;
    const ok = await fetch(`http://${ip}/api/file`, { headers: { "x-drawio-token": open.token } });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`http://${ip}/api/file`)).status, 401);
    const bad = await fetch(`http://${ip}/api/file`, { headers: { "x-drawio-token": open.token, origin: "https://evil.example" } });
    assert.equal(bad.status, 403);
  } finally {
    await open.close();
  }
});

test("--allow-host admits a named host; rejections explain how to fix them", async () => {
  const s = await startServer({ file, webapp: join(dir, "app"), allowHosts: ["box.lan"] });
  const get = (host: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: s.port, path: "/api/file", headers: { "x-drawio-token": s.token, host } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end();
    });
  try {
    assert.equal((await get(`box.lan:${s.port}`)).status, 200);
    const name = await get(`other.lan:${s.port}`);
    assert.equal(name.status, 403);
    assert.match(name.body, /--allow-host other\.lan/);
    const port = await get("127.0.0.1:9");
    assert.match(port.body, /--public-port 9/);
  } finally {
    await s.close();
  }
});

test("non-loopback bind auto-allows the machine's own hostname", async () => {
  const { hostname } = await import("node:os");
  const s = await startServer({ file, webapp: join(dir, "app"), host: "0.0.0.0" });
  try {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/file`, { headers: { "x-drawio-token": s.token } });
    assert.equal(r.status, 200);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: s.port, path: "/api/file", headers: { "x-drawio-token": s.token, host: `${hostname()}:${s.port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 200);
  } finally {
    await s.close();
  }
});

test("startServer rejects with EADDRINUSE and does not leak when the port is taken", async () => {
  const other = await startServer({ file, webapp: join(dir, "app") });
  try {
    await assert.rejects(startServer({ file, webapp: join(dir, "app"), port: other.port }), { code: "EADDRINUSE" });
  } finally {
    await other.close();
  }
});
