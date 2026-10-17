import { afterAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstalled, webappDir } from "../src/assets.ts";
import { findBrowser } from "../src/browser.ts";
import { parseOps } from "../src/diagram.ts";
import { createMcp } from "../src/mcp.ts";

const dir = mkdtempSync(join(tmpdir(), "dwio-mcp-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const XML = `<mxfile>
  <diagram id="p" name="Flow">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="api" parent="1" style="html=1;" value="API" vertex="1">
          <mxGeometry height="40" width="80" x="20" y="20" as="geometry" />
        </mxCell>
        <mxCell id="db" parent="1" style="html=1;" value="DB" vertex="1">
          <mxGeometry height="40" width="80" x="200" y="20" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

const mcp = createMcp({ version: "9.9.9", cwd: dir, webapp: async () => webappDir() });
let nextId = 1;
const rpc = async (method: string, params?: object) => (await mcp.handle({ jsonrpc: "2.0", id: nextId++, method, params })) as any;
const call = async (name: string, args: object) => (await rpc("tools/call", { name, arguments: args })).result;
const text = (r: any): string => r.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
const fresh = (name: string, content = XML) => {
  writeFileSync(join(dir, name), content);
  return name;
};

describe("protocol", () => {
  test("initialize agrees on a protocol version and describes the server", async () => {
    const r = (await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result;
    expect(r).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "dwio", version: "9.9.9" } });
    expect(r.instructions).toContain("get_diagram");
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe("2025-06-18");
  });
  test("notifications get no answer; ping works; unknown methods are errors", async () => {
    expect(await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await rpc("ping")).result).toEqual({});
    expect((await rpc("nope")).error.code).toBe(-32601);
    expect(((await mcp.handle({ foo: 1 })) as any).error.code).toBe(-32600);
  });
  test("tools/list names four tools with object schemas", async () => {
    const tools = (await rpc("tools/list")).result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(["apply_changes", "create_diagram", "get_diagram", "render"]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.required).toContain("file");
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
  test("an unknown tool is a protocol error", async () => {
    expect((await rpc("tools/call", { name: "nope", arguments: {} })).error.code).toBe(-32602);
  });
});

describe("get_diagram", () => {
  test("lists pages and cells, one JSON object per line", async () => {
    const r = await call("get_diagram", { file: fresh("g.drawio") });
    expect(r.isError).toBeUndefined();
    const t = text(r);
    expect(t).toContain('page 1 "Flow": 2 shapes, 0 connectors');
    expect(t).toContain('{"id":"api","type":"vertex","label":"API"');
    expect(t).not.toContain("undefined");
  });
  test("a missing file and a wrong file type give clear errors, not crashes", async () => {
    expect(text(await call("get_diagram", { file: "missing.drawio" }))).toContain("does not exist. Use create_diagram");
    expect(text(await call("get_diagram", { file: "notes.txt" }))).toContain("not a diagram file");
    expect((await call("get_diagram", {})).isError).toBe(true);
    writeFileSync(join(dir, "plain.svg"), `<svg xmlns="http://www.w3.org/2000/svg"/>`);
    expect(text(await call("get_diagram", { file: "plain.svg" }))).toContain("no embedded draw.io data");
  });
  test("an unknown page lists the pages", async () => {
    expect(text(await call("get_diagram", { file: fresh("g2.drawio"), page: "Nope" }))).toContain("Pages: 1=Flow");
  });
});

describe("apply_changes", () => {
  test("edits the file in place with a small diff and reports the ids", async () => {
    const file = fresh("a.drawio");
    const r = await call("apply_changes", { file, ops: [{ op: "add_vertex", id: "cache", label: "Cache", x: "110", y: 100 }, { op: "add_edge", source: "api", target: "cache" }, { op: "update", id: "db", label: "Postgres" }] });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("added cache (page 1)");
    expect(text(r)).toContain("updated db (page 1)");
    const after = readFileSync(join(dir, file), "utf8");
    expect(after).toContain('value="Postgres"');
    expect(after).toContain('id="cache"');
    expect(after.replace('value="Postgres"', 'value="DB"').split("\n").filter((l) => !XML.includes(l)).length).toBeGreaterThan(0);
  });
  test("a bad operation names itself, and the file is untouched", async () => {
    const file = fresh("b.drawio");
    const r = await call("apply_changes", { file, ops: [{ op: "add_vertex", label: "ok" }, { op: "update", id: "Database", label: "x" }] });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/op 1: no cell with id "Database".*"db" \(DB\)/s);
    expect(readFileSync(join(dir, file), "utf8")).toBe(XML);
  });
  test("input from a model is checked", async () => {
    const file = fresh("c.drawio");
    expect(text(await call("apply_changes", { file, ops: "add a box" }))).toContain('"ops" must be a list');
    expect(text(await call("apply_changes", { file, ops: [] }))).toContain("empty");
    expect(text(await call("apply_changes", { file, ops: [{ op: "explode" }] }))).toContain('"op" must be one of');
    expect(text(await call("apply_changes", { file, ops: [{ op: "add_vertex", x: "left" }] }))).toContain('"x" must be a number');
    expect(text(await call("apply_changes", { file, ops: [{ op: "add_edge", source: "api" }] }))).toContain("needs");
  });
  test("two edits at once both land", async () => {
    const file = fresh("d.drawio");
    const [a, b] = await Promise.all([
      call("apply_changes", { file, ops: [{ op: "add_vertex", id: "one" }] }),
      call("apply_changes", { file, ops: [{ op: "add_vertex", id: "two" }] }),
    ]);
    expect(a.isError ?? b.isError).toBeUndefined();
    const after = readFileSync(join(dir, file), "utf8");
    expect(after).toContain('id="one"');
    expect(after).toContain('id="two"');
  });
  test("a .drawio.svg without a browser: data is updated and the answer carries a warning", async () => {
    const plain = createMcp({ version: "0", cwd: dir, browser: "/no/such/browser" });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${XML.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xa;")}"><g>OLD</g></svg>`;
    writeFileSync(join(dir, "s.drawio.svg"), svg);
    const r = ((await plain.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "apply_changes", arguments: { file: "s.drawio.svg", ops: [{ op: "add_vertex", id: "n" }] } } })) as any).result;
    expect(text(r)).toContain("added n");
    expect(text(r)).toContain("Warning:");
    expect(readFileSync(join(dir, "s.drawio.svg"), "utf8")).toContain("<g>OLD</g>");
  });
});

describe("create_diagram", () => {
  test("makes a new file, including missing folders, and refuses to overwrite", async () => {
    expect(text(await call("create_diagram", { file: "sub/new.drawio" }))).toContain("Created");
    expect(existsSync(join(dir, "sub/new.drawio"))).toBe(true);
    expect(text(await call("get_diagram", { file: "sub/new.drawio" }))).toContain("0 shapes");
    expect(text(await call("create_diagram", { file: "sub/new.drawio" }))).toContain("already exists");
  });
});

describe("parseOps", () => {
  test("numbers and ids are converted when that is safe", () => {
    expect(parseOps([{ op: "update", id: 7, x: "12", label: "a" }])).toEqual([{ op: "update", id: "7", x: 12, label: "a" }]);
    expect(parseOps([{ op: "add_vertex", x: null, id: null }])).toEqual([{ op: "add_vertex" }]);
  });
});

// A real session through stdin and stdout, as an agent runs it.
describe("dwio mcp over stdio", () => {
  test("only protocol messages reach stdout, and the session ends when stdin closes", async () => {
    const file = fresh("e.drawio");
    const child = spawn(process.execPath, [new URL("../src/cli.ts", import.meta.url).pathname, "mcp"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const send = (o: object) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_diagram", arguments: { file } } });
    child.stdin.write("this is not json\n");
    child.stdin.end();
    const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
    const lines = out.trim().split("\n").map((l) => JSON.parse(l)); // every stdout line must be JSON
    expect(code).toBe(0);
    expect(lines.map((l) => l.id).sort()).toEqual([1, 2, null]);
    expect(lines.find((l) => l.id === 2).result.content[0].text).toContain("2 shapes");
    expect(lines.find((l) => l.error).error.code).toBe(-32700);
  }, 20000);
});

const canRender = findBrowser().path !== null && isInstalled();
describe.skipIf(!canRender)("render (real browser)", () => {
  test("returns a PNG image the agent can see, plus the saved path", async () => {
    const r = await call("render", { file: fresh("r.drawio") });
    expect(r.isError).toBeUndefined();
    const img = r.content.find((c: any) => c.type === "image");
    expect(img.mimeType).toBe("image/png");
    expect(Buffer.from(img.data, "base64").subarray(1, 4).toString()).toBe("PNG");
    const path = /Saved to (\S+)\./.exec(text(r))![1]!;
    expect(existsSync(path)).toBe(true);
    mcp.close();
    expect(existsSync(path)).toBe(false);
  }, 60000);
  test("a .drawio.svg is redrawn after apply_changes", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${XML.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xa;")}"><g>OLD</g></svg>`;
    writeFileSync(join(dir, "r.drawio.svg"), svg);
    const r = await call("apply_changes", { file: "r.drawio.svg", ops: [{ op: "add_vertex", id: "n", label: "Fresh Label" }] });
    expect(text(r)).toContain("The picture was redrawn.");
    const after = readFileSync(join(dir, "r.drawio.svg"), "utf8");
    expect(after).toContain("Fresh Label");
    expect(after).not.toContain("<g>OLD</g>");
  }, 90000);
});
