import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Pinned upstream draw.io release whose static webapp we serve. Override with --drawio-version. */
export const DRAWIO_VERSION = "32.4.1";

/** Upstream parts that are never needed for local editing (server config, offline service worker). */
const PRUNE = ["WEB-INF", "META-INF", "service-worker.js", "service-worker.js.map", "workbox-05b6c01b.js", "workbox-05b6c01b.js.map"];

export function cacheRoot(): string {
  const base = process.env.DRAWIO_CACHE_DIR ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "drawio-local");
  return base;
}

export function webappDir(version = DRAWIO_VERSION): string {
  return join(cacheRoot(), `webapp-${version}`);
}

export function isInstalled(version = DRAWIO_VERSION): boolean {
  return existsSync(join(webappDir(version), "index.html"));
}

/** Downloads and unpacks the draw.io webapp once; afterwards the tool never touches the network. */
export async function install(version = DRAWIO_VERSION, log: (msg: string) => void = () => {}): Promise<string> {
  const dest = webappDir(version);
  if (isInstalled(version)) return dest;

  const url = `https://github.com/jgraph/drawio/archive/refs/tags/v${version}.tar.gz`;
  log(`Downloading draw.io v${version} (one-time, ~50 MB)…`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} (${url})`);

  mkdirSync(cacheRoot(), { recursive: true });
  const tarball = join(tmpdir(), `drawio-${version}-${process.pid}.tar.gz`);
  const staging = `${dest}.partial-${process.pid}`;
  try {
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    log("Unpacking…");
    const tar = spawnSync("tar", ["-xzf", tarball, "-C", staging, "--strip-components=4", `drawio-${version}/src/main/webapp`], { encoding: "utf8" });
    if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error?.message}`);
    for (const p of PRUNE) rmSync(join(staging, p), { recursive: true, force: true });
    if (!existsSync(join(staging, "index.html"))) throw new Error("unexpected archive layout: index.html missing");
    writeFileSync(join(staging, ".version"), version + "\n");
    rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
  } finally {
    rmSync(tarball, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }
  log(`Installed to ${dest}`);
  return dest;
}

export function installedVersion(dir: string): string | null {
  try {
    return readFileSync(join(dir, ".version"), "utf8").trim();
  } catch {
    return null;
  }
}
