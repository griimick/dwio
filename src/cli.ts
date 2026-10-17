#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { DRAWIO_VERSION, install, isInstalled, webappDir } from "./assets.ts";
import { decompressDiagrams, emptyFile, kindFromPath, toEditorXml } from "./format.ts";
import { colorHelp, styleFor } from "./color.ts";
import { VERSION } from "./meta.ts";
import { upgrade } from "./upgrade.ts";
import { exportDiagram, parseFormat } from "./export.ts";
import { createMcp, serveStdio } from "./mcp.ts";
import { atomicWrite, startServer } from "./server.ts";

/** "dwio" on a phone keypad. Stable across runs so bookmarks, tunnels and firewall rules keep working. */
const DEFAULT_PORT = 3946;
const PORT_SPAN = 20;

const HELP = `dwio – edit local .drawio / .drawio.svg files in the draw.io editor, fully offline

Usage:
  dwio <file>            Open <file> in the editor (created if missing) and keep it in sync
  dwio xml <file>        Print the diagram as plain, uncompressed mxfile XML (for scripts/agents)
  dwio export <file>       Render the diagram to an image: png, svg, pdf or drawio.svg (needs Chrome, Chromium or Edge)
  dwio mcp                 Run as an MCP server on stdin/stdout, so an agent can read, draw and edit diagrams
  dwio upgrade [version]   Install the newest release (or the given version). Alias: update
  dwio setup             Download the draw.io web app into the local cache (one-time, automatic on first use)

Export options (dwio export):
  -o, --output <path>      Output file ("-" for stdout). The extension sets the format; default: <file>.png
  --format <f>             png | svg | pdf | drawio.svg (overrides the extension)
  --page <n|name>          Export this page (1-based number or exact name). Default: page 1
  --all-pages              Export every page as <name>-<n>.<ext>
  --scale <x>              Zoom factor (default: 2 for png, 1 otherwise)
  --border <px>            Space around the drawing (default: 10)
  --background <color>     Background color, e.g. "#ffffff" (png and pdf default to white)
  --transparent            Transparent background (png)
  --browser <path>         Chrome/Chromium/Edge to use (or set DWIO_BROWSER)
  --timeout <seconds>      Give up after this long (default: 60)

Options:
  --no-open                Do not launch a browser; just print the URL
  --port <n>               Listen on exactly this port, or fail (default: ${DEFAULT_PORT}, then the next ${PORT_SPAN} if busy; env DWIO_PORT)
  --host <addr>            Bind address (default: 127.0.0.1). Use 0.0.0.0 to reach it from other machines;
                           the URL token is then the only protection and traffic is plain HTTP
  --allow-host <name>      Also accept this hostname in the Host header (repeatable), e.g. a LAN or Tailscale name
  --public-port <n>        Port clients connect to, if it differs from the listening port (SSH -L, Docker)
  --check                  With upgrade: only say if a newer release exists; change nothing
  --root <folder>          With mcp: the folder the agent may use (default: the current folder). Repeat to allow more
  --keep-alive             Keep running after the browser tab closes
  --no-create              Fail instead of creating a missing file
  --json                   Machine-readable output: one JSON object on stdout (logs stay on stderr)
  --drawio-version <v>     Upstream draw.io release to use (default: ${DRAWIO_VERSION})
  -h, --help               Show this help
  -v, --version            Show version

Output: the editor URL is the only thing written to stdout (or one JSON line with --json).
Exit codes: 0 ok, 1 runtime error, 2 usage error.
`;

class UsageError extends Error {}

const err = styleFor(process.stderr);
const out = styleFor(process.stdout);
const log = (msg: string): void => void process.stderr.write(msg + "\n");
/** Progress and status notes: dim, so the result stands out. */
const info = (msg: string): void => log(err.dim(msg));

