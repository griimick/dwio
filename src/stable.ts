import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureRunDir } from "./instances.ts";

/**
 * A restart of `dwio <file>` should not strand a browser tab that is still open: the tab keeps its URL, so the
 * URL (port and token) has to come out the same. The token is HMAC(secret, real path of the file), where the secret
 * is made once and kept in a private per-user folder (same checks as the instance files). The last port used for
 * a file is remembered too, so a restart tries it first.
 *
 * The token is no weaker than a random one against another program that cannot read the folder, but a leaked URL
 * stays valid until the secret is renewed (`--new-token`).
 */

const SECRET_RE = /^[0-9a-f]{64}$/;
const MAX_PORTS = 200;

export function stateDir(env: Record<string, string | undefined> = process.env, platform: string = process.platform): string {
  if (env.DWIO_STATE_DIR) return env.DWIO_STATE_DIR;
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "dwio", "state");
  return join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "dwio");
}

function writePrivate(path: string, body: string): void {
  const tmp = `${path}.${randomBytes(3).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function readSecret(dir: string, renew: boolean): string {
  const path = join(dir, "secret");
  if (!renew && existsSync(path)) {
    const s = readFileSync(path, "utf8").trim();
    if (SECRET_RE.test(s)) return s;
  }
  const s = randomBytes(32).toString("hex");
  writePrivate(path, s + "\n");
  return s;
}

export const tokenFor = (secret: string, realFile: string): string =>
  createHmac("sha256", secret).update(`editor-token\n${realFile}`).digest("hex").slice(0, 32);

function readPorts(path: string): Record<string, number> {
  try {
    const o = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536)) as Record<string, number>;
  } catch {
    return {};
  }
}

export interface StableEndpoint {
  token: string;
  /** Port this file used last time, if any. */
  port?: number;
  remember(port: number): void;
}

/** Token (and last port) that stay the same between runs. Null if the folder cannot be trusted or written: callers use a random token. */
export function stableEndpoint(realFile: string, opts: { dir?: string; renew?: boolean } = {}): StableEndpoint | null {
  const dir = opts.dir ?? stateDir();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    ensureRunDir(dir);
    const token = tokenFor(readSecret(dir, opts.renew === true), realFile);
    const portsPath = join(dir, "ports.json");
    return {
      token,
      port: readPorts(portsPath)[realFile],
      remember(port) {
        try {
          const ports = readPorts(portsPath);
          delete ports[realFile]; // most recent last, so the oldest go first
          const keep = Object.entries({ ...ports, [realFile]: port }).slice(-MAX_PORTS);
          writePrivate(portsPath, JSON.stringify(Object.fromEntries(keep)) + "\n");
        } catch { /* a port that is not remembered only costs a new URL */ }
      },
    };
  } catch {
    return null;
  }
}
