import { randomBytes } from "node:crypto";
import { decompressDiagrams } from "./format.ts";
import { appendChild, attr, escapeAttrValue, parseXml, removeAttr, removeElement, setAttr, type El } from "./xml.ts";

/**
 * Reads and edits draw.io diagram XML for agents. Edits are text patches, so unchanged lines stay byte-for-byte
 * identical and a change shows in `git diff` as only the lines that changed. New cells use the same attribute
 * order and spacing as the draw.io editor writes. Input may be compressed; output is always plain XML.
 */

// ---------- operations -----------------------------------------------------------------------------------

export interface Box {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}
export interface AddVertex extends Box {
  op: "add_vertex";
  id?: string;
  page?: string | number;
  parent?: string;
  label?: string;
  style?: string;
}
export interface AddEdge {
  op: "add_edge";
  id?: string;
  page?: string | number;
  parent?: string;
  source: string;
  target: string;
  label?: string;
  style?: string;
  points?: { x: number; y: number }[];
}
export interface Update extends Box {
  op: "update";
  id: string;
  page?: string | number;
  label?: string;
  /** Replaces the whole style. */
  style?: string;
  /** Merges keys into the style. A null value removes the key. */
  style_set?: Record<string, string | number | null>;
  parent?: string;
  source?: string;
  target?: string;
}
export interface Delete {
  op: "delete";
  id: string;
  page?: string | number;
}
export type Op = AddVertex | AddEdge | Update | Delete;

export interface Change {
  op: number;
  action: "added" | "updated" | "deleted";
  id: string;
  page: number;
}
export interface EditResult {
  xml: string;
  changes: Change[];
}

export class EditError extends Error {
  opIndex: number | null;
  constructor(message: string, opIndex: number | null = null) {
    super(opIndex === null ? message : `op ${opIndex}: ${message}`);
    this.opIndex = opIndex;
  }
}

// ---------- style and label helpers ----------------------------------------------------------------------

export function parseStyle(style: string): [string, string | null][] {
  return style
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const eq = p.indexOf("=");
      return eq < 0 ? [p, null] : [p.slice(0, eq), p.slice(eq + 1)];
    });
}

export function mergeStyle(style: string, set: Record<string, string | number | null>): string {
  const pairs = parseStyle(style);
  for (const [k, v] of Object.entries(set)) {
    const i = pairs.findIndex(([key]) => key === k);
    if (v === null) {
      if (i >= 0) pairs.splice(i, 1);
    } else if (i >= 0) pairs[i] = [k, String(v)];
    else pairs.push([k, String(v)]);
  }
  return pairs.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join(";") + (pairs.length ? ";" : "");
}

const isHtml = (style: string): boolean => parseStyle(style).some(([k, v]) => k === "html" && v === "1");

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n+$/, "");
}

/** Plain-text label to the stored value. HTML labels get escaped, and line breaks become <br>. */
function labelToValue(label: string, style: string): string {
  if (!isHtml(style)) return label;
  return label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

// ---------- reading --------------------------------------------------------------------------------------

export interface CellInfo {
  id: string;
  type: "vertex" | "edge" | "layer";
  label: string;
  style: string;
  parent: string | null;
  source?: string;
  target?: string;
  /** Geometry as stored (relative to the parent). */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Top-left corner on the page, after adding up the parents' offsets. */
  absX?: number;
  absY?: number;
  points?: { x: number; y: number }[];
}
export interface PageInfo {
  index: number;
  id: string;
  name: string;
  cells: CellInfo[];
}

interface Ref {
  id: string;
  /** Element that is a direct child of <root>: the <mxCell>, or its <object> wrapper. */
  top: El;
  cell: El;
  wrapped: boolean;
}

interface Page {
  index: number;
  diagram: El | null;
  model: El;
  root: El;
}

function pagesOf(doc: El): Page[] {
  const diagrams = doc.name === "mxfile" ? doc.children.filter((c) => c.name === "diagram") : [];
  const models: { diagram: El | null; model: El }[] =
    doc.name === "mxGraphModel" ? [{ diagram: null, model: doc }] : diagrams.map((d) => ({ diagram: d, model: d.children.find((c) => c.name === "mxGraphModel") as El }));
  if (!models.length) throw new EditError("the file has no diagram pages");
  return models.map(({ diagram, model }, i) => {
    const root = model?.children.find((c) => c.name === "root");
    if (!root) throw new EditError(`page ${i + 1} has no content (it may still be compressed)`);
    return { index: i + 1, diagram, model, root };
  });
}

function refsOf(root: El): Ref[] {
  const out: Ref[] = [];
  for (const top of root.children) {
    if (top.name === "mxCell") {
      const id = attr(top, "id");
      if (id !== undefined) out.push({ id, top, cell: top, wrapped: false });
    } else if (top.name === "object" || top.name === "UserObject") {
      const cell = top.children.find((c) => c.name === "mxCell");
      const id = attr(top, "id");
      if (cell && id !== undefined) out.push({ id, top, cell, wrapped: true });
    }
  }
  return out;
}

const num = (el: El | undefined, name: string): number | undefined => {
  const v = el ? attr(el, name) : undefined;
  return v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);
};
const geometryOf = (cell: El): El | undefined => cell.children.find((c) => c.name === "mxGeometry");
const labelOf = (r: Ref): string => (r.wrapped ? (attr(r.top, "label") ?? "") : (attr(r.cell, "value") ?? ""));

