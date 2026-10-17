import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { isInstalled, webappDir } from "../src/assets.ts";
import { findBrowser } from "../src/browser.ts";
import { describe as read, editMxfile, EditError, mergeStyle } from "../src/diagram.ts";
import { exportDiagram } from "../src/export.ts";
import { parseXml, XmlError } from "../src/xml.ts";

// Written the way the draw.io editor writes files: pretty-printed, alphabetical attributes, " />".
const PRETTY = `<mxfile host="test">
  <diagram id="p1" name="Flow">
    <mxGraphModel dx="800" dy="600" grid="1">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="api" parent="1" style="rounded=1;whiteSpace=wrap;html=1;" value="API &amp;amp; Gateway&lt;br&gt;v2" vertex="1">
          <mxGeometry height="60" width="140" x="40" y="80" as="geometry" />
        </mxCell>
        <mxCell id="db" parent="1" style="shape=cylinder3;" value="Database" vertex="1">
          <mxGeometry height="80" width="100" x="300" y="70" as="geometry" />
        </mxCell>
        <mxCell id="grp" parent="1" style="swimlane;" value="Group" vertex="1">
          <mxGeometry height="200" width="200" x="500" y="100" as="geometry" />
        </mxCell>
        <object id="inner" label="Inner box" tooltip="t">
          <mxCell parent="grp" style="whiteSpace=wrap;" vertex="1">
            <mxGeometry height="40" width="80" x="20" y="30" as="geometry" />
          </mxCell>
        </object>
        <mxCell id="e1" edge="1" parent="1" source="api" style="endArrow=classic;html=1;" target="db" value="reads">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" edge="1" parent="1" source="db" style="endArrow=classic;html=1;" target="inner">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;

const INLINE = `<mxfile><diagram id="p1" name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" style="html=1;" value="A" vertex="1"><mxGeometry x="10" y="10" width="50" height="30" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`;

/** Lines that exist only in a (removed) or only in b (added), as multisets. */
function lineDiff(a: string, b: string): { removed: string[]; added: string[] } {
  const count = (s: string) => s.split("\n").reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
  const ca = count(a);
  const cb = count(b);
  const out = { removed: [] as string[], added: [] as string[] };
  for (const [l, n] of ca) for (let i = 0; i < n - (cb.get(l) ?? 0); i++) out.removed.push(l);
  for (const [l, n] of cb) for (let i = 0; i < n - (ca.get(l) ?? 0); i++) out.added.push(l);
  return out;
}

describe("xml parser", () => {
  test("positions, quotes, comments, declarations", () => {
    const src = `<?xml version="1.0"?><!-- c --><a x='1' y="2"><b/><c z="&amp;">t</c></a>`;
    const a = parseXml(src);
    expect(a.name).toBe("a");
    expect(a.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(src.slice(a.children[1]!.start, a.children[1]!.end)).toBe(`<c z="&amp;">t</c>`);
    expect(a.attrs.map((x) => [x.name, x.raw, x.quote])).toEqual([["x", "1", "'"], ["y", "2", '"']]);
  });
  test("malformed input throws", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
    expect(() => parseXml("<a x=1/>")).toThrow(/not quoted/);
    expect(() => parseXml("<a>")).toThrow(/not closed/);
  });
});

