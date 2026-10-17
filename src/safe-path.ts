import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Keeps file access inside chosen folders. Symbolic links are followed before the check, so a link inside a
 * folder cannot lead out of it. A path that does not exist yet (a new file) is checked through its nearest
 * existing parent folder.
 */

/** Real path of `p`, or, if `p` does not exist, the real path of its nearest existing parent plus the rest. */
export function realpathLoose(p: string): string {
  const path = resolve(p);
  const rest: string[] = [];
  let cur = path;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break; // reached the top
    rest.unshift(basename(cur));
    cur = parent;
  }
  return join(realpathSync(cur), ...rest);
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export class OutsideRootError extends Error {}

/**
 * Turns a path from an agent into a real path that is inside one of `roots`.
 * Relative paths are taken from `base`. Throws OutsideRootError when the path leaves every root.
 */
export function resolveInside(roots: string[], base: string, input: string): string {
  const real = realpathLoose(resolve(base, input));
  for (const root of roots) if (isInside(realpathLoose(root), real)) return real;
  const where = roots.length === 1 ? `the folder ${roots[0]}` : `these folders: ${roots.join(", ")}`;
  throw new OutsideRootError(`"${input}" is outside ${where}. dwio mcp may only use files inside it. To allow another folder, start dwio mcp with --root <folder>.`);
}
