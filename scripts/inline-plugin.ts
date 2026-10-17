// Bun build plugin shared by the binary and npm builds: replaces the two modules that read files at runtime
// (src/web-assets.ts, src/meta.ts) with constants, so the output is a single self-contained file.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const root = new URL("..", import.meta.url).pathname;
export const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export const inlineAssets: Bun.BunPlugin = {
  name: "inline-assets",
  setup(build) {
    build.onLoad({ filter: /src[\\/]web-assets\.ts$/ }, () => ({
      loader: "js",
      contents: ["host.html", "host.js", "export.html", "export.js"]
        .map((f) => `export const ${f.replace(/\.(\w)/, (_, c) => c.toUpperCase())} = ${JSON.stringify(readFileSync(join(root, "src/web", f), "utf8"))};`)
        .join("\n"),
    }));
    build.onLoad({ filter: /src[\\/]meta\.ts$/ }, () => ({
      loader: "js",
      contents: `export const VERSION = ${JSON.stringify(pkg.version)};`,
    }));
  },
};