function readCells(refs: Ref[]): CellInfo[] {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const absolute = (r: Ref, seen = new Set<string>()): { x: number; y: number } | undefined => {
    const g = geometryOf(r.cell);
    const x = num(g, "x");
    const y = num(g, "y");
    if (x === undefined || y === undefined || seen.has(r.id)) return undefined;
    seen.add(r.id);
    const parent = byId.get(attr(r.cell, "parent") ?? "");
    const base = parent && parent.cell.attrs.some((a) => a.name === "vertex") ? absolute(parent, seen) : undefined;
    return { x: x + (base?.x ?? 0), y: y + (base?.y ?? 0) };
  };
  const cells: CellInfo[] = [];
  for (const r of refs) {
    const id = r.id;
    if (id === "0") continue;
    const parent = attr(r.cell, "parent") ?? null;
    const style = attr(r.cell, "style") ?? "";
    const raw = labelOf(r);
    const type = attr(r.cell, "edge") === "1" ? "edge" : attr(r.cell, "vertex") === "1" ? "vertex" : parent === "0" ? "layer" : "vertex";
    const g = geometryOf(r.cell);
    const info: CellInfo = { id, type, label: isHtml(style) ? htmlToText(raw) : raw, style, parent };
    if (type === "edge") {
      info.source = attr(r.cell, "source");
      info.target = attr(r.cell, "target");
      const pts = g?.children.find((c) => c.name === "Array")?.children.filter((c) => c.name === "mxPoint");
      if (pts?.length) info.points = pts.map((p) => ({ x: num(p, "x") ?? 0, y: num(p, "y") ?? 0 }));
    } else if (type === "vertex") {
      Object.assign(info, { x: num(g, "x"), y: num(g, "y"), width: num(g, "width"), height: num(g, "height") });
      const abs = absolute(r);
      if (abs) Object.assign(info, { absX: abs.x, absY: abs.y });
    }
    cells.push(info);
  }
  return cells;
}

/** Pages and cells of a diagram, in a compact form that is easy for an agent to read. */
export function describe(mxfile: string): PageInfo[] {
  const doc = parseXml(decompressDiagrams(mxfile));
  return pagesOf(doc).map((p) => ({
    index: p.index,
    id: p.diagram ? (attr(p.diagram, "id") ?? "") : "",
    name: p.diagram ? (attr(p.diagram, "name") ?? `Page-${p.index}`) : "Page-1",
    cells: readCells(refsOf(p.root)),
  }));
}

// ---------- editing --------------------------------------------------------------------------------------

const newId = (taken: Set<string>): string => {
  for (;;) {
    const id = `dwio-${randomBytes(3).toString("hex")}`;
    if (!taken.has(id)) return id;
  }
};

function pickPage(pages: Page[], spec: string | number | undefined): Page {
  if (spec === undefined) return pages[0]!;
  const s = String(spec);
  const hit =
    pages.find((p) => p.diagram && attr(p.diagram, "id") === s) ??
    pages.find((p) => p.diagram && attr(p.diagram, "name") === s) ??
    pages.find((p) => String(p.index) === s);
  if (!hit) throw new EditError(`no page "${s}". Pages: ${pages.map((p) => `${p.index}=${p.diagram ? attr(p.diagram, "name") : "Page-1"}`).join(", ")}`);
  return hit;
}