function openBrowser(url: string): void {
  const custom = process.env.BROWSER;
  const [cmd, args]: [string, string[]] = custom
    ? [custom, [url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => log(`${err.accent("Could not launch a browser;")} open the URL manually.`));
  child.unref();
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "no-open": { type: "boolean" },
        port: { type: "string" },
        host: { type: "string" },
        "allow-host": { type: "string", multiple: true },
        "public-port": { type: "string" },
        root: { type: "string", multiple: true },
        "keep-alive": { type: "boolean" },
        "no-create": { type: "boolean" },
        json: { type: "boolean" },
        check: { type: "boolean" },
        output: { type: "string", short: "o" },
        format: { type: "string" },
        page: { type: "string" },
        "all-pages": { type: "boolean" },
        scale: { type: "string" },
        border: { type: "string" },
        background: { type: "string" },
        transparent: { type: "boolean" },
        browser: { type: "string" },
        timeout: { type: "string" },
        "drawio-version": { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(colorHelp(HELP, styleFor(process.stdout)));
    return 0;
  }
  if (values.version) {
    process.stdout.write(`${VERSION} (draw.io ${DRAWIO_VERSION})\n`);
    return 0;
  }

  const version = values["drawio-version"] ?? DRAWIO_VERSION;
  const [first, ...rest] = positionals;

  if (first === "setup") {
    const dir = await install(version, info);
    process.stdout.write(values.json ? JSON.stringify({ webapp: dir, version }) + "\n" : dir + "\n");
    return 0;
  }

  if (first === "mcp") {
    if (rest.length) throw new UsageError(`unexpected extra arguments: ${rest.join(" ")}`);
    const roots = (values.root ?? []).map((r) => resolve(r));
    for (const r of roots) if (!existsSync(r) || !statSync(r).isDirectory()) throw new UsageError(`--root ${r} is not a folder`);
    const mcp = createMcp({
      version: VERSION,
      roots,
      browser: values.browser,
      log: info,
      webapp: async () => {
        if (!isInstalled(version)) await install(version, info);
        return webappDir(version);
      },
    });
    await serveStdio(mcp); // stdout carries protocol messages only
    return 0;
  }

  if (first === "upgrade" || first === "update") {
    if (rest.length > 1) throw new UsageError(`unexpected extra arguments: ${rest.slice(1).join(" ")}`);
    const r = await upgrade({ current: VERSION, target: rest[0], checkOnly: values.check, log: info });
    if (values.json) process.stdout.write(JSON.stringify(r) + "\n");
    else if (r.status === "up-to-date") log(`${err.dim("dwio")} ${r.current} ${err.dim("is up to date.")}`);
    else if (r.status === "available") log(`${err.accent("Update available:")} ${r.current} → ${r.latest}${err.dim(". Run: dwio upgrade")}`);
    else log(`${err.dim("Upgraded")} dwio ${err.dim(`${r.current} →`)} ${r.latest}`);
    return 0;
  }

  if (first === "xml") {
    const file = rest[0];
    if (!file) throw new UsageError("usage: dwio xml <file>");
    const xml = toEditorXml(readFileSync(file, "utf8"), kindFromPath(file));
    if (xml === null) throw new Error(`${file} has no embedded draw.io data`);
    process.stdout.write(decompressDiagrams(xml).replace(/\n?$/, "\n"));
    return 0;
  }

  if (first === "export") {
    const file = rest[0];
    if (!file) throw new UsageError("usage: dwio export <file> [-o out.png]");
    if (rest.length > 1) throw new UsageError(`unexpected extra arguments: ${rest.slice(1).join(" ")}`);
    if (!existsSync(file)) throw new Error(`${file} does not exist`);
    const numeric = (name: string, raw: string | undefined, min: number): number | undefined => {
      if (raw === undefined) return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min) throw new UsageError(`invalid --${name}: ${raw}`);
      return n;
    };
    const format = values.format === undefined ? undefined : (() => { try { return parseFormat(values.format!); } catch (e) { throw new UsageError((e as Error).message); } })();
    const timeout = numeric("timeout", values.timeout, 1);
    if (!isInstalled(version)) await install(version, info);
    const results = await exportDiagram({
      file: resolve(file),
      webapp: webappDir(version),
      out: values.output === undefined || values.output === "-" ? values.output : resolve(values.output),
      format,
      page: values.page,
      allPages: values["all-pages"],
      scale: numeric("scale", values.scale, 0.01),
      border: numeric("border", values.border, 0),
      background: values.background,
      transparent: values.transparent,
      browser: values.browser,
      timeoutMs: timeout === undefined ? undefined : timeout * 1000,
      log: info,
    });
    if (results.length === 1 && results[0]!.data) {
      process.stdout.write(results[0]!.data);
    } else if (values.json) {
      process.stdout.write(JSON.stringify({ files: results.map(({ data: _d, ...r }) => r) }) + "\n");
    } else {
      for (const r of results) process.stdout.write(`${r.path}\n`);
    }
    return 0;
  }

  if (!first) throw new UsageError("missing <file>. Try: dwio diagram.drawio.svg");
  if (rest.length > 0) throw new UsageError(`unexpected extra arguments: ${rest.join(" ")}`);
  const file = resolve(first);
  const kind = kindFromPath(file);

  const host = values.host ?? "127.0.0.1";
  if (isIP(host) === 0) throw new UsageError(`invalid --host (expected an IP address): ${host}`);
  const requested = values.port ?? process.env.DWIO_PORT;
  const base = requested === undefined ? DEFAULT_PORT : Number(requested);
  if (!Number.isInteger(base) || base < 0 || base > 65535) throw new UsageError(`invalid port: ${requested}`);
  // An explicit --port (or 0 = any) is honoured exactly; only the built-in default is allowed to slide upward.
  const candidates = requested === undefined ? Array.from({ length: PORT_SPAN + 1 }, (_, i) => DEFAULT_PORT + i) : [base];

  const publicPort = values["public-port"] === undefined ? undefined : Number(values["public-port"]);
  if (publicPort !== undefined && (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535)) throw new UsageError(`invalid --public-port: ${values["public-port"]}`);

  if (!existsSync(file)) {
    if (values["no-create"]) throw new Error(`${file} does not exist`);
    if (!existsSync(dirname(file))) throw new Error(`directory ${dirname(file)} does not exist`);
    await atomicWrite(file, emptyFile(kind));
    info(`Created ${file}`);
  }

  if (!isInstalled(version)) await install(version, info);

  let stop: () => void = () => {};
  const done = new Promise<void>((res) => (stop = res));
  const serverOpts = {
    file,
    webapp: webappDir(version),
    host,
    allowHosts: values["allow-host"],
    publicPort,
    onIdle: values["keep-alive"] ? undefined : () => {
      info("Editor closed; shutting down.");
      stop();
    },
  };
  let server;
  for (const [i, port] of candidates.entries()) {
    try {
      server = await startServer({ ...serverOpts, port });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      if (i === candidates.length - 1) {
        throw new Error(`port ${port} is in use${candidates.length > 1 ? ` (tried ${candidates[0]}–${port})` : ""}; pick another with --port`);
      }
    }
  }
  if (!server) throw new Error("could not start server");
  if (requested === undefined && server.port !== DEFAULT_PORT) info(`Port ${DEFAULT_PORT} is busy; using ${server.port}.`);

  process.stdout.write(values.json ? JSON.stringify({ url: server.url, urls: server.urls, port: server.port, file, kind, pid: process.pid }) + "\n" : out.link(server.url) + "\n");
  log(`${err.dim("Editing")} ${file} ${err.dim(`(${kind}). Ctrl+C to stop.`)}`);
  if (host !== "127.0.0.1" && host !== "::1") {
    log("");
    log(`${err.accent("WARNING:")} listening on ${host}. Anyone who can reach this port and has the URL token can read and overwrite ${file}.`);
    log("");
    for (const u of server.urls) log(`  ${err.link(u)}`);
    log(`  ${err.link(`http://${hostname()}:${server.port}/?t=${server.token}`)}  ${err.dim("(this machine's hostname)")}`);
    log("");
  }
  if (!values["no-open"]) openBrowser(server.url);

  for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, stop);
  await done;
  await server.close();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: Error) => {
    log(`${err.red("error:")} ${e.message}`);
    if (e instanceof UsageError) {
      info("Run 'dwio --help' for usage.");
      process.exit(2);
    }
    process.exit(1);
  },
);
