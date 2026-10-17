import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A minimal Chrome DevTools Protocol client: just enough to open a page, run script and print to PDF. */
export interface Browser {
  send<T = any>(method: string, params?: object, sessionId?: string): Promise<T>;
  /** Opens a blank tab and returns a sender bound to it. */
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

export interface Page {
  send<T = any>(method: string, params?: object): Promise<T>;
  close(): Promise<void>;
}

class EarlyExit extends Error {
  code: number | null;
  stderr: string;
  constructor(code: number | null, stderr: string) {
    super(`browser exited with code ${code} before it was ready:\n${stderr.trim().split("\n").slice(-6).join("\n")}`);
    this.code = code;
    this.stderr = stderr;
  }
}

function start(path: string, noSandbox: boolean, timeoutMs: number) {
  const profile = mkdtempSync(join(tmpdir(), "dwio-browser-"));
  const headlessShell = /headless[-_]shell/i.test(path);
  const args = [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--hide-scrollbars",
    "--mute-audio",
    ...(headlessShell ? [] : ["--headless=new"]),
    ...(noSandbox ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const child = spawn(path, args, { stdio: ["ignore", "ignore", "pipe"] });
  const cleanup = (): void => rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const ws = new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`browser did not start within ${timeoutMs} ms`)), timeoutMs);
    child.stderr.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new EarlyExit(code, buf));
    });
  });
  return { child, ws, cleanup };
}

export async function launchBrowser(path: string, opts: { noSandbox?: boolean; timeoutMs?: number; log?: (m: string) => void } = {}): Promise<Browser> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const wantNoSandbox = opts.noSandbox ?? (process.env.DWIO_NO_SANDBOX === "1" || (process.getuid?.() ?? 1) === 0);
  let run = start(path, wantNoSandbox, timeoutMs);
  let url: string;
  try {
    url = await run.ws;
  } catch (e) {
    run.child.kill();
    run.cleanup();
    // Chrome refuses to start its sandbox in some containers and CI images; retry once without it.
    if (e instanceof EarlyExit && !wantNoSandbox) {
      opts.log?.("Browser failed to start with its sandbox; retrying with --no-sandbox.");
      run = start(path, true, timeoutMs);
      try {
        url = await run.ws;
      } catch (e2) {
        run.child.kill();
        run.cleanup();
        throw e2;
      }
    } else throw e;
  }

  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("could not connect to the browser DevTools socket")), { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; method: string }>();
  socket.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  socket.addEventListener("close", () => {
    for (const p of pending.values()) p.reject(new Error("browser connection closed"));
    pending.clear();
  });

  const send = <T>(method: string, params: object = {}, sessionId?: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    send,
    async newPage() {
      const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      return {
        send: (method, params) => send(method, params, sessionId),
        close: async () => void (await send("Target.closeTarget", { targetId }).catch(() => {})),
      };
    },
    async close() {
      await send("Browser.close").catch(() => {});
      socket.close();
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          run.child.kill("SIGKILL");
          resolve();
        }, 2000);
        run.child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        if (run.child.exitCode !== null) {
          clearTimeout(t);
          resolve();
        }
      });
      run.cleanup();
    },
  };
}
