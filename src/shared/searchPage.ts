// The /search page's heading and what makes a hit a Compare: shared by the app (src/pages/SearchPage.tsx) and the
// server's first paint of the same page (server/seoMeta.ts searchMeta), so both title it the same way.
import type { SearchAnswer, SearchHit } from "./api.js";
import { showingLine } from "./search.js";

/** What the server says it understood (the search-engine work, `SearchAnswer.understood`): the one line to show, and
 *  when the hits are a fallback rather than the answer, the line that says so. Read defensively (older servers lack it). */
export interface UnderstoodLine { label: string; fallback?: string; total?: number; /** What it was read as ("events"), and an event set's time ("upcoming"). */ kind?: string; time?: string }
export type AnswerExtra = Omit<SearchAnswer, "understood"> & { understood?: UnderstoodLine };

/** The server's reading of the query, in words ("League meets in New Jersey"), when it sends one. */
export const readingOf = (a: AnswerExtra | undefined): string | null => a?.understood?.label?.trim() || null;

/** A reading without its "(did you mean …)" tail: the page says that on its own line. */
const plain = (s: string) => s.replace(/\s*\(did you mean\s.*\)\s*$/i, "").trim();
const norm = (s: string) => plain(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A reading that only repeats the words typed ("Teams, events and matches matching "won nj states"", "Closest names
 *  to "hypnotc"", "No match for "zzz""): the server read no meaning into them, so it never titles the page or badges it
 *  (the page never echoes the query). */
export const echoesQuery = (label: string) => /^(?:teams, events and matches matching|closest names to|no match for)\s+["“]/i.test(label.trim());

/** What a page of name matches holds, by kind and in the order found: "Matching events", "Matching teams and events". */
function foundTitle(hits: SearchHit[]): string {
  const KIND: Record<string, string> = { team: "teams", event: "events", match: "matches" };
  const kinds = [...new Set(hits.filter((h) => !isCompare(h)).map((h) => KIND[h.kind]).filter(Boolean))];
  if (!kinds.length) return "Search results";
  return `Matching ${kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(", ")} and ${kinds[kinds.length - 1]}`}`;
}

/** The badge as shown under a title: none when it only repeats the title ("League meets in New Jersey" under
 *  "League meets in New Jersey", "… vs … — Compare" under "… vs …"), so the page never says one thing twice. */
export function badgeUnder(title: string, badge: string | null): string | null {
  if (!badge) return null;
  const t = norm(title), b = norm(badge);
  if (!b || b === t || b.startsWith(`${t} `)) return null;
  // "Team 6980 — Where They're From" over "Bad Wolf (6980) · Where they're from": the same team and the same fact.
  const m = /^Team (\d+) — (.+)$/.exec(title);
  const fact = badge.split(" · ").pop()!;
  if (m && fact !== badge && (badge.includes(`(${m[1]})`) || new RegExp(`\\bTeam ${m[1]}\\b`).test(badge)) && norm(fact) === norm(m[2])) return null;
  return plain(badge);
}

/** "how good is simply complex", "how strong are the enforcers": a question about one team's quality (the page and
 *  the server's first paint title it by that team). */
export const isQualityQuestion = (q: string) => /^\s*how\s+(?:good|strong)\s+(?:is|are)\b/i.test(q);

/** A Compare: its own kind from the server, or (an older server) a team hit that opens /compare. */
export const isCompare = (h: SearchHit) => (h.kind as string) === "compare" || !!h.href?.startsWith("/compare");

/** "4215 Hypnotic Robotics", "18061 | Simply Complex" (or an older "18061 Simply Complex 18061") → number and name. */
export function teamParts(title: string): { number: string; name: string } | null {
  const m = /^(\d+)\s*\|?\s*(.*?)(?:\s+\1)?$/.exec(title.trim());
  return m ? { number: m[1], name: m[2] } : null;
}

/** Each word's first letter in capitals; never one after an apostrophe ("They're", not "They'Re"), and the small
 *  joining words stay small unless they start it ("Sponsors and School or Organization"). */
const SMALL = new Set(["a", "an", "and", "or", "of", "the", "in", "at", "on", "by", "for", "to", "vs"]);
export const capWords = (s: string) => s.replace(/(?<![\p{L}\p{N}'’])\p{Ll}[\p{L}\p{N}'’]*/gu, (w, at: number) => (at > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));

/** The page's heading: what the results are about and what was asked (never the query as typed). "Team 7149 —
 *  Worlds Appearances", "Hypnotic Robotics (4215) vs Bad Wolf (6980)", "Simply Complex (18061)", "Events in New Jersey". */
/** `aboutTeam`: the query asked about one team ("how good is X"), so its top team names the page even when the
 *  server read the name as a correction. */
export function pageTitle(a: AnswerExtra | undefined, hits: SearchHit[], aboutTeam = false): string {
  const card = a?.card;
  if (card) return card.team ? `Team ${card.team.number} — ${capWords(card.title)}` : card.title;
  const top = hits[0];
  if (top && isCompare(top)) return top.title.split(/\s+vs\.?\s+/i).map((t) => { const p = teamParts(t); return p ? `${p.name} (${p.number})` : t; }).join(" vs ");
  const teamName = () => { const p = teamParts(top.title); return p ? (p.name ? `${p.name} (${p.number})` : `Team ${p.number}`) : null; };
  // "How good is X": the page is about X, whatever else the reading says ("· OPR").
  if (aboutTeam && top?.kind === "team" && a?.step !== "recovery") { const t = teamName(); if (t) return t; }
  const read = readingOf(a);
  if (read && echoesQuery(read)) return foundTitle(hits);
  if (read) return plain(read);
  if (top?.kind === "team" && (a?.step === "deterministic" || !a)) { const t = teamName(); if (t) return t; }
  return "Search results";
}

/** The one badge under the title: how the query was read, in full. The server's reading when it sends one; else
 *  everything it understood ("Team 4215 Hypnotic Robotics · Season 2024–25 · Their high scores without penalties",
 *  "A comparison: … · …"), so no detail is lost by folding those lines into one; else a team or a Compare and what it
 *  opens on ("ENFORCERS (7149) · Worlds appearances"). Never one event's or place's name (a list of events isn't
 *  "showing" its first). */
export function contextBadge(a: AnswerExtra, understood: string[] = []): string | null {
  const label = readingOf(a);
  if (label) return echoesQuery(label) ? null : label;
  const read = understood.map((u) => u.replace(/^Understood:\s*/, "").trim()).filter(Boolean);
  if (read.length) return read.join(" · ");
  const top = a.hits[0];
  if (top && (top.kind === "team" || isCompare(top))) { const s = showingLine(a); if (s) return s.replace(" — ", " · "); }
  return null;
}
