import { unescapeXml } from "./format.ts";

/**
 * A small XML reader that remembers where everything is in the source text, so edits can patch exactly
 * those spots and leave every other byte alone (minimal git diffs). Handles what draw.io files contain:
 * elements, attributes, comments, <?xml?> and CDATA. It does not build text nodes.
 */
export interface Attr {
  name: string;
  /** Raw (still escaped) value. */
  raw: string;
  /** Whole attribute, from its name to the closing quote. */
  start: number;
  end: number;
  /** Value only, between the quotes. */
  vStart: number;
  vEnd: number;
  quote: string;
}

export interface El {
  name: string;
  attrs: Attr[];
  /** Index of "<". */
  start: number;
  /** Index just after the ">" of the start tag. */
  tagEnd: number;
  selfClosing: boolean;
  /** Index of "</" of the end tag, or -1 when self-closing. */
  closeStart: number;
  /** Index just after the element. */
  end: number;
  children: El[];
  parent: El | null;
}

export class XmlError extends Error {}

export function parseXml(src: string): El {
  let i = 0;
  const stack: El[] = [];
  let root: El | null = null;
  const fail = (msg: string): never => {
    throw new XmlError(`malformed XML at offset ${i}: ${msg}`);
  };
  const isWs = (c: string | undefined): boolean => c === " " || c === "\n" || c === "\t" || c === "\r";

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      if (e < 0) fail("unterminated comment");
      i = e + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const e = src.indexOf("]]>", i + 9);
      if (e < 0) fail("unterminated CDATA");
      i = e + 3;
    } else if (src.startsWith("<?", i) || src.startsWith("<!", i)) {
      const e = src.indexOf(">", i);
      if (e < 0) fail("unterminated declaration");
      i = e + 1;
    } else if (src.startsWith("</", i)) {
      const e = src.indexOf(">", i);
      if (e < 0) fail("unterminated end tag");
      const name = src.slice(i + 2, e).trim();
      const el = stack.pop();
      if (!el || el.name !== name) fail(`unexpected </${name}>`);
      el!.closeStart = i;
      el!.end = e + 1;
      i = e + 1;
    } else {
      const start = i;
      i++;
      const nameStart = i;
      while (i < src.length && !isWs(src[i]) && src[i] !== "/" && src[i] !== ">") i++;
      const el: El = { name: src.slice(nameStart, i), attrs: [], start, tagEnd: 0, selfClosing: false, closeStart: -1, end: 0, children: [], parent: stack[stack.length - 1] ?? null };
      if (!el.name) fail("empty tag name");
      for (;;) {
        while (isWs(src[i])) i++;
        if (i >= src.length) fail("unterminated start tag");
        if (src[i] === ">") {
          i++;
          break;
        }
        if (src[i] === "/" && src[i + 1] === ">") {
          el.selfClosing = true;
          i += 2;
          break;
        }
        const aStart = i;
        while (i < src.length && !isWs(src[i]) && src[i] !== "=" && src[i] !== "/" && src[i] !== ">") i++;
        const name = src.slice(aStart, i);
        while (isWs(src[i])) i++;
        if (src[i] !== "=") fail(`attribute "${name}" has no value`);
        i++;
        while (isWs(src[i])) i++;
        const quote = src[i];
        if (quote !== '"' && quote !== "'") fail(`attribute "${name}" value is not quoted`);
        const vStart = i + 1;
        const vEnd = src.indexOf(quote!, vStart);
        if (vEnd < 0) fail("unterminated attribute value");
        el.attrs.push({ name, raw: src.slice(vStart, vEnd), start: aStart, end: vEnd + 1, vStart, vEnd, quote: quote! });
        i = vEnd + 1;
      }
      el.tagEnd = i;
      if (el.selfClosing) el.end = i;
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (!root) root = el;
      if (!el.selfClosing) stack.push(el);
    }
  }
  if (stack.length) throw new XmlError(`malformed XML: <${stack[stack.length - 1]!.name}> is not closed`);
  if (!root) throw new XmlError("malformed XML: no element found");
  return root;
}

export const attr = (el: El, name: string): string | undefined => {
  const a = el.attrs.find((x) => x.name === name);
  return a ? unescapeXml(a.raw) : undefined;
};

export function* walk(el: El): Generator<El> {
  yield el;
  for (const c of el.children) yield* walk(c);
}

export function escapeAttrValue(s: string, quote = '"'): string {
  let out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xa;").replace(/\r/g, "&#xd;").replace(/\t/g, "&#x9;");
  out = quote === '"' ? out.replace(/"/g, "&quot;") : out.replace(/'/g, "&apos;");
  return out;
}

const splice = (src: string, from: number, to: number, text: string): string => src.slice(0, from) + text + src.slice(to);

/** Sets an attribute. An existing one is replaced in place; a new one is added at the end of the start tag. */
export function setAttr(src: string, el: El, name: string, value: string): string {
  const a = el.attrs.find((x) => x.name === name);
  if (a) return splice(src, a.vStart, a.vEnd, escapeAttrValue(value, a.quote));
  // Insert before "/>" or ">" (and before the space that precedes "/>").
  let at = el.tagEnd - (el.selfClosing ? 2 : 1);
  if (el.selfClosing && src[at - 1] === " ") at--;
  return splice(src, at, at, ` ${name}="${escapeAttrValue(value)}"`);
}

export function removeAttr(src: string, el: El, name: string): string {
  const a = el.attrs.find((x) => x.name === name);
  if (!a) return src;
  let from = a.start;
  while (from > 0 && (src[from - 1] === " " || src[from - 1] === "\t")) from--;
  return splice(src, from, a.end, "");
}

/** Removes an element. If it sits on its own lines, the whole lines go, so no blank line is left behind. */
export function removeElement(src: string, el: El): string {
  let from = el.start;
  let to = el.end;
  let a = from;
  while (a > 0 && (src[a - 1] === " " || src[a - 1] === "\t")) a--;
  let b = to;
  while (b < src.length && (src[b] === " " || src[b] === "\t" || src[b] === "\r")) b++;
  if ((a === 0 || src[a - 1] === "\n") && (b >= src.length || src[b] === "\n")) {
    from = a;
    to = b < src.length ? b + 1 : b;
  }
  return splice(src, from, to, "");
}

/** Leading whitespace of the line that contains `index`. */
export function indentAt(src: string, index: number): string {
  const lineStart = src.lastIndexOf("\n", index - 1) + 1;
  const m = /^[ \t]*/.exec(src.slice(lineStart, index + 1));
  return m ? m[0] : "";
}

/**
 * Appends a child as the last child of `parent` (which needs an end tag). `pretty` is a multi-line form for
 * pretty-printed files (its lines get the siblings' indentation); `inline` is the one-line form for compact files.
 */
export function appendChild(src: string, parent: El, pretty: string, inline: string): string {
  if (parent.selfClosing) throw new XmlError(`<${parent.name}> has no end tag`);
  const last = parent.children[parent.children.length - 1];
  const between = src.slice(last ? last.end : parent.tagEnd, parent.closeStart);
  if (!between.includes("\n")) return splice(src, parent.closeStart, parent.closeStart, inline);
  const indent = last ? indentAt(src, last.start) : indentAt(src, parent.start) + "  ";
  const closeLineStart = src.lastIndexOf("\n", parent.closeStart - 1) + 1;
  const block = pretty.split("\n").map((l) => indent + l).join("\n");
  return splice(src, closeLineStart, closeLineStart, block + "\n");
}
