import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstalled, webappDir } from "../src/assets.ts";
import { findBrowser } from "../src/browser.ts";
import { editDiagramFile, readDiagramFile } from "../src/diagram-file.ts";
import { embedMxfile, extractMxfileFromSvg } from "../src/format.ts";

const XML = `<mxfile>
  <diagram id="p" name="P">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a" parent="1" style="html=1;" value="Alpha" vertex="1">
          <mxGeometry height="40" width="80" x="20" y="20" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
const dir = mkdtempSync(join(tmpdir(), "dwio-dfile-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("embedMxfile replaces the content attribute and nothing else", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="5px" content="old &quot;x&quot;"><g>picture $1 $&</g></svg>`;
  const out = embedMxfile(svg, `<mxfile a="$& $1">é</mxfile>`);
  expect(extractMxfileFromSvg(out)).toBe(`<mxfile a="$& $1">é</mxfile>`);
  expect(out).toContain(`<g>picture $1 $&</g>`);
  expect(out).toContain(`width="5px"`);
});

test("embedMxfile adds the attribute when there is none", () => {
  expect(extractMxfileFromSvg(embedMxfile(`<svg xmlns="http://www.w3.org/2000/svg"/>`, "<mxfile/>"))).toBe("<mxfile/>");
});

describe(".drawio files", () => {
  test("edit writes plain XML with a minimal diff", async () => {
    const f = join(dir, "a.drawio");
    writeFileSync(f, XML);
    const r = await editDiagramFile(f, [{ op: "update", id: "a", label: "Beta" }]);
    expect(r.changes).toEqual([{ op: 0, action: "updated", id: "a", page: 1 }]);
    expect(r.rendered).toBeUndefined();
    const after = readFileSync(f, "utf8");
    expect(after.replace("Beta", "Alpha")).toBe(XML);
    expect(readDiagramFile(f).pages[0]!.cells.find((c) => c.id === "a")!.label).toBe("Beta");
  });
  test("an error leaves the file untouched", async () => {
    const f = join(dir, "b.drawio");
    writeFileSync(f, XML);
    await expect(editDiagramFile(f, [{ op: "delete", id: "nope" }])).rejects.toThrow(/no cell with id "nope"/);
    expect(readFileSync(f, "utf8")).toBe(XML);
  });
});

describe(".drawio.svg files", () => {
  test("without rendering: the data is updated and a warning says the picture is old", async () => {
    const f = join(dir, "c.drawio.svg");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${XML.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xa;")}"><g>OLD PICTURE</g></svg>`;
    writeFileSync(f, svg);
    const r = await editDiagramFile(f, [{ op: "add_vertex", id: "n", label: "New" }], { render: "never" });
    expect(r.rendered).toBe(false);
    expect(r.warning).toContain("not redrawn");
    const after = readFileSync(f, "utf8");
    expect(after).toContain("<g>OLD PICTURE</g>");
    expect(readDiagramFile(f).pages[0]!.cells.map((c) => c.id)).toEqual(["1", "a", "n"]);
  });
});

const canRender = findBrowser().path !== null && isInstalled();
describe.skipIf(!canRender)("redrawing the picture (real browser)", () => {
  test("picture and data both show the edit, and the file stays a valid .drawio.svg", async () => {
    const f = join(dir, "d.drawio.svg");
    const src = new URL("../examples/flow.drawio.svg", import.meta.url).pathname;
    copyFileSync(src, f);
    const r = await editDiagramFile(f, [{ op: "add_vertex", id: "cache", label: "Cache Layer", x: 200, y: 200 }], { webapp: webappDir() });
    expect(r).toMatchObject({ rendered: true });
    expect(r.warning).toBeUndefined();
    const out = readFileSync(f, "utf8");
    expect(out).toContain("Cache Layer"); // in the picture
    expect(readDiagramFile(f).pages[0]!.cells.some((c) => c.id === "cache" && c.label === "Cache Layer")).toBe(true); // in the data
    expect(out).not.toMatch(/<diagram[^>]*>[A-Za-z0-9+/=]{40,}<\/diagram>/); // not compressed
  }, 90000);
});
