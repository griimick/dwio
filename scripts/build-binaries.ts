// Builds standalone executables (Bun runtime + our code + web assets in one file). Run with Bun:
//   bun scripts/build-binaries.ts            # current platform only
//   bun scripts/build-binaries.ts --all      # every release target
//   bun scripts/build-binaries.ts --target=linux-x64
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { inlineAssets, root } from "./inline-plugin.ts";

const out = join(root, "dist-bin");

const ALL = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"];
const arg = process.argv.find((a) => a.startsWith("--target="))?.slice("--target=".length);
const hostTarget = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const targets = process.argv.includes("--all") ? ALL : [arg ?? hostTarget];
for (const t of targets) if (!ALL.includes(t)) throw new Error(`unknown target ${t}; expected one of ${ALL.join(", ")}`);

mkdirSync(out, { recursive: true });
for (const t of targets) {
  const outfile = join(out, `dwio-${t}${t.startsWith("windows") ? ".exe" : ""}`);
  const result = await Bun.build({
    entrypoints: [join(root, "src/cli.ts")],
    plugins: [inlineAssets],
    minify: true,
    compile: { target: `bun-${t}` as Bun.Build.CompileTarget, outfile },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  console.log(`built ${outfile}`);
}
