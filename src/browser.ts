import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const PATH_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  "microsoft-edge",
  "microsoft-edge-stable",
  "brave-browser",
];

const FIXED_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

export interface FinderEnv {
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
  readdir: (path: string) => string[];
  home: string;
}

const realEnv = (): FinderEnv => ({
  env: process.env,
  exists: existsSync,
  readdir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
  home: homedir(),
});

/** Browsers that Playwright downloaded, in its cache folder. They work well for headless rendering. */
function playwrightBrowsers(f: FinderEnv): string[] {
  const roots = [join(f.home, ".cache", "ms-playwright"), join(f.home, "Library", "Caches", "ms-playwright"), join(f.env.LOCALAPPDATA ?? "", "ms-playwright")];
  const found: string[] = [];
  for (const root of roots) {
    for (const dir of f.readdir(root).sort().reverse()) {
      for (const sub of f.readdir(join(root, dir))) {
        for (const exe of ["chrome-headless-shell", "chrome", "headless_shell", "chrome.exe", "chrome-headless-shell.exe"]) {
          const p = join(root, dir, sub, exe);
          if (f.exists(p)) found.push(p);
        }
      }
    }
  }
  return found;
}

/** Looks for a Chromium-based browser. Returns the path and what was tried, for error messages. */
export function findBrowser(explicit?: string, f: FinderEnv = realEnv()): { path: string | null; tried: string[] } {
  const tried: string[] = [];
  for (const [label, value] of [
    ["--browser", explicit],
    ["DWIO_BROWSER", f.env.DWIO_BROWSER],
    ["CHROME_PATH", f.env.CHROME_PATH],
  ] as const) {
    if (!value) continue;
    tried.push(`${label}=${value}`);
    if (f.exists(value)) return { path: value, tried };
    // An explicit choice that does not exist is an error, not a reason to search elsewhere.
    return { path: null, tried };
  }
  const dirs = (f.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const name of PATH_NAMES) {
    for (const d of dirs) {
      for (const ext of ["", ".exe"]) {
        const p = join(d, name + ext);
        if (f.exists(p)) return { path: p, tried };
      }
    }
  }
  tried.push(`PATH: ${PATH_NAMES.join(", ")}`);
  for (const p of FIXED_PATHS) if (f.exists(p)) return { path: p, tried };
  const pw = playwrightBrowsers(f)[0];
  if (pw) return { path: pw, tried };
  tried.push("standard install folders", "Playwright browser cache");
  return { path: null, tried };
}

export function browserHelp(tried: string[]): string {
  return [
    "No Chrome, Chromium or Edge browser found. Export needs one to draw the diagram.",
    `Looked in: ${tried.join("; ")}.`,
    "Install one, or set DWIO_BROWSER (or use --browser) to its full path.",
  ].join("\n");
}
