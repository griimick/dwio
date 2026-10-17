import { readFileSync } from "node:fs";

// Replaced by a constant in the standalone binary build.
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
