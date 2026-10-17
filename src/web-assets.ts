import { readFileSync } from "node:fs";

// Loaded eagerly into strings so the standalone build (scripts/inline-plugin.ts) can swap this module for inlined copies.
const read = (name: string): string => readFileSync(new URL(`./web/${name}`, import.meta.url), "utf8");

export const hostHtml: string = read("host.html");
export const hostJs: string = read("host.js");
export const exportHtml: string = read("export.html");
export const exportJs: string = read("export.js");
