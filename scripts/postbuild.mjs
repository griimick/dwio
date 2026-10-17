import { chmodSync, cpSync } from "node:fs";
cpSync("src/web", "dist/web", { recursive: true });
chmodSync("dist/cli.js", 0o755);
