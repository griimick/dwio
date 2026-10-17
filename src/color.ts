// Minimal terminal colors: dim labels, red errors, one accent (Catppuccin Mocha green; opencode's installer uses gold),
// and cyan for links.
// Colors are used only when the stream is a terminal. NO_COLOR turns them off; FORCE_COLOR turns them on.

export interface Style {
  dim(s: string): string;
  red(s: string): string;
  accent(s: string): string;
  /** Cyan, for links that the user can open. */
  link(s: string): string;
}

export interface ColorEnv {
  env: Record<string, string | undefined>;
  isTTY: boolean;
}

export function colorEnabled({ env, isTTY }: ColorEnv): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return env.FORCE_COLOR !== "0";
  return isTTY && env.TERM !== "dumb";
}

const wrap = (on: boolean, code: string) => (s: string): string => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

/** Catppuccin Mocha "Green" is #a6e3a1. Terminals without true color get the nearest color of the 256-color palette. */
export const ACCENT_TRUECOLOR = "38;2;166;227;161";
export const ACCENT_256 = "38;5;151";

export function hasTrueColor(env: Record<string, string | undefined> = process.env): boolean {
  return /truecolor|24bit/i.test(env.COLORTERM ?? "");
}

export function makeStyle(enabled: boolean, truecolor = false): Style {
  return { dim: wrap(enabled, "0;2"), red: wrap(enabled, "0;31"), accent: wrap(enabled, truecolor ? ACCENT_TRUECOLOR : ACCENT_256), link: wrap(enabled, "0;36") };
}

/** Style for one output stream (stdout and stderr are decided separately, so a pipe on one does not affect the other). */
export function styleFor(stream: { isTTY?: boolean }, env: Record<string, string | undefined> = process.env): Style {
  return makeStyle(colorEnabled({ env, isTTY: !!stream.isTTY }), hasTrueColor(env));
}

/** Colors the section headings of the help text (lines such as "Usage:" or "Export options (dwio export):"). */
export function colorHelp(help: string, s: Style): string {
  return help
    .split("\n")
    .map((line) => (/^[A-Z][^\n]*:$/.test(line) ? s.accent(line) : line))
    .join("\n");
}
