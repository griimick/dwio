import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInstalled, webappDir } from "../src/assets.ts";
import { findBrowser } from "../src/browser.ts";
import { describe as read } from "../src/diagram.ts";
import { editDiagramFile, readDiagramFile } from "../src/diagram-file.ts";
import { exportDiagram } from "../src/export.ts";
import { emptyFile } from "../src/format.ts";
import { COLORS, CONTAINER_STYLE, EDGE_STYLES, SHAPE_STYLES, STYLE_GUIDE } from "../src/style-guide.ts";

describe("the guide text", () => {
  test("lists every style that the tests draw", () => {
    for (const [, style] of SHAPE_STYLES) expect(STYLE_GUIDE).toContain(style);
    for (const [, fill, stroke] of COLORS) expect(STYLE_GUIDE).toContain(`fillColor=${fill};strokeColor=${stroke};`);
    for (const [, style] of EDGE_STYLES) expect(STYLE_GUIDE).toContain(style);
    expect(STYLE_GUIDE).toContain(CONTAINER_STYLE);
  });
  test("every shape style keeps html=1, as the guide tells agents to do", () => {
    for (const [name, style] of SHAPE_STYLES) expect([name, style.includes("html=1")]).toEqual([name, true]);
    for (const [name, style] of EDGE_STYLES) expect([name, style.includes("html=1")]).toEqual([name, true]);
  });
  test("is short enough to read once (about 1,000 tokens), and tells where icons come from", () => {
    expect(STYLE_GUIDE.length).toBeLessThan(5000);
    expect(STYLE_GUIDE).toContain("search_shapes");
    expect(STYLE_GUIDE).toContain("Not possible with these tools yet");
  });
});

const canRender = findBrowser().path !== null && isInstalled();
describe.skipIf(!canRender)("draw.io draws every style of the guide", () => {
  const dir = mkdtempSync(join(tmpdir(), "dwio-guide-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  test("shapes, colors, arrows and a container with children", async () => {
    const f = join(dir, "guide.drawio");
    writeFileSync(f, emptyFile("drawio"));
    const ops: any[] = [];
    SHAPE_STYLES.forEach(([n, style, w, h], i) => ops.push({ op: "add_vertex", id: `s${i}`, label: n, style, x: 20 + (i % 5) * 170, y: 20 + Math.floor(i / 5) * 130, width: w, height: h }));
    COLORS.forEach(([n, fill, stroke], i) => ops.push({ op: "add_vertex", id: `c${i}`, label: n, style: `rounded=1;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};`, x: 20 + i * 120, y: 290, width: 100, height: 40 }));
    EDGE_STYLES.forEach(([n, style], i) =>
      ops.push({ op: "add_vertex", id: `a${i}`, label: "A", x: 20, y: 360 + i * 70, width: 50, height: 40 }, { op: "add_vertex", id: `b${i}`, label: "B", x: 300, y: 360 + i * 70, width: 50, height: 40 }, { op: "add_edge", source: `a${i}`, target: `b${i}`, style, label: n.slice(0, 12) }),
    );
    ops.push(
      { op: "add_vertex", id: "box", label: "Container", style: CONTAINER_STYLE, x: 420, y: 360, width: 360, height: 200 },
      { op: "add_vertex", id: "k1", label: "Child", parent: "box", x: 20, y: 50, width: 120, height: 60 },
      { op: "add_vertex", id: "k2", label: "Child", parent: "box", x: 200, y: 50, width: 120, height: 60 },
      { op: "add_edge", id: "ke", source: "k1", target: "k2", parent: "box", style: EDGE_STYLES[0]![1] },
    );
    await editDiagramFile(f, ops, {});
    const cells = readDiagramFile(f).pages[0]!.cells;
    expect(cells.filter((c) => c.type === "vertex")).toHaveLength(SHAPE_STYLES.length + COLORS.length + EDGE_STYLES.length * 2 + 3);
    // a child sits inside its container: parent, and its page position adds the container's offset
    expect(read(readDiagramFile(f).xml)[0]!.cells.find((c) => c.id === "k1")).toMatchObject({ parent: "box", x: 20, absX: 440, absY: 410 });

    const [img] = await exportDiagram({ file: f, webapp: webappDir(), out: join(dir, "guide.png"), scale: 1 });
    // The picture must reach the lowest and rightmost shapes: draw.io accepted every style and kept every cell.
    expect(img!.width!).toBeGreaterThan(780);
    expect(img!.height!).toBeGreaterThan(650);
  }, 90000);
});
