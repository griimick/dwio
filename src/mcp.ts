import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { browserHelp, findBrowser } from "./browser.ts";
import { describe, EditError, parseOps, type CellInfo } from "./diagram.ts";
import { editDiagramFile, readDiagramFile } from "./diagram-file.ts";
import { exportDiagram } from "./export.ts";
import { emptyFile, kindFromPath } from "./format.ts";
import { resolveInside } from "./safe-path.ts";
import { atomicWrite } from "./server.ts";

/**
 * A Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0), so an agent such as Claude Code or
 * opencode can read, draw and edit a diagram file. Standard output carries protocol messages only.
 */

type Json = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}
interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run(args: Json): Promise<ToolResult>;
}

export interface McpOptions {
  version: string;
  /** Relative file names are resolved against this folder (default: the current folder). */
  cwd?: string;
  /** The tools may only use files inside these folders (default: just `cwd`). */
  roots?: string[];
  browser?: string;
  /** Returns the draw.io editor folder, downloading the editor first if needed. Needed to draw pictures. */
  webapp?: () => Promise<string>;
  log?: (msg: string) => void;
}

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Read and edit draw.io diagram files (.drawio and .drawio.svg) in this project.
Workflow: get_diagram to see the cells and their ids; apply_changes to add, update or delete cells; render to look at the result.
Check the picture after a change. If a person has the diagram open in the dwio editor, they see your edits within a second.
Labels are plain text (use \\n for a line break). Coordinates are in pixels; y grows downward. Connect shapes with add_edge using their ids.
Use create_diagram to make a new file. Do not edit the diagram XML by hand.`;

const textResult = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const errorResult = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

const OP_SCHEMA = {
  type: "object",
  description: "One change. 'add_vertex' draws a shape, 'add_edge' draws a connector, 'update' changes a cell, 'delete' removes a cell with its children and attached connectors.",
  properties: {
    op: { type: "string", enum: ["add_vertex", "add_edge", "update", "delete"] },
    id: { type: "string", description: "add_*: id for the new cell (optional, one is made if omitted). update/delete: the id of the cell." },
    page: { type: ["string", "number"], description: "Page name, id or number (from 1). Default: the first page." },
    label: { type: "string", description: "Plain text shown on the cell." },
    x: { type: "number" },
    y: { type: "number" },
    width: { type: "number" },
    height: { type: "number" },
    style: { type: "string", description: "draw.io style string, e.g. 'rounded=1;fillColor=#d5e8d4;'. For update this replaces the whole style." },
    style_set: { type: "object", description: "update only: style keys to set. A value of null removes the key." },
    parent: { type: "string", description: "Id of a container or layer. Default: the main layer." },
    source: { type: "string", description: "add_edge/update: id of the shape where the connector starts." },
    target: { type: "string", description: "add_edge/update: id of the shape where the connector ends." },
    points: { type: "array", items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }, description: "add_edge only: waypoints." },
  },
  required: ["op"],
};

export function createMcp(opts: McpOptions) {
  const cwd = opts.cwd ?? process.cwd();
  const roots = opts.roots?.length ? opts.roots : [cwd];
  const log = opts.log ?? (() => {});
  let renderDir: string | null = null;
  const locks = new Map<string, Promise<unknown>>();

  /** One change at a time per file, so two edits cannot overwrite each other. */
  const withLock = <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(path) ?? Promise.resolve()).catch(() => {}).then(fn);
    locks.set(path, run);
    return run;
  };

  const fileArg = (args: Json, mustExist = true): string => {
    if (typeof args.file !== "string" || !args.file) throw new Error('"file" is required: the path of a .drawio or .drawio.svg file');
    if (!/\.(drawio|svg)$/i.test(args.file)) throw new Error(`"${args.file}" is not a diagram file. Use a .drawio or .drawio.svg file`);
    const path = resolveInside(roots, cwd, args.file); // real path, inside an allowed folder
    if (!/\.(drawio|svg)$/i.test(path)) throw new Error(`"${args.file}" is a link to a file that is not a diagram`);
    if (mustExist && !existsSync(path)) throw new Error(`${args.file} does not exist. Use create_diagram to make it`);
    return path;
  };

  const fileProp = { type: "string", description: "Path of the diagram file (.drawio or .drawio.svg), absolute or relative to the project folder." };

  const tools: Tool[] = [
    {
      name: "get_diagram",
      description: "Read a diagram: its pages and cells. Each cell has an id, type (vertex = shape, edge = connector), plain-text label, style, position and size (x, y, width, height; absX/absY are page coordinates), and for edges the source and target ids. Use the ids in apply_changes.",
      inputSchema: { type: "object", properties: { file: fileProp, page: { type: ["string", "number"], description: "Only this page (name, id or number)." } }, required: ["file"] },
      async run(args) {
        const path = fileArg(args);
        const { kind, pages } = readDiagramFile(path);
        const want = args.page === undefined ? null : String(args.page);
        const shown = want === null ? pages : pages.filter((p) => p.name === want || p.id === want || String(p.index) === want);
        if (!shown.length) throw new Error(`no page "${want}". Pages: ${pages.map((p) => `${p.index}=${p.name}`).join(", ")}`);
        const clean = (c: CellInfo): string => JSON.stringify(Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined && v !== "")));
        const out = [`${basename(path)} (${kind === "svg" ? ".drawio.svg" : ".drawio"}), ${pages.length} page${pages.length === 1 ? "" : "s"}`];
        for (const p of shown) {
          const v = p.cells.filter((c) => c.type === "vertex").length;
          const e = p.cells.filter((c) => c.type === "edge").length;
          out.push("", `page ${p.index} "${p.name}": ${v} shapes, ${e} connectors`, ...p.cells.map(clean));
        }
        return textResult(out.join("\n"));
      },
    },
    {
      name: "render",
      description: "Draw the diagram as a PNG image so you can look at it. Use it after changes to check the result. Needs Chrome, Chromium or Edge on this computer. The image is also saved to a file whose path is returned.",
      inputSchema: {
        type: "object",
        properties: {
          file: fileProp,
          page: { type: ["string", "number"], description: "Page name, id or number. Default: the first page." },
          scale: { type: "number", description: "Zoom factor. Default 1. Use 2 for small text." },
        },
        required: ["file"],
      },
      async run(args) {
        const path = fileArg(args);
        const { path: browser } = findBrowser(opts.browser);
        if (!browser) return errorResult(browserHelp(findBrowser(opts.browser).tried));
        if (!opts.webapp) return errorResult("the draw.io editor is not available");
        renderDir ??= mkdtempSync(join(tmpdir(), "dwio-mcp-"));
        const out = join(renderDir, `render-${Date.now()}.png`);
        const notes: string[] = [];
        const [r] = await exportDiagram({
          file: path, webapp: await opts.webapp(), out, format: "png", page: args.page === undefined ? undefined : String(args.page),
          scale: typeof args.scale === "number" ? args.scale : 1, border: 20, browser: opts.browser, log: (m) => notes.push(m),
        });
        const info = `Rendered page ${r!.page.index} "${r!.page.name}" of ${basename(path)}: ${r!.width}x${r!.height} px. Saved to ${out}.${notes.length ? " " + notes.join(" ") : ""}`;
        return { content: [{ type: "text", text: info }, { type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/png" }] };
      },
    },
    {
      name: "apply_changes",
      description: "Change a diagram with a list of operations: add shapes (add_vertex), connect them (add_edge), change a cell (update: label, style, position, size, parent, source, target) or remove one (delete). Operations run in order and either all succeed or none are applied. Returns the ids that were added or changed. The file is edited in place, with minimal changes to the text. For a .drawio.svg file the picture is redrawn too.",
      inputSchema: { type: "object", properties: { file: fileProp, ops: { type: "array", items: OP_SCHEMA, description: "The operations, in order." } }, required: ["file", "ops"] },
      async run(args) {
        const path = fileArg(args);
        const ops = parseOps(args.ops);
        return withLock(path, async () => {
          let webapp: string | undefined;
          let warn: string | undefined;
          if (kindFromPath(path) === "svg" && opts.webapp) {
            try {
              webapp = await opts.webapp();
            } catch (e) {
              warn = `The picture could not be redrawn: ${(e as Error).message}`;
            }
          }
          const r = await editDiagramFile(path, ops, { webapp, browser: opts.browser, log });
          const lines = r.changes.map((c) => `${c.action} ${c.id} (page ${c.page})`);
          const warning = r.warning ?? warn;
          return textResult([...lines, ...(r.rendered ? ["The picture was redrawn."] : []), ...(warning ? [`Warning: ${warning}`] : [])].join("\n"));
        });
      },
    },
    {
      name: "create_diagram",
      description: "Create a new, empty diagram file (.drawio or .drawio.svg). It fails if the file exists. Then use apply_changes to draw in it.",
      inputSchema: { type: "object", properties: { file: fileProp }, required: ["file"] },
      async run(args) {
        const path = fileArg(args, false);
        if (existsSync(path)) throw new Error(`${args.file} already exists`);
        mkdirSync(dirname(path), { recursive: true });
        await atomicWrite(path, emptyFile(kindFromPath(path)));
        return textResult(`Created ${args.file}. It has one empty page. Use apply_changes to add shapes.`);
      },
    },
  ];

  async function callTool(name: string, args: Json): Promise<ToolResult | null> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return null;
    try {
      return await tool.run(args);
    } catch (e) {
      const msg = e instanceof EditError ? e.message : (e as Error).message;
      return errorResult(`error: ${msg}`);
    }
  }

  /** Handles one JSON-RPC message. Returns the response, or null for a notification. */
  async function handle(msg: unknown): Promise<Json | null> {
    const m = msg as { id?: unknown; method?: unknown; params?: Json };
    if (!m || typeof m !== "object" || typeof m.method !== "string") return { jsonrpc: "2.0", id: (m as { id?: unknown })?.id ?? null, error: { code: -32600, message: "Invalid request" } };
    const isNotification = m.id === undefined;
    const reply = (result: unknown): Json | null => (isNotification ? null : { jsonrpc: "2.0", id: m.id, result });
    const fail = (code: number, message: string): Json | null => (isNotification ? null : { jsonrpc: "2.0", id: m.id, error: { code, message } });

    switch (m.method) {
      case "initialize": {
        const asked = (m.params?.protocolVersion as string | undefined) ?? "";
        return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: "dwio", version: opts.version }, instructions: INSTRUCTIONS });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const name = m.params?.name;
        if (typeof name !== "string") return fail(-32602, "missing tool name");
        const result = await callTool(name, (m.params?.arguments as Json | undefined) ?? {});
        return result ? reply(result) : fail(-32602, `unknown tool: ${name}`);
      }
      default:
        return m.method.startsWith("notifications/") ? null : fail(-32601, `method not found: ${m.method}`);
    }
  }

  return {
    handle,
    close() {
      if (renderDir) rmSync(renderDir, { recursive: true, force: true });
      renderDir = null;
    },
  };
}

/** Reads one JSON message per line from stdin and writes responses to stdout, until stdin closes. */
export async function serveStdio(mcp: ReturnType<typeof createMcp>, input: NodeJS.ReadableStream = process.stdin, write: (line: string) => void = (l) => void process.stdout.write(l)): Promise<void> {
  let buffer = "";
  const pending = new Set<Promise<void>>();
  const send = (o: Json | null): void => {
    if (o) write(JSON.stringify(o) + "\n");
  };
  const dispatch = (line: string): void => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const p = mcp.handle(msg).then(send, (e: Error) => send({ jsonrpc: "2.0", id: (msg as { id?: unknown })?.id ?? null, error: { code: -32603, message: e.message } }));
    pending.add(p);
    void p.finally(() => pending.delete(p));
  };
  input.setEncoding?.("utf8");
  await new Promise<void>((done) => {
    input.on("data", (chunk: string | Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        dispatch(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    input.on("end", () => done());
    input.on("close", () => done());
  });
  dispatch(buffer);
  await Promise.all(pending);
  mcp.close();
}
