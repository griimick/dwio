import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { browserHelp, findBrowser } from "./browser.ts";
import { launchBrowser, type Page } from "./cdp.ts";
import { kindFromPath, listPages, toEditorXml, type PageInfo } from "./format.ts";
import { startServer } from "./server.ts";

export type ExportFormat = "png" | "svg" | "pdf" | "drawio.svg";

const EXT: Record<ExportFormat, string> = { png: ".png", svg: ".svg", pdf: ".pdf", "drawio.svg": ".drawio.svg" };

export function parseFormat(s: string): ExportFormat {
  const f = s.toLowerCase().replace(/^\./, "");
  if (f === "xmlsvg") return "drawio.svg";
  if (f === "png" || f === "svg" || f === "pdf" || f === "drawio.svg") return f;
  throw new Error(`unknown format "${s}". Use png, svg, pdf or drawio.svg`);
}

export function formatFromPath(path: string): ExportFormat | null {
  const p = path.toLowerCase();
  if (p.endsWith(".drawio.svg")) return "drawio.svg";
  for (const f of ["png", "svg", "pdf"] as const) if (p.endsWith(EXT[f])) return f;
  return null;
}

/** Picks the pages to export. No spec means page 1; a spec is a 1-based number or an exact page name. */
export function selectPages(pages: PageInfo[], spec: string | undefined, all: boolean): PageInfo[] {
  if (pages.length === 0) throw new Error("the file has no pages");
  if (all) return pages;
  if (spec === undefined) return [pages[0]!];
  const byName = pages.find((p) => p.name === spec);
  if (byName) return [byName];
  const n = Number(spec);
  const byIndex = Number.isInteger(n) ? pages.find((p) => p.index === n) : undefined;
  if (byIndex) return [byIndex];
  throw new Error(`no page "${spec}". Pages: ${pages.map((p) => `${p.index}=${p.name}`).join(", ")}`);
}

export interface PlannedOutput {
  page: PageInfo;
  /** null means standard output. */
  path: string | null;
}

export function planOutputs(file: string, out: string | undefined, format: ExportFormat, pages: PageInfo[]): PlannedOutput[] {
  if (out === "-") {
    if (pages.length !== 1) throw new Error("-o - can write one page only; use --page <n>");
    return [{ page: pages[0]!, path: null }];
  }
  const ext = EXT[format];
  const stripExt = (p: string): string => p.replace(/\.drawio\.svg$|\.(drawio|svg|png|pdf|xml)$/i, "");
  const base = out ? stripExt(out) : stripExt(file);
  if (pages.length === 1 && out) return [{ page: pages[0]!, path: out }];
  if (pages.length === 1) return [{ page: pages[0]!, path: base + ext }];
  return pages.map((page) => ({ page, path: `${base}-${page.index}${ext}` }));
}

export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const num = (k: string): number | null => {
    const m = new RegExp(`\\s${k}\\s*=\\s*"([\\d.]+)(?:px)?"`).exec(root);
    return m ? Math.ceil(Number(m[1])) : null;
  };
  const w = num("width");
  const h = num("height");
  if (w && h) return { width: w, height: h };
  const vb = /\sviewBox\s*=\s*"[\d.\-]+[ ,]+[\d.\-]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/.exec(root);
  return vb ? { width: Math.ceil(Number(vb[1])), height: Math.ceil(Number(vb[2])) } : null;
}