describe("describe (reading)", () => {
  const [page] = read(PRETTY);
  const cell = (id: string) => page!.cells.find((c) => c.id === id)!;
  test("pages and cells", () => {
    expect(page).toMatchObject({ index: 1, id: "p1", name: "Flow" });
    expect(page!.cells.map((c) => c.id)).toEqual(["1", "api", "db", "grp", "inner", "e1", "e2"]);
    expect(cell("1").type).toBe("layer");
    expect(cell("e1")).toMatchObject({ type: "edge", source: "api", target: "db", label: "reads" });
  });
  test("html labels become plain text", () => {
    expect(cell("api").label).toBe("API & Gateway\nv2");
    expect(cell("db").label).toBe("Database");
  });
  test("object wrapper: id and label come from the wrapper, geometry from the inner cell", () => {
    expect(cell("inner")).toMatchObject({ type: "vertex", label: "Inner box", parent: "grp", x: 20, y: 30, width: 80, height: 40 });
  });
  test("absolute position adds up parents", () => {
    expect(cell("inner")).toMatchObject({ absX: 520, absY: 130 });
    expect(cell("api")).toMatchObject({ absX: 40, absY: 80 });
  });
  test("compressed pages are read too", () => {
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" value="Zip" vertex="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></root></mxGraphModel>`;
    const body = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    expect(read(`<mxfile><diagram id="z" name="Z">${body}</diagram></mxfile>`)[0]!.cells.find((c) => c.id === "a")!.label).toBe("Zip");
  });
});

describe("editing keeps the diff small", () => {
  test("update label changes exactly one line", () => {
    const { xml, changes } = editMxfile(PRETTY, [{ op: "update", id: "db", label: "Postgres" }]);
    const d = lineDiff(PRETTY, xml);
    expect(d.removed).toHaveLength(1);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toContain('value="Postgres"');
    expect(changes).toEqual([{ op: 0, action: "updated", id: "db", page: 1 }]);
  });
  test("a value that is already right changes nothing in the file", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "update", id: "db", label: "Database", x: 300, style_set: { shape: "cylinder3" } }]);
    expect(xml).toBe(PRETTY);
  });
  test("update of an object wrapper sets its label attribute", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "update", id: "inner", label: "Renamed" }]);
    expect(lineDiff(PRETTY, xml).added[0]).toContain('label="Renamed"');
    expect(read(xml)[0]!.cells.find((c) => c.id === "inner")!.label).toBe("Renamed");
  });
  test("style_set merges keys and null removes one", () => {
    expect(mergeStyle("rounded=1;whiteSpace=wrap;", { rounded: null, fillColor: "#fff" })).toBe("whiteSpace=wrap;fillColor=#fff;");
    const { xml } = editMxfile(PRETTY, [{ op: "update", id: "api", style_set: { fillColor: "#d5e8d4", rounded: null } }]);
    expect(read(xml)[0]!.cells.find((c) => c.id === "api")!.style).toBe("whiteSpace=wrap;html=1;fillColor=#d5e8d4;");
    expect(lineDiff(PRETTY, xml).removed).toHaveLength(1);
  });
  test("moving and resizing touches only the geometry line", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "update", id: "db", x: 400, width: 120 }]);
    const d = lineDiff(PRETTY, xml);
    expect(d.removed).toEqual(['          <mxGeometry height="80" width="100" x="300" y="70" as="geometry" />']);
    expect(d.added).toEqual(['          <mxGeometry height="80" width="120" x="400" y="70" as="geometry" />']);
  });
  test("html labels are escaped and round-trip", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "update", id: "api", label: "A & <B>\nsecond" }]);
    expect(read(xml)[0]!.cells.find((c) => c.id === "api")!.label).toBe("A & <B>\nsecond");
    expect(() => parseXml(xml)).not.toThrow();
  });
  test("add_vertex adds only new lines, indented like its siblings, in the editor's style", () => {
    const { xml, changes } = editMxfile(PRETTY, [{ op: "add_vertex", id: "cache", label: "Cache", x: 200, y: 200, width: 100, height: 50, style: "ellipse;html=1;" }]);
    const d = lineDiff(PRETTY, xml);
    expect(d.removed).toEqual([]);
    expect([...d.added].sort()).toEqual(
      [
        '        <mxCell id="cache" parent="1" style="ellipse;html=1;" value="Cache" vertex="1">',
        '          <mxGeometry height="50" width="100" x="200" y="200" as="geometry" />',
        "        </mxCell>",
      ].sort(),
    );
    expect(changes[0]).toMatchObject({ action: "added", id: "cache" });
    expect(xml.indexOf('id="cache"')).toBeLessThan(xml.indexOf("</root>"));
  });
  test("add_vertex without a position goes right of the existing shapes", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "add_vertex", id: "n", label: "N" }]);
    const n = read(xml)[0]!.cells.find((c) => c.id === "n")!;
    expect(n.absX).toBeGreaterThan(700); // group ends at x=700
    expect(n).toMatchObject({ width: 120, height: 60, parent: "1" });
  });
  test("generated ids are unique and prefixed", () => {
    const { changes } = editMxfile(PRETTY, [{ op: "add_vertex" }, { op: "add_vertex" }]);
    expect(changes[0]!.id).toMatch(/^dwio-[0-9a-f]{6}$/);
    expect(changes[0]!.id).not.toBe(changes[1]!.id);
  });
  test("add_edge with points", () => {
    const { xml } = editMxfile(PRETTY, [{ op: "add_edge", id: "e3", source: "api", target: "grp", label: "x", points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }]);
    const e = read(xml)[0]!.cells.find((c) => c.id === "e3")!;
    expect(e).toMatchObject({ type: "edge", source: "api", target: "grp", label: "x", points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] });
    expect(lineDiff(PRETTY, xml).removed).toEqual([]);
  });
  test("a compact one-line file stays one line", () => {
    const { xml } = editMxfile(INLINE, [{ op: "add_vertex", id: "b", label: "B", x: 100, y: 10 }, { op: "add_edge", id: "e", source: "a", target: "b" }]);
    expect(xml.includes("\n")).toBe(false);
    expect(xml).toContain(`<mxGeometry height="60" width="120" x="100" y="10" as="geometry"/>`);
    expect(read(xml)[0]!.cells.map((c) => c.id)).toEqual(["1", "a", "b", "e"]);
  });
  test("delete removes whole lines, children and attached edges, and leaves no blank line", () => {
    const { xml, changes } = editMxfile(PRETTY, [{ op: "delete", id: "grp" }]);
    const ids = read(xml)[0]!.cells.map((c) => c.id);
    expect(ids).toEqual(["1", "api", "db", "e1"]); // grp, inner (child) and e2 (points at inner) are gone
    expect(changes.map((c) => c.id).sort()).toEqual(["e2", "grp", "inner"]);
    expect(lineDiff(PRETTY, xml).added).toEqual([]);
    expect(xml).not.toMatch(/\n\s*\n/);
  });
  test("compressed input is written back as plain XML", () => {
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`;
    const body = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    const { xml } = editMxfile(`<mxfile><diagram id="z" name="Z">${body}</diagram></mxfile>`, [{ op: "add_vertex", id: "a", label: "A" }]);
    expect(xml).toContain("<mxGraphModel>");
    expect(xml).not.toContain(body);
  });
  test("pages can be chosen by name, id or number", () => {
    const two = `<mxfile><diagram id="a" name="One"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram><diagram id="b" name="Two"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
    for (const page of ["Two", "b", 2, "2"]) {
      const pages = read(editMxfile(two, [{ op: "add_vertex", id: "v" + page, page }]).xml);
      expect(pages[0]!.cells.length).toBe(1);
      expect(pages[1]!.cells.some((c) => c.id === "v" + page)).toBe(true);
    }
  });
});

describe("errors help the agent fix its request", () => {
  const fail = (ops: Parameters<typeof editMxfile>[1]) => {
    try {
      editMxfile(PRETTY, ops);
    } catch (e) {
      expect(e).toBeInstanceOf(EditError);
      return e as EditError;
    }
    throw new Error("expected an error");
  };
  test("unknown id lists similar cells", () => {
    const e = fail([{ op: "update", id: "Database", label: "x" }]);
    expect(e.message).toContain('no cell with id "Database"');
    expect(e.message).toContain('"db" (Database)');
  });
  test("the message names the failing operation, and nothing is half-applied", () => {
    const e = fail([{ op: "add_vertex", id: "ok" }, { op: "add_edge", source: "api", target: "nope" }]);
    expect(e.opIndex).toBe(1);
    expect(e.message).toMatch(/^op 1: no target cell with id "nope"/);
  });
  test("duplicate ids, empty updates, layers and bad pages", () => {
    expect(fail([{ op: "add_vertex", id: "api" }]).message).toContain('already used');
    expect(fail([{ op: "update", id: "api" }]).message).toContain("changes nothing");
    expect(fail([{ op: "delete", id: "1" }]).message).toContain("cannot delete");
    expect(fail([{ op: "add_vertex", page: "Nope" }]).message).toContain("Pages: 1=Flow");
  });
});

// The real test: does draw.io accept and draw what we wrote?
const canRender = findBrowser().path !== null && isInstalled();
describe.skipIf(!canRender)("draw.io renders edited files", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwio-diagram-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  test("added shapes and edges appear in the picture", async () => {
    const before = join(dir, "before.drawio");
    const after = join(dir, "after.drawio");
    writeFileSync(before, PRETTY);
    const { xml } = editMxfile(PRETTY, [
      { op: "add_vertex", id: "cache", label: "Cache", x: 300, y: 300, width: 120, height: 60, style: "rounded=1;fillColor=#fff2cc;html=1;" },
      { op: "add_edge", id: "e9", source: "api", target: "cache", label: "writes", points: [{ x: 110, y: 330 }] },
      { op: "update", id: "db", label: "Postgres", style_set: { fillColor: "#d5e8d4" } },
    ]);
    writeFileSync(after, xml);
    const opts = { webapp: webappDir(), scale: 1 };
    const [a] = await exportDiagram({ file: before, out: join(dir, "a.png"), ...opts });
    const [b] = await exportDiagram({ file: after, out: join(dir, "b.png"), ...opts });
    expect(b!.height!).toBeGreaterThan(a!.height!); // the new shape sits below the old ones
    expect(readFileSync(join(dir, "b.png")).subarray(1, 4).toString()).toBe("PNG");
  }, 90000);
});
