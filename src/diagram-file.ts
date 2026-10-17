import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, editMxfile, type Change, type Op, type PageInfo } from "./diagram.ts";
import { exportDiagram } from "./export.ts";
import { embedMxfile, kindFromPath, normalizeForDisk, toEditorXml } from "./format.ts";
import { findBrowser } from "./browser.ts";
import { atomicWrite } from "./server.ts";

/** File-level reading and editing of .drawio and .drawio.svg files, on top of the XML edit module. */

export function readDiagramFile(path: string): { kind: "drawio" | "svg"; xml: string; pages: PageInfo[] } {
  const kind = kindFromPath(path);
  const xml = toEditorXml(readFileSync(path, "utf8"), kind);
  if (xml === null) throw new Error(`${path} has no embedded draw.io data (no content attribute on <svg>)`);
  return { kind, xml, pages: describe(xml) };
}

export interface EditFileOptions {
  /** Directory of the draw.io editor (needed to redraw the picture of a .drawio.svg). */
  webapp?: string;
  browser?: string;
  /** "auto" (default): redraw the picture if a browser is available. "never": only update the embedded data. */
  render?: "auto" | "never";
  log?: (msg: string) => void;
}

export interface EditFileResult {
  changes: Change[];
  /** For .drawio.svg: true when the picture was redrawn. False means the picture still shows the old diagram. */
  rendered?: boolean;
  warning?: string;
}

export async function editDiagramFile(path: string, ops: Op[], opts: EditFileOptions = {}): Promise<EditFileResult> {
  const { kind, xml } = readDiagramFile(path);
  const { xml: edited, changes } = editMxfile(xml, ops);

  if (kind === "drawio") {
    await atomicWrite(path, edited.endsWith("\n") ? edited : edited + "\n");
    return { changes };
  }

  const original = readFileSync(path, "utf8");
  const canRender = opts.render !== "never" && !!opts.webapp && findBrowser(opts.browser).path !== null;
  if (!canRender) {
    await atomicWrite(path, embedMxfile(original, edited));
    return {
      changes,
      rendered: false,
      warning: opts.render === "never" ? "The picture was not redrawn (render is off); it shows the old diagram until the editor or `dwio export` redraws it." : "The picture was not redrawn because no Chrome, Chromium or Edge browser (or no draw.io editor) was found. The data is updated; the picture shows the old diagram until the editor saves the file.",
    };
  }

  // Redraw: the editor produces picture and data together, so they cannot disagree.
  const dir = mkdtempSync(join(tmpdir(), "dwio-edit-"));
  try {
    const tmp = join(dir, "edited.drawio");
    writeFileSync(tmp, edited);
    await exportDiagram({ file: tmp, webapp: opts.webapp!, out: join(dir, "out.drawio.svg"), format: "drawio.svg", browser: opts.browser, log: opts.log });
    await atomicWrite(path, normalizeForDisk(readFileSync(join(dir, "out.drawio.svg"), "utf8"), "svg"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { changes, rendered: true };
}
