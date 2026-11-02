// The /search page's heading and what makes a hit a Compare: shared by the app (src/pages/SearchPage.tsx) and the
// server's first paint of the same page (server/seoMeta.ts searchMeta), so both title it the same way.
import type { SearchAnswer, SearchHit } from "./api.js";

/** Fields a newer server adds to an answer (the search-engine work); read defensively. */
export type AnswerExtra = SearchAnswer & { interpreted?: string; fuzzyWord?: string; fallback?: { label: string; hits: SearchHit[] } };

/** A Compare: its own kind from the server, or (an older server) a team hit that opens /compare. */
export const isCompare = (h: SearchHit) => (h.kind as string) === "compare" || !!h.href?.startsWith("/compare");

/** "4215 Hypnotic Robotics", "18061 | Simply Complex" (or an older "18061 Simply Complex 18061") → number and name. */
export function teamParts(title: string): { number: string; name: string } | null {
  const m = /^(\d+)\s*\|?\s*(.*?)(?:\s+\1)?$/.exec(title.trim());
  return m ? { number: m[1], name: m[2] } : null;
}

const capWords = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The page's heading: what the results are about and what was asked (never the query as typed). "Team 7149 —
 *  Worlds Appearances", "Hypnotic Robotics (4215) vs Bad Wolf (6980)", "Simply Complex (18061)", "Events in New Jersey". */
export function pageTitle(a: AnswerExtra | undefined, hits: SearchHit[]): string {
  const card = a?.card;
  if (card) return card.team ? `Team ${card.team.number} — ${capWords(card.title)}` : card.title;
  const top = hits[0];
  if (top && isCompare(top)) return top.title.split(/\s+vs\.?\s+/i).map((t) => { const p = teamParts(t); return p ? `${p.name} (${p.number})` : t; }).join(" vs ");
  if (a?.interpreted) return a.interpreted;
  if (top?.kind === "team" && (a?.step === "deterministic" || !a)) { const p = teamParts(top.title); if (p) return p.name ? `${p.name} (${p.number})` : `Team ${p.number}`; }
  return "Search results";
}
