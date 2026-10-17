import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { kindFromPath, toEditorXml, type Kind } from "./format.ts";

const MAX_BODY = 64 * 1024 * 1024;
const WEB_DIR = fileURLToPath(new URL("./web/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

export interface ServerOptions {
  /** Diagram to edit. Created (empty) by the caller if missing. */
  file: string;
  /** Directory containing the unpacked draw.io webapp. */
  webapp: string;
  port?: number;
  token?: string;
  /** Called once every browser tab has been gone for `graceMs`. */
  onIdle?: () => void;
  graceMs?: number;
}

export interface RunningServer {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
}

export const sha = (data: string | Buffer): string => createHash("sha1").update(data).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Atomic replace: temp file in the same directory, then rename. Keeps the original mode. */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const target = existsSync(path) ? realpathSync(path) : path;
  const tmp = join(dirname(target), `.${basename(target)}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`);
  try {
    await writeFile(tmp, content, "utf8");
    if (existsSync(target)) await chmod(tmp, (await stat(target)).mode & 0o7777);
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const token = opts.token ?? randomBytes(16).toString("hex");
  const bindHost = "127.0.0.1"; // loopback only, by design
  const graceMs = opts.graceMs ?? 5000;
  const kind: Kind = kindFromPath(opts.file);
  const name = basename(opts.file);

  let port = 0;
  let lastHash: string | null = null;
  const clients = new Set<ServerResponse>();
  let idleTimer: NodeJS.Timeout | undefined;

  const readDisk = async (): Promise<{ text: string; hash: string }> => {
    const text = await readFile(opts.file, "utf8");
    return { text, hash: sha(text) };
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const hostOk = (req: IncomingMessage): boolean => {
    const h = req.headers.host ?? "";
    return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`;
  };

  const originOk = (req: IncomingMessage): boolean => {
    const o = req.headers.origin;
    if (!o) return true;
    return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}` || o === `http://[::1]:${port}`;
  };

  const tokenOk = (req: IncomingMessage, url: URL): boolean => {
    const supplied = (req.headers["x-drawio-token"] as string | undefined) ?? url.searchParams.get("t") ?? "";
    return safeEqual(supplied, token);
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(Object.assign(new Error("body too large"), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  const serveFile = (res: ServerResponse, root: string, rel: string): void => {
    const full = normalize(join(root, rel));
    if (full !== root && !full.startsWith(root.endsWith(sep) ? root : root + sep)) return json(res, 403, { error: "forbidden" });
    let st;
    try {
      st = statSync(full);
    } catch {
      return json(res, 404, { error: "not found" });
    }
    if (!st.isFile()) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", "content-length": st.size });
    createReadStream(full).pipe(res);
  };

  const broadcast = (event: string, data: unknown): void => {
    for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (!hostOk(req)) return json(res, 403, { error: "bad host" });
    if (!originOk(req)) return json(res, 403, { error: "bad origin" });

    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");

    if (path.startsWith("/drawio/")) return serveFile(res, opts.webapp, decodeURIComponent(path.slice("/drawio/".length)));

    if (req.method === "GET" && (path === "/" || path === "/host.js")) {
      if (!tokenOk(req, url) && path === "/") return json(res, 401, { error: "missing or bad token" });
      return serveFile(res, WEB_DIR, path === "/" ? "host.html" : "host.js");
    }

    if (path.startsWith("/api/")) {
      if (!tokenOk(req, url)) return json(res, 401, { error: "missing or bad token" });

      if (req.method === "GET" && path === "/api/file") {
        const { text, hash } = await readDisk();
        const xml = toEditorXml(text, kind);
        if (xml === null) return json(res, 422, { error: `${name} has no embedded draw.io data (no content attribute on <svg>)`, kind });
        lastHash = hash;
        return json(res, 200, { name, kind, xml, hash });
      }

      if (req.method === "PUT" && path === "/api/file") {
        const body = await readBody(req);
        const marker = kind === "svg" ? "<svg" : "<mxfile";
        if (!body.includes(marker)) return json(res, 400, { error: `body does not look like a ${kind} file` });
        const base = req.headers["x-base-hash"];
        if (typeof base === "string" && base !== "") {
          const disk = existsSync(opts.file) ? (await readDisk()).hash : null;
          if (disk !== null && disk !== base) return json(res, 409, { error: "file changed on disk", hash: disk });
        }
        const hash = sha(body);
        lastHash = hash; // set first so our own write never echoes back as an external change
        await atomicWrite(opts.file, body);
        return json(res, 200, { hash });
      }

      if (req.method === "GET" && path === "/api/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        clearTimeout(idleTimer);
        req.on("close", () => {
          clients.delete(res);
          if (clients.size === 0 && opts.onIdle) {
            idleTimer = setTimeout(() => clients.size === 0 && opts.onIdle?.(), graceMs);
          }
        });
        return;
      }
    }

    json(res, 404, { error: "not found" });
  };

  const server: Server = createHttpServer((req, res) => {
    handle(req, res).catch((e: Error & { status?: number }) => {
      if (!res.headersSent) json(res, e.status ?? 500, { error: e.message });
      else res.end();
    });
  });

  // Watch the directory, not the file: atomic renames (ours, git's, editors') replace the inode.
  let debounce: NodeJS.Timeout | undefined;
  const watcher: FSWatcher = watch(dirname(opts.file), (_evt, changed) => {
    if (changed && changed !== name) return;
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const { hash } = await readDisk();
        if (hash !== lastHash) {
          lastHash = hash;
          broadcast("changed", { hash });
        }
      } catch {
        /* file briefly absent mid-rename or deleted; next event will retry */
      }
    }, 80);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, bindHost, resolve);
  });
  port = (server.address() as AddressInfo).port;

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(debounce);
        clearTimeout(idleTimer);
        watcher.close();
        for (const c of clients) c.end();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
