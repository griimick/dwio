import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Instance files: each running `dwio <file>` writes a small file about itself in a folder that only the current
 * user can open. `dwio mcp` reads them to learn which diagram a person has open, and how to reach the editor.
 *
 * Trust rules:
 *  - The folder must be private (not a link, owned by us, no group/other access). Otherwise nothing is written or read.
 *  - A file is believed only if its process is alive AND answers a random challenge with an HMAC made from the secret
 *    in the file. The secret is never sent. A stale file, or another program on the same port, fails this check.
 *  - The secret is an "agent token", separate from the editor's token, and opens only the loopback-only /api/agent routes.
 *  - The port is the only address used (always 127.0.0.1). A "url" in a file is never followed.
 */

export interface Instance {
  v: 1;
  pid: number;
  /** Real path of the diagram file. */
  file: string;
  port: number;
  agentToken: string;
  startedAt: string;
}

const MAX_FILE_BYTES = 4096;

export function runDir(env: Record<string, string | undefined> = process.env, platform: string = process.platform, uid: number | undefined = process.getuid?.()): string {
  if (env.DWIO_RUN_DIR) return env.DWIO_RUN_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "dwio", "run");
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, "dwio"); // private to the user, and cleared at logout
  if (platform === "darwin") return join(tmpdir(), `dwio-${uid ?? "user"}`); // $TMPDIR is per user on macOS
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "dwio", "run");
}

export interface DirFacts {
  isDirectory: boolean;
  isSymbolicLink: boolean;
  uid: number;
  mode: number;
}

/** Why a folder cannot be trusted, or null if it is fine. A mode that is only too open (but ours) can be fixed. */
export function dirProblem(st: DirFacts, uid: number | undefined): { problem: string; fixable: boolean } | null {
  if (st.isSymbolicLink) return { problem: "is a symbolic link", fixable: false };
  if (!st.isDirectory) return { problem: "is not a folder", fixable: false };
  if (uid !== undefined && st.uid !== uid) return { problem: "belongs to another user", fixable: false };
  if (uid !== undefined && (st.mode & 0o077) !== 0) return { problem: "is open to other users", fixable: true };
  return null;
}

/** Creates the folder if needed and makes sure that only this user can use it. Throws if it cannot be trusted. */
export function ensureRunDir(dir: string, uid: number | undefined = process.getuid?.()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  const bad = dirProblem({ isDirectory: st.isDirectory(), isSymbolicLink: st.isSymbolicLink(), uid: st.uid, mode: st.mode }, uid);
  if (!bad) return;
  if (bad.fixable) {
    chmodSync(dir, 0o700);
    return;
  }
  throw new Error(`the folder ${dir} ${bad.problem}, so dwio will not use it`);
}

/** Answer to a challenge. Both sides can compute it only if they know the agent token. */
export function proof(agentToken: string, nonce: string, pid: number, file: string): string {
  return createHmac("sha256", agentToken).update(`${nonce}\n${pid}\n${file}`).digest("hex");
}

export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export const newAgentToken = (): string => randomBytes(24).toString("hex");

/** Writes this process's instance file. Returns a function that removes it. */
export function registerInstance(info: Omit<Instance, "v" | "startedAt">, dir: string = runDir()): () => void {
  ensureRunDir(dir);
  const path = join(dir, `${info.pid}.json`);
  const tmp = `${path}.${randomBytes(3).toString("hex")}.tmp`;
  const body: Instance = { v: 1, startedAt: new Date().toISOString(), ...info };
  writeFileSync(tmp, JSON.stringify(body) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  let removed = false;
  const remove = (): void => {
    if (removed) return;
    removed = true;
    rmSync(path, { force: true });
  };
  process.once("exit", remove); // also covers a normal return from main()
  return remove;
}

/** Validates one parsed file. Anything unexpected makes it count as not an instance file. */
export function parseInstance(raw: unknown): Instance | null {
  const o = raw as Partial<Instance> | null;
  if (!o || typeof o !== "object" || o.v !== 1) return null;
  if (!Number.isInteger(o.pid) || o.pid! <= 0) return null;
  if (!Number.isInteger(o.port) || o.port! < 1 || o.port! > 65535) return null;
  if (typeof o.file !== "string" || !o.file || o.file.length > 4096) return null;
  if (typeof o.agentToken !== "string" || !/^[0-9a-f]{32,128}$/.test(o.agentToken)) return null;
  return { v: 1, pid: o.pid!, file: o.file, port: o.port!, agentToken: o.agentToken, startedAt: typeof o.startedAt === "string" ? o.startedAt : "" };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, but not ours
  }
};

export interface ListOptions {
  dir?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Instances that are really running. Stale and untrustworthy files are skipped, and stale ones are removed. */
export async function listInstances(opts: ListOptions = {}): Promise<Instance[]> {
  const dir = opts.dir ?? runDir();
  if (!existsSync(dir)) return [];
  try {
    ensureRunDir(dir);
  } catch {
    return []; // an untrusted folder is not read at all
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const found: Instance[] = [];
  for (const name of readdirSync(dir)) {
    if (!/^\d+\.json$/.test(name)) continue;
    const path = join(dir, name);
    let inst: Instance | null = null;
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue; // links and large files are never read
      inst = parseInstance(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      continue;
    }
    if (!inst || `${inst.pid}.json` !== name) continue;
    if (!alive(inst.pid)) {
      rmSync(path, { force: true });
      continue;
    }
    const nonce = randomBytes(16).toString("hex");
    let body: { proof?: unknown };
    try {
      const res = await fetchFn(`http://127.0.0.1:${inst.port}/api/agent/ping?n=${nonce}`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 1000) });
      if (!res.ok) continue;
      body = (await res.json()) as { proof?: unknown };
    } catch {
      continue; // no answer (busy, or not listening): not listed now, but the file is kept; only a dead process or a wrong proof removes it
    }
    const want = Buffer.from(proof(inst.agentToken, nonce, inst.pid, inst.file));
    const got = Buffer.from(typeof body.proof === "string" ? body.proof : "");
    if (got.length === want.length && timingSafeEqual(got, want)) found.push(inst);
    else rmSync(path, { force: true }); // another program answers on that port: the file is stale
  }
  return found.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
