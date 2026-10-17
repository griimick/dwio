import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";

/** Where releases live. DWIO_RELEASES_URL replaces it (mirrors, tests). */
export const RELEASES_URL = "https://github.com/griimick/dwio/releases";

export function releasesUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.DWIO_RELEASES_URL || RELEASES_URL).replace(/\/+$/, "");
}

export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Positive when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`cannot compare versions "${a}" and "${b}"`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** Release file name for a platform, the same names that install.sh uses. */
export function assetName(platform: string = process.platform, arch: string = process.arch): string {
  const os = platform === "win32" ? "windows" : platform;
  if (!["linux", "darwin", "windows"].includes(os)) throw new Error(`no release file for platform "${platform}"`);
  if (!["x64", "arm64"].includes(arch)) throw new Error(`no release file for CPU "${arch}"`);
  if (os === "windows" && arch !== "x64") throw new Error(`no release file for Windows on ${arch}`);
  return `dwio-${os}-${arch}${os === "windows" ? ".exe" : ""}`;
}

/** True for the standalone program from install.sh. False when dwio runs from source, from the npm bundle, or under Node or Bun. */
export function isStandalone(execPath: string = process.execPath): boolean {
  const name = (execPath.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "");
  return !["node", "nodejs", "bun"].includes(name);
}

export async function latestTag(base: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${base}/latest`, { redirect: "manual" });
  const location = res.headers.get("location");
  const m = location ? /\/tag\/(v?\d+\.\d+\.\d+[^/?#]*)$/.exec(location) : null;
  if (!m) throw new Error(res.status === 404 ? "no release found" : `could not read the latest release from ${base}/latest (status ${res.status})`);
  return m[1]!;
}

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** Finds the checksum for one file in a SHA256SUMS text ("<hex>  <name>" per line). */
export function checksumFor(sums: string, asset: string): string | null {
  for (const line of sums.split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m && m[2] === asset) return m[1]!.toLowerCase();
  }
  return null;
}

const runs = (path: string): boolean => {
  const r = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0 && /^\d+\.\d+\.\d+/.test(r.stdout);
};

/**
 * Puts new program bytes in place of the running program. The new file is written next to the old one and run once
 * (--version) before the swap, so a bad download never replaces a working program.
 */
export function replaceExecutable(exe: string, data: Uint8Array, opts: { platform?: string; verify?: (path: string) => boolean } = {}): void {
  const platform = opts.platform ?? process.platform;
  const verify = opts.verify ?? runs;
  const tmp = `${exe}.new-${process.pid}`;
  const old = `${exe}.old`;
  try {
    writeFileSync(tmp, data);
    chmodSync(tmp, 0o755);
    if (!verify(tmp)) throw new Error("the downloaded program does not run on this computer");
    if (platform === "win32") {
      // Windows cannot overwrite a running program but can rename it.
      rmSync(old, { force: true });
      renameSync(exe, old);
      renameSync(tmp, exe);
      rmSync(old, { force: true });
    } else {
      renameSync(tmp, exe); // atomic; the running process keeps its old file until it exits
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new Error(`cannot write to ${exe} (${code}). Run dwio upgrade with permission to change that folder, or install again with install.sh and DWIO_INSTALL_DIR set to a folder you own.`);
    }
    throw e;
  }
}

export interface UpgradeOptions {
  current: string;
  /** A specific version to install (upgrade or downgrade). Default: the latest release. */
  target?: string;
  /** Only report; change nothing. */
  checkOnly?: boolean;
  exePath?: string;
  base?: string;
  platform?: string;
  arch?: string;
  fetchFn?: typeof fetch;
  verify?: (path: string) => boolean;
  log?: (msg: string) => void;
}

export type UpgradeResult =
  | { status: "up-to-date"; current: string; latest: string }
  | { status: "available"; current: string; latest: string }
  | { status: "upgraded"; current: string; latest: string };

async function download(url: string, fetchFn: typeof fetch): Promise<Uint8Array> {
  const res = await fetchFn(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function upgrade(o: UpgradeOptions): Promise<UpgradeResult> {
  const fetchFn = o.fetchFn ?? fetch;
  const base = o.base ?? releasesUrl();
  const log = o.log ?? (() => {});
  const exe = o.exePath ?? process.execPath;

  let tag: string;
  if (o.target) {
    if (!parseVersion(o.target)) throw new Error(`"${o.target}" is not a version. Use a number such as 0.1.2`);
    tag = o.target.startsWith("v") ? o.target : `v${o.target}`;
  } else {
    tag = await latestTag(base, fetchFn);
  }
  const latest = tag.replace(/^v/, "");

  if (!o.target && compareVersions(latest, o.current) <= 0) return { status: "up-to-date", current: o.current, latest };
  if (o.target && compareVersions(latest, o.current) === 0) return { status: "up-to-date", current: o.current, latest };
  if (o.checkOnly) return { status: "available", current: o.current, latest };

  if (!isStandalone(exe)) {
    throw new Error("this dwio is not the standalone program, so it cannot replace itself. Use `npm install -g @griimick/dwio` (npx always runs the newest), or install the program with install.sh.");
  }

  const asset = assetName(o.platform, o.arch);
  log(`Downloading ${asset} ${tag}…`);
  const [data, sums] = await Promise.all([download(`${base}/download/${tag}/${asset}`, fetchFn), download(`${base}/download/${tag}/SHA256SUMS`, fetchFn)]);
  const want = checksumFor(new TextDecoder().decode(sums), asset);
  if (!want) throw new Error(`SHA256SUMS has no entry for ${asset}; not installing`);
  if (sha256(data) !== want) throw new Error(`checksum mismatch for ${asset}; not installing`);

  log("Checksum matches. Replacing the program…");
  replaceExecutable(exe, data, { platform: o.platform, verify: o.verify });
  return { status: "upgraded", current: o.current, latest };
}
