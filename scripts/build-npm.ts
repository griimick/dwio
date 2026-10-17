// Bundles the CLI into one Node-compatible file (dist/cli.js) for `npx dwio`. Run with Bun: bun scripts/build-npm.ts
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inlineAssets, root } from "./inline-plugin.ts";

const result = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  outdir: join(root, "dist"),
  target: "node",
  format: "esm",
  minify: true,
  plugins: [inlineAssets],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
// The bundle inherits src/cli.ts's bun shebang and a "// @bun" marker; replace them with a node shebang.
const file = join(root, "dist/cli.js");
const code = readFileSync(file, "utf8").replace(/^(#![^\n]*\n)?(\/\/ @bun\n)?/, "");
writeFileSync(file, `#!/usr/bin/env node\n${code}`);
chmodSync(file, 0o755);
console.log("built dist/cli.js");