function suggestions(id: string, cells: CellInfo[]): string {
  const q = id.toLowerCase();
  const near = cells.filter((c) => c.id.toLowerCase().includes(q) || (c.label && c.label.toLowerCase().includes(q)) || q.includes(c.id.toLowerCase())).slice(0, 5);
  const list = (near.length ? near : cells.slice(0, 8)).map((c) => `"${c.id}"${c.label ? ` (${c.label.replace(/\n/g, " ").slice(0, 30)})` : ""}`);
  return list.length ? ` ${near.length ? "Similar" : "Some ids"}: ${list.join(", ")}.` : "";
}

const find = (refs: Ref[], id: string, cells: () => CellInfo[], what = "cell"): Ref => {
  const r = refs.find((x) => x.id === id);
  if (!r) throw new EditError(`no ${what} with id "${id}".${suggestions(id, cells())}`);
  return r;
};

const attrsToTag = (name: string, attrs: [string, string | number | undefined][], selfClose: string): string => {
  const parts = attrs.filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}="${escapeAttrValue(String(v))}"`);
  return `<${name} ${parts.join(" ")}${selfClose}`;
};

/** Where to put a new vertex when no position is given: right of everything, level with the top. */
function freeSpot(cells: CellInfo[]): { x: number; y: number } {
  const boxes = cells.filter((c) => c.type === "vertex" && c.absX !== undefined && c.absY !== undefined);
  if (!boxes.length) return { x: 40, y: 40 };
  return { x: Math.max(...boxes.map((b) => b.absX! + (b.width ?? 0))) + 40, y: Math.min(...boxes.map((b) => b.absY!)) };
}

function ensureUnique(pages: Page[], id: string): void {
  for (const p of pages) if (refsOf(p.root).some((r) => r.id === id)) throw new EditError(`id "${id}" is already used`);
}

function defaultLayer(refs: Ref[]): string {
  return refs.find((r) => r.id !== "0" && attr(r.cell, "parent") === "0")?.id ?? "1";
}

function applyOne(src: string, op: Op, index: number, changes: Change[]): string {
  const doc = parseXml(src);
  const pages = pagesOf(doc);
  const page = pickPage(pages, "page" in op ? op.page : undefined);
  const refs = refsOf(page.root);
  const cellsNow = () => readCells(refs);
  const sc = (el: El) => (src.slice(el.tagEnd - 3, el.tagEnd) === " />" ? " />" : "/>"); // keep the file's own style
  const lastCell = page.root.children[page.root.children.length - 1];
  const selfClose = lastCell ? sc(lastCell.selfClosing ? lastCell : (lastCell.children[0] ?? lastCell)) : " />";
  const record = (action: Change["action"], id: string) => changes.push({ op: index, action, id, page: page.index });

  if (op.op === "add_vertex") {
    const all = pages.flatMap((p) => refsOf(p.root).map((r) => r.id));
    const id = op.id ?? newId(new Set(all));
    ensureUnique(pages, id);
    const parent = op.parent ?? defaultLayer(refs);
    find(refs, parent, cellsNow, "parent");
    const style = op.style ?? "rounded=0;whiteSpace=wrap;html=1;";
    const spot = freeSpot(cellsNow());
    const box = [["height", op.height ?? 60], ["width", op.width ?? 120], ["x", op.x ?? spot.x], ["y", op.y ?? spot.y]].map(([k, v]) => `${k}="${v}"`).join(" ");
    const geoOrdered = `<mxGeometry ${box} as="geometry"${selfClose}`; // the editor writes "as" last
    const cell = attrsToTag("mxCell", [["id", id], ["parent", parent], ["style", style], ["value", labelToValue(op.label ?? "", style)], ["vertex", "1"]], ">");
    const pretty = `${cell}\n  ${geoOrdered}\n</mxCell>`;
    const inline = `${cell}${geoOrdered}</mxCell>`;
    record("added", id);
    return appendChild(src, page.root, pretty, inline);
  }

  if (op.op === "add_edge") {
    const all = pages.flatMap((p) => refsOf(p.root).map((r) => r.id));
    const id = op.id ?? newId(new Set(all));
    ensureUnique(pages, id);
    const parent = op.parent ?? defaultLayer(refs);
    find(refs, parent, cellsNow, "parent");
    find(refs, op.source, cellsNow, "source cell");
    find(refs, op.target, cellsNow, "target cell");
    const style = op.style ?? "endArrow=classic;html=1;";
    const cell = attrsToTag("mxCell", [["edge", "1"], ["id", id], ["parent", parent], ["source", op.source], ["style", style], ["target", op.target], ["value", labelToValue(op.label ?? "", style)]], ">");
    const pts = op.points?.length;
    const point = (p: { x: number; y: number }) => `<mxPoint x="${p.x}" y="${p.y}"${selfClose}`;
    const geoOpen = `<mxGeometry relative="1" as="geometry"`;
    const pretty = pts
      ? `${cell}\n  ${geoOpen}>\n    <Array as="points">\n${op.points!.map((p) => `      ${point(p)}`).join("\n")}\n    </Array>\n  </mxGeometry>\n</mxCell>`
      : `${cell}\n  ${geoOpen}${selfClose}\n</mxCell>`;
    const inline = pts ? `${cell}${geoOpen}><Array as="points">${op.points!.map(point).join("")}</Array></mxGeometry></mxCell>` : `${cell}${geoOpen}${selfClose}</mxCell>`;
    record("added", id);
    return appendChild(src, page.root, pretty, inline);
  }

  if (op.op === "update") {
    const ref = find(refs, op.id, cellsNow);
    if (op.id === "0") throw new EditError("cannot change the root cell");
    const style = attr(ref.cell, "style") ?? "";
    const newStyle = op.style !== undefined ? op.style : op.style_set ? mergeStyle(style, op.style_set) : undefined;
    const edits: { on: "top" | "cell" | "geometry"; name: string; value: string | null }[] = [];
    const currentLabel = isHtml(style) ? htmlToText(labelOf(ref)) : labelOf(ref);
    const asked = op.label !== undefined || op.style !== undefined || op.style_set !== undefined || ["parent", "source", "target", "x", "y", "width", "height"].some((k) => (op as unknown as Record<string, unknown>)[k] !== undefined);
    // A value that is already right is left alone, so the file does not change for nothing.
    if (op.label !== undefined && (op.label !== currentLabel || (newStyle !== undefined && isHtml(newStyle) !== isHtml(style)))) edits.push(ref.wrapped ? { on: "top", name: "label", value: labelToValue(op.label, newStyle ?? style) } : { on: "cell", name: "value", value: labelToValue(op.label, newStyle ?? style) });
    if (newStyle !== undefined && newStyle !== style) edits.push({ on: "cell", name: "style", value: newStyle });
    for (const k of ["parent", "source", "target"] as const) {
      const v = op[k];
      if (v === undefined) continue;
      if (v !== "") find(refs, v, cellsNow, `${k} cell`);
      if (v !== (attr(ref.cell, k) ?? "")) edits.push({ on: "cell", name: k, value: v === "" ? null : v });
    }
    const box = (["x", "y", "width", "height"] as const).filter((k) => op[k] !== undefined);
    if (box.length) {
      if (geometryOf(ref.cell)?.name !== "mxGeometry") throw new EditError(`cell "${op.id}" has no geometry to change`);
      for (const k of box) if (String(op[k]) !== attr(geometryOf(ref.cell)!, k)) edits.push({ on: "geometry", name: k, value: String(op[k]) });
    }
    if (!asked) throw new EditError(`update of "${op.id}" changes nothing; give label, style, style_set, x, y, width, height, parent, source or target`);
    if (!edits.length) {
      record("updated", op.id);
      return src;
    }
    // Each edit moves the text, so find the element again in a fresh parse before every edit.
    let out = src;
    for (const e of edits) {
      const r = refsOf(pickPage(pagesOf(parseXml(out)), op.page).root).find((x) => x.id === op.id)!;
      const el = e.on === "top" ? r.top : e.on === "cell" ? r.cell : geometryOf(r.cell)!;
      out = e.value === null ? removeAttr(out, el, e.name) : setAttr(out, el, e.name, e.value);
    }
    record("updated", op.id);
    return out;
  }

  // delete
  const ref = find(refs, op.id, cellsNow);
  if (ref.id === "0" || refs.find((r) => r.id === ref.id && attr(r.cell, "parent") === "0")) throw new EditError(`cannot delete the layer or root "${op.id}"`);
  const doomed = new Set([op.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of refs) {
      if (doomed.has(r.id)) continue;
      const p = attr(r.cell, "parent");
      const s = attr(r.cell, "source");
      const t = attr(r.cell, "target");
      if ((p && doomed.has(p)) || (s && doomed.has(s)) || (t && doomed.has(t))) {
        doomed.add(r.id);
        grew = true;
      }
    }
  }
  // Remove from the end of the file toward the start so earlier offsets stay valid.
  const spans = refs.filter((r) => doomed.has(r.id)).sort((a, b) => b.top.start - a.top.start);
  let out = src;
  for (const r of spans) {
    out = removeElement(out, r.top);
    record("deleted", r.id);
  }
  return out;
}

/** Applies the operations in order. Either all succeed or an EditError is thrown and nothing is returned. */
export function editMxfile(xml: string, ops: Op[]): EditResult {
  let src = decompressDiagrams(xml);
  const changes: Change[] = [];
  ops.forEach((op, i) => {
    try {
      src = applyOne(src, op, i, changes);
    } catch (e) {
      throw e instanceof EditError ? new EditError(e.message.replace(/^op \d+: /, ""), i) : e;
    }
  });
  parseXml(src); // the result must still be well-formed
  return { xml: src, changes };
}

// ---------- input from agents ----------------------------------------------------------------------------

const NUMBER_FIELDS = ["x", "y", "width", "height"] as const;
const STRING_FIELDS = ["id", "parent", "label", "style", "source", "target"] as const;
const OP_NAMES = ["add_vertex", "add_edge", "update", "delete"];

/** Checks operations that come from a language model (wrong types are common) and converts what is safe to convert. */
export function parseOps(input: unknown): Op[] {
  if (!Array.isArray(input)) throw new EditError('"ops" must be a list of operations');
  if (input.length === 0) throw new EditError('"ops" is empty; give at least one operation');
  return input.map((raw, i) => {
    const fail = (m: string): never => {
      throw new EditError(m, i);
    };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("each operation must be an object");
    const o = { ...(raw as Record<string, unknown>) };
    if (typeof o.op !== "string" || !OP_NAMES.includes(o.op)) return fail(`"op" must be one of ${OP_NAMES.join(", ")}`);
    for (const k of NUMBER_FIELDS) {
      if (o[k] === undefined || o[k] === null) delete o[k];
      else if (typeof o[k] === "string" && o[k] !== "" && Number.isFinite(Number(o[k]))) o[k] = Number(o[k]);
      else if (typeof o[k] !== "number" || !Number.isFinite(o[k])) fail(`"${k}" must be a number`);
    }
    for (const k of STRING_FIELDS) {
      if (o[k] === undefined || o[k] === null) delete o[k];
      else if (typeof o[k] === "number") o[k] = String(o[k]); // an id such as 7 is fine
      else if (typeof o[k] !== "string") fail(`"${k}" must be text`);
    }
    if (o.page !== undefined && o.page !== null && typeof o.page !== "string" && typeof o.page !== "number") fail('"page" must be a page name, id or number');
    if (o.page === null) delete o.page;
    if (o.style_set !== undefined) {
      const ss = o.style_set as Record<string, unknown>;
      if (!ss || typeof ss !== "object" || Array.isArray(ss) || Object.values(ss).some((v) => v !== null && typeof v !== "string" && typeof v !== "number")) fail('"style_set" must be an object of style keys; a value of null removes a key');
    }
    if (o.points !== undefined) {
      const pts = o.points as unknown;
      if (!Array.isArray(pts) || pts.some((p) => !p || typeof (p as { x: unknown }).x !== "number" || typeof (p as { y: unknown }).y !== "number")) fail('"points" must be a list of {x, y} numbers');
    }
    if ((o.op === "update" || o.op === "delete") && typeof o.id !== "string") fail(`"${o.op}" needs an "id"`);
    if (o.op === "add_edge" && (typeof o.source !== "string" || typeof o.target !== "string")) fail('"add_edge" needs "source" and "target" ids');
    return o as unknown as Op;
  });
}
