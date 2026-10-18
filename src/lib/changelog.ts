// Control Scout's own "What's new": the releases in CHANGELOG.md (newest first), read into versions with
// their themed groups of changes, plus the "seen" rule for the unread dot. Scout's changelog only: Control
// Point keeps its own. Pure, unit tested; the markdown itself loads with the dialog, not the app.
import { APP_VERSION } from "./errorReporting";

export interface ChangelogGroup { heading: string; items: string[] }
export interface ChangelogEntry { version: string; date: string; summary: string; groups: ChangelogGroup[] }

/** CHANGELOG.md → releases. `## 1.7.0 — 2026-10-18`, an intro line, `### Group` headings and `- ` bullets. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let group: ChangelogGroup | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const rel = /^##\s+(\d+\.\d+\.\d+)\s*[—–-]\s*(.+)$/.exec(line);
    if (rel) { entry = { version: rel[1], date: rel[2].trim(), summary: "", groups: [] }; out.push(entry); group = null; continue; }
    if (!entry) continue;
    const head = /^###\s+(.+)$/.exec(line);
    if (head) { group = { heading: head[1].trim(), items: [] }; entry.groups.push(group); continue; }
    const item = /^\s*[-*]\s+(.+)$/.exec(line);
    if (item) {
      if (!group) { group = { heading: "Changes", items: [] }; entry.groups.push(group); }
      group.items.push(item[1].trim());
      continue;
    }
    // Text before the first group is the release's one-line summary.
    if (line.trim() && !group && !entry.summary) entry.summary = line.trim();
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

/** The running app's release ("1.7.0" from "1.7.0+abc1234"); null in development without a version. */
export const currentRelease = (v: string = APP_VERSION): string | null => (/^\d+\.\d+\.\d+/.exec(v)?.[0] ?? null);

const SEEN_KEY = "cs-whats-new-seen";
export function seenRelease(): string | null { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } }
export function markReleaseSeen(v = currentRelease()): void { if (v) try { localStorage.setItem(SEEN_KEY, v); } catch { /* storage blocked */ } }
/** A release this device hasn't opened What's new for yet. */
export const hasUnseenRelease = (v = currentRelease(), seen = seenRelease()) => !!v && v !== seen;
