import type { Style } from "./color.ts";

/**
 * A download loader for the terminal: a thin bar with the percent and the sizes, or a spinner when the total size
 * is not known. It draws on standard error, only when that is a terminal, and never leaves the cursor hidden.
 * Outside a terminal it does nothing, and the caller prints plain lines as before.
 */

export interface Progress {
  /** False outside a terminal. Then update() and finish() do nothing and the caller should print its own lines. */
  enabled: boolean;
  update(done: number, total: number | null): void;
  /** Removes the loader. With a summary, prints that one line in its place. Call it also after a failure (without a summary). */
  finish(summary?: string): void;
}

export const NO_PROGRESS: Progress = { enabled: false, update() {}, finish() {} };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

const SPINNER_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_ASCII = ["|", "/", "-", "\\"];

export interface RenderOptions {
  label: string;
  done: number;
  total: number | null;
  style: Style;
  unicode: boolean;
  frame: number;
  columns?: number;
}

/** Shortens a label with an ellipsis so that it fits in `max` characters. */
function fit(label: string, max: number, unicode: boolean): string {
  if (label.length <= max) return label;
  return label.slice(0, Math.max(1, max - 1)) + (unicode ? "…" : "~");
}

/** One line, without a line break. Its visible length stays within `columns`, so a carriage return can redraw it. */
export function renderProgress(o: RenderOptions): string {
  const s = o.style;
  const columns = o.columns && o.columns > 0 ? o.columns : 80; // some terminals report no size, or 0
  if (o.total === null || o.total <= 0) {
    const frames = o.unicode ? SPINNER_UNICODE : SPINNER_ASCII;
    // after the label: two spaces, the spinner, a space and the size (at most 8 characters)
    return `${s.dim(fit(o.label, columns - 13, o.unicode))}  ${s.accent(frames[o.frame % frames.length]!)} ${s.dim(formatBytes(o.done))}`;
  }
  const total = o.total;
  const pct = Math.min(100, Math.floor((o.done * 100) / total));
  // after the label: 30 characters for the spaces, the percent and the two sizes, plus a bar of at least 8
  const roomy = columns - 38 >= 8;
  const label = fit(o.label, roomy ? columns - 38 : columns - 8, o.unicode);
  const width = Math.min(28, columns - label.length - 30);
  if (!roomy || width < 8) return `${s.dim(label)}  ${s.accent(`${pct}%`)}`; // a narrow terminal: no bar
  const on = Math.round((pct * width) / 100);
  const [fill, empty] = o.unicode ? ["━", "─"] : ["#", "-"];
  return `${s.dim(label)}  ${s.accent(fill.repeat(on))}${s.dim(empty.repeat(width - on))} ${String(pct).padStart(3)}%  ${s.dim(`${formatBytes(o.done)} / ${formatBytes(total)}`)}`;
}

export interface ProgressOptions {
  stream: { isTTY?: boolean; columns?: number; write(chunk: string): unknown };
  label: string;
  style: Style;
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Shortest time between two redraws. */
  intervalMs?: number;
  unicode?: boolean;
}

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";

export function createProgress(o: ProgressOptions): Progress {
  const env = o.env ?? process.env;
  if (!o.stream.isTTY || env.TERM === "dumb") return NO_PROGRESS;
  const unicode = o.unicode ?? /utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || "");
  const now = o.now ?? Date.now;
  const interval = o.intervalMs ?? 80;
  let last = -Infinity;
  let drawn = false;
  let frame = 0;

  const onExit = (): void => {
    if (drawn) o.stream.write(SHOW);
  };
  const onSigint = (): void => {
    o.stream.write("\r\x1b[K" + SHOW);
    drawn = false;
    process.exit(130);
  };
  const restore = (): void => {
    if (drawn) o.stream.write("\r\x1b[K" + SHOW);
    drawn = false;
    process.off("SIGINT", onSigint);
    process.off("exit", onExit);
  };

  return {
    enabled: true,
    update(done, total) {
      const t = now();
      const complete = total !== null && done >= total;
      if (t - last < interval && !complete) return;
      last = t;
      if (!drawn) {
        drawn = true;
        o.stream.write(HIDE);
        process.on("SIGINT", onSigint);
        process.on("exit", onExit);
      }
      o.stream.write("\r" + renderProgress({ label: o.label, done, total, style: o.style, unicode, frame: frame++, columns: o.stream.columns }) + "\x1b[K");
    },
    finish(summary) {
      restore();
      if (summary) o.stream.write(o.style.dim(summary) + "\n");
    },
  };
}

/** Reads a whole response body. When `progress` is enabled, reports the bytes as they arrive. */
export async function readWithProgress(res: Response, progress?: Progress): Promise<Uint8Array> {
  if (!res.body || !progress?.enabled) return new Uint8Array(await res.arrayBuffer());
  const len = Number(res.headers.get("content-length"));
  // With a content encoding the length counts compressed bytes, so it cannot be compared with what we read.
  const total = Number.isFinite(len) && len > 0 && !res.headers.get("content-encoding") ? len : null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let done = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(r.value);
    done += r.value.length;
    progress.update(done, total);
  }
  const out = new Uint8Array(done);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
