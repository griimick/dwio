import { test } from "bun:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { EMPTY_MXFILE, decompressDiagrams, emptyFile, escapeAttr, extractMxfileFromSvg, kindFromPath, normalizeForDisk, toEditorXml } from "../src/format.ts";

test("kindFromPath", () => {
  assert.equal(kindFromPath("a.drawio"), "drawio");
  assert.equal(kindFromPath("a.drawio.svg"), "svg");
  assert.equal(kindFromPath("A.SVG"), "svg");
  assert.equal(kindFromPath("a.xml"), "drawio");
});

test("svg round trip of embedded mxfile", () => {
  const svg = emptyFile("svg");
  assert.equal(extractMxfileFromSvg(svg), EMPTY_MXFILE);
});

test("escapes quotes, newlines and entities in content attr", () => {
  const xml = '<a v="x &amp; y">\n</a>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${escapeAttr(xml)}"/>`;
  assert.equal(extractMxfileFromSvg(svg), xml);
});

test("svg without content attr is not loadable", () => {
  assert.equal(toEditorXml("<svg xmlns='http://www.w3.org/2000/svg'/>", "svg"), null);
});

test("empty file loads as empty diagram", () => {
  assert.equal(toEditorXml("  \n", "drawio"), EMPTY_MXFILE);
});

test("decompressDiagrams inflates draw.io compressed pages", () => {
  const model = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
  const body = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
  const out = decompressDiagrams(`<mxfile><diagram id="1">${body}</diagram></mxfile>`);
  assert.equal(out, `<mxfile><diagram id="1">${model}</diagram></mxfile>`);
});

test("normalizeForDisk expands compressed pages inside svg content and drawio files", () => {
  const model = '<mxGraphModel><root><mxCell id="0" value="a &amp; b"/></root></mxGraphModel>';
  const body = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
  const mx = `<mxfile><diagram id="1">${body}</diagram></mxfile>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${escapeAttr(mx)}"><g/></svg>`;
  const out = normalizeForDisk(svg, "svg");
  assert.equal(extractMxfileFromSvg(out), `<mxfile><diagram id="1">${model}</diagram></mxfile>`);
  assert.ok(out.endsWith("<g/></svg>"));
  assert.equal(normalizeForDisk(mx, "drawio"), `<mxfile><diagram id="1">${model}</diagram></mxfile>`);
});