export interface ExportOptions {
  file: string;
  webapp: string;
  /** Output path, "-" for standard output, or undefined for a default next to the input. */
  out?: string;
  format?: ExportFormat;
  page?: string;
  allPages?: boolean;
  scale?: number;
  border?: number;
  background?: string;
  transparent?: boolean;
  browser?: string;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

export interface ExportedFile {
  path: string | null;
  format: ExportFormat;
  page: PageInfo;
  bytes: number;
  width?: number;
  height?: number;
  /** Set when the output goes to standard output. */
  data?: Buffer;
}

async function render(page: Page, url: string, timeoutMs: number): Promise<string | Buffer> {
  await page.send("Page.navigate", { url });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`export timed out after ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
  });
  const run = page.send<{ result: { value: { ok: boolean; data?: string; error?: string } }; exceptionDetails?: { text: string } }>("Runtime.evaluate", {
    expression: "new Promise(r => { const t = setInterval(() => { if (window.__dwioDone) { clearInterval(t); r(window.__dwioDone); } }, 50); })",
    awaitPromise: true,
    returnByValue: true,
  });
  try {
    const res = await Promise.race([run, timeout]);
    if (res.exceptionDetails) throw new Error(`page error: ${res.exceptionDetails.text}`);
    const v = res.result.value;
    if (!v.ok || v.data === undefined) throw new Error(v.error ?? "export failed");
    return v.data.startsWith("data:") ? Buffer.from(v.data.slice(v.data.indexOf(",") + 1), "base64") : v.data;
  } finally {
    clearTimeout(timer);
  }
}

async function svgToPdf(page: Page, svg: string): Promise<Buffer> {
  const size = svgSize(svg);
  const html =
    `<!doctype html><meta charset="utf-8"><style>@page{${size ? `size:${size.width}px ${size.height}px;` : ""}margin:0}` +
    `html,body{margin:0;background:#fff}svg{display:block}</style>${svg.replace(/^<\?xml[^>]*>\s*/, "")}`;
  const tree = await page.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
  await page.send("Page.setDocumentContent", { frameId: tree.frameTree.frame.id, html });
  await page.send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
  const pdf = await page.send<{ data: string }>("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
  return Buffer.from(pdf.data, "base64");
}

export async function exportDiagram(opts: ExportOptions): Promise<ExportedFile[]> {
  const log = opts.log ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 60000;
  const kind = kindFromPath(opts.file);
  const xml = toEditorXml(readFileSync(opts.file, "utf8"), kind);
  if (xml === null) throw new Error(`${basename(opts.file)} has no embedded draw.io data`);
  const pages = listPages(xml);

  const format = opts.format ?? (opts.out && opts.out !== "-" ? formatFromPath(opts.out) : null) ?? "png";
  if (opts.out && opts.out !== "-" && !opts.format && !formatFromPath(opts.out)) {
    throw new Error(`cannot tell the format from "${opts.out}". Use .png, .svg, .pdf or .drawio.svg, or pass --format`);
  }

  // A .drawio.svg keeps every page unless the caller asks for specific ones.
  const wholeFile = format === "drawio.svg" && opts.page === undefined && !opts.allPages;
  const selected = wholeFile ? [pages[0]!] : selectPages(pages, opts.page, opts.allPages ?? false);
  if (!wholeFile && !opts.allPages && opts.page === undefined && pages.length > 1) {
    log(`The file has ${pages.length} pages. Exporting page 1 (${pages[0]!.name}). Use --page <n|name> or --all-pages for others.`);
  }
  const plan = planOutputs(opts.file, opts.out, format, selected);

  const { path: browserPath, tried } = findBrowser(opts.browser);
  if (!browserPath) throw new Error(browserHelp(tried));
  if (!existsSync(join(opts.webapp, "index.html"))) throw new Error(`draw.io editor not found in ${opts.webapp}. Run: dwio setup`);

  const server = await startServer({ file: opts.file, webapp: opts.webapp, port: 0 });
  const browser = await launchBrowser(browserPath, { log });
  const results: ExportedFile[] = [];
  try {
    const editorFormat = format === "png" ? "png" : format === "drawio.svg" ? "xmlsvg" : "svg";
    const scale = opts.scale ?? (format === "png" ? 2 : 1);
    const background = opts.background ?? (format === "png" || format === "pdf" ? "#ffffff" : "");
    for (const { page, path } of plan) {
      const q = new URLSearchParams({ t: server.token, format: editorFormat, scale: String(scale), border: String(opts.border ?? 10), background });
      if (opts.transparent) q.set("transparent", "1");
      if (!wholeFile) q.set("page", String(page.index));
      const tab = await browser.newPage();
      let data: Buffer;
      try {
        const out = await render(tab, `http://127.0.0.1:${server.port}/export?${q}`, timeoutMs);
        data = format === "pdf" ? await svgToPdf(await browser.newPage(), out as string) : typeof out === "string" ? Buffer.from(out.endsWith("\n") ? out : out + "\n", "utf8") : out;
      } finally {
        await tab.close();
      }
      const size = format === "png" ? pngSize(data) : format === "pdf" ? null : svgSize(data.toString("utf8"));
      if (path !== null) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, data);
      }
      results.push({ path, format, page, bytes: data.length, ...(size ?? {}), ...(path === null ? { data } : {}) });
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return results;
}
