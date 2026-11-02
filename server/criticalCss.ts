// The part of the app's stylesheet a server-drawn page (team, event: server/firstPaint.ts) needs for its first paint,
// inlined in its HTML, so the page paints without waiting on the whole stylesheet (35 KB compressed). On venue Wi-Fi
// (400 kbps) that file shared the line with the fonts and the app's code and held the drawn page back for seconds.
//
// The stylesheet is split into its rules once per file. A page keeps every rule with a selector whose classes all
// appear in its markup (or on <html>: the theme classes index.html's head script sets), plus every rule that names
// no class at all (resets, :root tokens, @property defaults). Classes inside :not(), :is(), :where(), :has() and
// attribute selectors don't count against a rule: such a rule is kept on its other classes, never dropped by mistake.
// Kept rules stay in their original order and layers, and the full stylesheet arrives later with the same rules, so
// nothing changes when it applies. @font-face is left out: the drawn page declares its own faces (seo.ts FIRST_PAINT_FONTS).
import { readFileSync } from "node:fs";

type CssNode =
  | { kind: "rule"; text: string; need: string[][] | null }
  | { kind: "block"; prelude: string; children: CssNode[] }
  | { kind: "raw"; text: string };

/** Classes index.html's head script may put on <html> before the first paint. */
export const HTML_CLASSES = ["light", "dim", "midnight", "compact", "cs-sb-min", "cs-nav-more"];

/** At-rules whose block holds rules (filtered rule by rule); any other at-rule with a block is kept whole. */
const GROUPING = /^@(media|supports|layer|container|scope|starting-style)\b/i;

/** The index just past the block that opens at `css[open] === "{"`, skipping strings, escapes and comments. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") { i = stringEnd(css, i); continue; }
    if (c === "/" && css[i + 1] === "*") { i = css.indexOf("*/", i + 2); if (i < 0) return css.length; i++; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return css.length;
}

function stringEnd(css: string, at: number): number {
  const q = css[at];
  for (let i = at + 1; i < css.length; i++) {
    if (css[i] === "\\") i++;
    else if (css[i] === q) return i;
  }
  return css.length;
}

function parse(css: string): CssNode[] {
  const out: CssNode[] = [];
  let i = 0;
  while (i < css.length) {
    // Prelude: up to a "{" (a block) or ";" (a statement such as `@layer a,b;`).
    let j = i;
    let found = -1;
    for (; j < css.length; j++) {
      const c = css[j];
      if (c === "\\") { j++; continue; }
      if (c === '"' || c === "'") { j = stringEnd(css, j); continue; }
      if (c === "/" && css[j + 1] === "*") { const e = css.indexOf("*/", j + 2); j = e < 0 ? css.length : e + 1; continue; }
      if (c === "{" || c === ";") { found = j; break; }
    }
    if (found < 0) break;
    const prelude = css.slice(i, found).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (css[found] === ";") {
      if (prelude) out.push({ kind: "raw", text: `${prelude};` });
      i = found + 1;
      continue;
    }
    const end = blockEnd(css, found);
    const body = css.slice(found + 1, end - 1);
    if (prelude.startsWith("@")) {
      if (/^@font-face\b/i.test(prelude)) { /* the drawn page's own faces stand in */ }
      else if (GROUPING.test(prelude)) out.push({ kind: "block", prelude, children: parse(body) });
      else out.push({ kind: "raw", text: css.slice(i, end).trim() });
    } else if (prelude) {
      out.push({ kind: "rule", text: `${prelude}{${body}}`, need: selectorNeeds(prelude) });
    }
    i = end;
  }
  return out;
}

/** Splits on commas outside parentheses and brackets. */
function topLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
  }
  parts.push(s.slice(start));
  return parts;
}

/** The index of the ")" or "]" that closes the group opening at `s[open]`. */
function groupEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && --depth === 0) return i;
  }
  return s.length;
}

/**
 * The part of a selector whose classes must all be on the page: attribute selectors and the arguments of :not(),
 * :has() and other functions go; a single-branch :is() or :where() (Tailwind's `:where(.space-y-2>:not(:last-child))`,
 * `:is(:where(.group):hover *)`) is kept, as its classes are needed too. Escaped brackets (`.w-\[12px\]`) stay.
 */
function required(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { out += s.slice(i, i + 2); i++; continue; }
    if (c === "[") { i = groupEnd(s, i); continue; }
    if (c === "(") {
      const end = groupEnd(s, i);
      const inner = s.slice(i + 1, end);
      if (/:(?:is|where)$/.test(out) && topLevelCommas(inner).length === 1) out += ` ${required(inner)} `;
      i = end;
      continue;
    }
    out += c;
  }
  return out;
}

const unescapeIdent = (s: string) => s
  .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\(.)/g, "$1");

/** Per selector in the list, the classes it needs; null when one of them needs none (the rule always stays). */
export function selectorNeeds(prelude: string): string[][] | null {
  const needs: string[][] = [];
  for (const sel of topLevelCommas(prelude)) {
    const classes = [...required(sel).matchAll(/\.((?:\\[0-9a-fA-F]{1,6}\s?|\\.|[\w-])+)/g)].map((m) => unescapeIdent(m[1]));
    if (!classes.length) return null;
    needs.push(classes);
  }
  return needs;
}

function serialize(nodes: CssNode[], has: Set<string>): string {
  let out = "";
  for (const n of nodes) {
    if (n.kind === "raw") out += n.text;
    else if (n.kind === "rule") { if (!n.need || n.need.some((cls) => cls.every((c) => has.has(c)))) out += n.text; }
    else {
      const inner = serialize(n.children, has);
      // An empty @layer block still fixes that layer's place in the order; other empty blocks go.
      if (inner || /^@layer\b/i.test(n.prelude)) out += `${n.prelude}{${inner}}`;
    }
  }
  return out;
}

/** A class attribute's text as the browser reads it (React writes ' as &#x27;, so `[class*='size-']` variants arrive escaped). */
const decode = (s: string) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(quot|lt|gt|amp|apos));/gi, (m, hex?: string, dec?: string, name?: string) => {
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  if (dec) return String.fromCodePoint(parseInt(dec, 10));
  return ({ quot: '"', lt: "<", gt: ">", amp: "&", apos: "'" } as Record<string, string>)[name!.toLowerCase()] ?? m;
});

/** Every class named in the HTML's class attributes, plus the classes <html> may carry (HTML_CLASSES). */
export function htmlClasses(html: string): Set<string> {
  const has = new Set(HTML_CLASSES);
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of decode(m[1]).split(/\s+/)) if (c) has.add(c);
  return has;
}

const parsed = new Map<string, CssNode[]>();
/** A stylesheet's rules, parsed once per file (the built assets are content-hashed: a file never changes). */
function sheet(file: string): CssNode[] {
  let nodes = parsed.get(file);
  if (!nodes) {
    try { nodes = parse(readFileSync(file, "utf8")); } catch { nodes = []; }
    parsed.set(file, nodes);
  }
  return nodes;
}

/** The rules of `css` (stylesheet text) that the markup in `html` uses. */
export function criticalCssFor(css: string, html: string): string {
  return serialize(parse(css), htmlClasses(html));
}

/** The rules of these stylesheet files, in order, that the markup in `html` uses. */
export function criticalCss(files: string[], html: string): string {
  const has = htmlClasses(html);
  return files.map((f) => serialize(sheet(f), has)).join("");
}
