import { inflateRawSync } from "node:zlib";

/** On-disk representation of a diagram. `svg` covers `.svg` and `.drawio.svg`. */
export type Kind = "drawio" | "svg";

export const EMPTY_MXFILE =
  '<mxfile><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export function kindFromPath(path: string): Kind {
  return path.toLowerCase().endsWith(".svg") ? "svg" : "drawio";
}

const ENTITIES: Record<string, string> = { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" };

export function unescapeXml(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(quot|apos|lt|gt|amp));/gi, (_, hex, dec, name) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : ENTITIES[name.toLowerCase()]!,
  );
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#xa;");
}

/** Returns the mxfile XML embedded in a draw.io SVG (`content` attribute on the root element), or null. */
export function extractMxfileFromSvg(svg: string): string | null {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) return null;
  const m = /\scontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(root);
  const raw = m?.[1] ?? m?.[2];
  return raw === undefined ? null : unescapeXml(raw);
}

/** XML to hand to the editor for a file's text. Null means the file is not a loadable diagram. */
export function toEditorXml(text: string, kind: Kind): string | null {
  if (text.trim() === "") return EMPTY_MXFILE;
  if (kind === "svg") return extractMxfileFromSvg(text);
  return text;
}

/** Content for a brand-new file of the given kind. */
export function emptyFile(kind: Kind): string {
  if (kind === "drawio") return EMPTY_MXFILE + "\n";
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="1px" height="1px" viewBox="0 0 1 1" ' +
    `content="${escapeAttr(EMPTY_MXFILE)}"><defs/><g/></svg>\n`
  );
}

/** Expands compressed `<diagram>` bodies (base64 + raw deflate + URI-encoded) into plain XML. */
export function decompressDiagrams(mxfile: string): string {
  return mxfile.replace(/(<diagram\b[^>]*>)([^<]+)(<\/diagram>)/g, (whole, open, body: string, close) => {
    try {
      const xml = decodeURIComponent(inflateRawSync(Buffer.from(body.trim(), "base64")).toString("utf8"));
      return open + xml + close;
    } catch {
      return whole;
    }
  });
}

/** Rewrites file text so embedded diagrams are plain XML (readable git diffs) instead of draw.io's compressed form. */
export function normalizeForDisk(text: string, kind: Kind): string {
  if (kind === "drawio") return decompressDiagrams(text);
  return text.replace(/(<svg\b[^>]*?\scontent\s*=\s*)"([^"]*)"/i, (_, pre: string, raw: string) => `${pre}"${escapeAttr(decompressDiagrams(unescapeXml(raw)))}"`);
}

export interface PageInfo {
  /** 1-based position in the file. */
  index: number;
  id: string;
  name: string;
}

/** Lists the pages of an mxfile. Works for compressed and plain diagrams because only the tag attributes are read. */
export function listPages(mxfile: string): PageInfo[] {
  const pages: PageInfo[] = [];
  for (const m of mxfile.matchAll(/<diagram\b([^>]*)>/g)) {
    const attrs = m[1] ?? "";
    const get = (k: string): string => {
      const a = new RegExp(`\\s${k}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(` ${attrs}`);
      return unescapeXml(a?.[1] ?? a?.[2] ?? "");
    };
    pages.push({ index: pages.length + 1, id: get("id"), name: get("name") || `Page-${pages.length + 1}` });
  }
  return pages;
}
