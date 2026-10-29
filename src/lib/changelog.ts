// Control Scout's own "What's new": the releases in CHANGELOG.md (newest first), read into versions with
// their themed groups of changes, plus the "seen" rule for the unread dot. Scout's changelog only: Control
// Point keeps its own. Pure, unit tested; the markdown itself loads with the dialog, not the app.
import { APP_VERSION } from "./errorReporting";

export interface ChangelogGroup { heading: string; items: string[] }
/** One line of a release's digest: what a visitor notices, tagged for its icon (`- [home] A new home page`). */
export interface ChangelogHighlight { tag: string | null; text: string }
export interface ChangelogEntry { version: string; date: string; summary: string; highlights: ChangelogHighlight[]; groups: ChangelogGroup[] }

/** The `[tag]`s a highlight can start with; each has its own icon and colour in What's new. */
export const HIGHLIGHT_TAGS = ["home", "predict", "teams", "scout", "offline", "speed", "live", "report", "alerts", "rankings", "share", "workspace", "picklist", "history", "fixes"] as const;
export type HighlightTag = (typeof HIGHLIGHT_TAGS)[number];

/** The heading of a release's digest block; its bullets become `highlights`, not a group of the full notes. */
const HIGHLIGHTS = /^highlights$/i;

/** A highlight bullet: an optional `[tag]` (lower case, picks the icon) and its one line of text. */
export function parseHighlight(item: string): ChangelogHighlight {
  const m = /^\[([a-z][a-z-]*)\]\s*(.+)$/.exec(item);
  return m ? { tag: m[1], text: m[2].trim() } : { tag: null, text: item };
}

/** Releases are numbered 1.1, 1.2, 1.3 …, the third number counting the steps inside one: 1.3.7, 1.3.8,
 *  1.3.9, then 1.4.0 (and 1.9.9 → 2.0.0). No number ever goes past one digit. */
export function nextRelease(v: string): string {
  const [major, minor, step] = v.split(".").map(Number);
  if (step < 9) return `${major}.${minor}.${step + 1}`;
  return minor < 9 ? `${major}.${minor + 1}.0` : `${major + 1}.0.0`;
}

/** The old numbering (1.5.0 … 1.37.0, a minor per release) → the current one: 1.N.0 → 1.(N div 10).(N mod 10),
 *  so 1.37.0 → 1.3.7 and 1.5.0 → 1.0.5. An old fix release (1.19.1) keeps its fix number as a fourth part,
 *  1.1.9.1. Anything else (already current, or not a version) comes back unchanged. */
export function fromOldNumbering(v: string): string {
  const m = /^1\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return v;
  const n = Number(m[1]), fix = Number(m[2]);
  if (n < 5 || n > 37) return v;
  return `1.${Math.floor(n / 10)}.${n % 10}${fix ? `.${fix}` : ""}`;
}

/** CHANGELOG.md → releases. `## 1.7.0 — 2026-10-18`, an intro line, an optional `### Highlights` block of
 *  short `- [tag] line` bullets (the digest shown first), then `### Group` headings and `- ` bullets (the
 *  full notes). A release without highlights still parses; the dialog then shows its full notes. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let group: ChangelogGroup | null = null;
  let inHighlights = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const rel = /^##\s+(\d+\.\d+\.\d+(?:\.\d+)?)\s*[—–-]\s*(.+)$/.exec(line);
    if (rel) { entry = { version: rel[1], date: rel[2].trim(), summary: "", highlights: [], groups: [] }; out.push(entry); group = null; inHighlights = false; continue; }
    if (!entry) continue;
    const head = /^###\s+(.+)$/.exec(line);
    if (head) {
      inHighlights = HIGHLIGHTS.test(head[1].trim());
      group = inHighlights ? null : { heading: head[1].trim(), items: [] };
      if (group) entry.groups.push(group);
      continue;
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item && inHighlights) { entry.highlights.push(parseHighlight(item[1].trim())); continue; }
    if (item) {
      if (!group) { group = { heading: "Changes", items: [] }; entry.groups.push(group); }
      group.items.push(item[1].trim());
      continue;
    }
    // Text before the first group is the release's one-line summary.
    if (line.trim() && !group && !inHighlights && !entry.summary) entry.summary = line.trim();
  }
  return out;
}

/** An inline piece of a changelog line: plain text, **bold**, `code`, or a PR number (#123) to link. */
export type Inline = { kind: "text" | "bold" | "code"; text: string } | { kind: "pr"; text: string; number: number };

/** Split a line into its inline pieces ("Control Point #252" stays text: those PRs are another repo's). */
export function inlines(line: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|(Control Point )?#(\d+)/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > at) out.push({ kind: "text", text: line.slice(at, m.index) });
    if (m[1] != null) out.push({ kind: "bold", text: m[1] });
    else if (m[2] != null) out.push({ kind: "code", text: m[2] });
    else if (m[3]) out.push({ kind: "text", text: m[0] });
    else out.push({ kind: "pr", text: `#${m[4]}`, number: Number(m[4]) });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ kind: "text", text: line.slice(at) });
  return out;
}

/** The PR numbers a release links ("(#335)"), Control Point's left out. */
export const releasePrs = (e: ChangelogEntry): number[] =>
  [...new Set([e.summary, ...e.highlights.map((h) => h.text), ...e.groups.flatMap((g) => g.items)]
    .flatMap((l) => inlines(l).flatMap((p) => (p.kind === "pr" ? [p.number] : []))))];

/** What a release still needs before it reads well in What's new (the rules CHANGELOG.md sets out); empty when none. */
export function releaseProblems(e: ChangelogEntry): string[] {
  const out: string[] = [];
  if (!e.summary) out.push("No one-line summary under the version heading");
  if (e.highlights.length < 3 || e.highlights.length > 5) out.push(`${e.highlights.length} highlights (3 to 5 wanted)`);
  const untagged = e.highlights.filter((h) => !h.tag || !(HIGHLIGHT_TAGS as readonly string[]).includes(h.tag)).length;
  if (untagged) out.push(`${untagged} ${untagged === 1 ? "highlight has" : "highlights have"} no known [tag]`);
  if (!releasePrs(e).length) out.push("No PR linked, e.g. (#335)");
  return out;
}

/** The running app's release ("1.7.0" from "1.7.0+abc1234"); null in development without a version. */
export const currentRelease = (v: string = APP_VERSION): string | null => (/^\d+\.\d+\.\d+/.exec(v)?.[0] ?? null);

/** Where the last-seen release is kept. The key changed with the renumbering, so a value under the old key is
 *  always an old number (1.7.0 there means today's 1.0.7, not a future 1.7.0) and is read through fromOldNumbering. */
const SEEN_KEY = "cs-whats-new-seen-2";
const OLD_SEEN_KEY = "cs-whats-new-seen";
/** The release this device last opened What's new on (one seen before the renumbering reads as its new number,
 *  so the renumbering alone doesn't light the unread dot). */
export function seenRelease(): string | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    if (v) return v;
    const old = localStorage.getItem(OLD_SEEN_KEY);
    return old ? fromOldNumbering(old) : null;
  } catch { return null; }
}
export function markReleaseSeen(v = currentRelease()): void { if (v) try { localStorage.setItem(SEEN_KEY, v); } catch { /* storage blocked */ } }
/** A release this device hasn't opened What's new for yet. */
export const hasUnseenRelease = (v = currentRelease(), seen = seenRelease()) => !!v && v !== seen;
