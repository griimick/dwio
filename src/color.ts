// Minimal terminal colors, in the style of opencode's installer: dim labels, red errors, one orange accent.
// Colors are used only when the stream is a terminal. NO_COLOR turns them off; FORCE_COLOR turns them on.

export interface Style {
  dim(s: string): string;
  red(s: string): string;
  accent(s: string): string;
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

export function makeStyle(enabled: boolean): Style {
  return { dim: wrap(enabled, "0;2"), red: wrap(enabled, "0;31"), accent: wrap(enabled, "38;5;214") };
}

/** Style for one output stream (stdout and stderr are decided separately, so a pipe on one does not affect the other). */
export function styleFor(stream: { isTTY?: boolean }, env: Record<string, string | undefined> = process.env): Style {
  return makeStyle(colorEnabled({ env, isTTY: !!stream.isTTY }));
}

/** Colors the section headings of the help text (lines such as "Usage:" or "Export options (dwio export):"). */
export function colorHelp(help: string, s: Style): string {
  return help
    .split("\n")
    .map((line) => (/^[A-Z][^\n]*:$/.test(line) ? s.accent(line) : line))
    .join("\n");
}
