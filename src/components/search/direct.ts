// Where Enter (or the magnifier) goes for a query that names one thing exactly: a team number ("6980", "team 6980",
// "ftc 6980"), one team's whole name ("bad wolf"), or an event code ("USNJNEM2"). Straight to that page, never a
// results page with one card on it. Read off the server's own answer for the query (the one the dropdown shows), so
// the box guesses nothing: one deterministic team hit that is the team typed, or an event whose code was typed.
// Anything else (a question, a place, a versus, a topic like "6980 record", two teams named alike) opens /search.
import type { SearchAnswer, SearchHit } from "../../shared/api";
import { teamNameOf } from "../../shared/teamTitle";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function directHit(a: SearchAnswer | undefined, query: string): SearchHit | null {
  if (!a || a.step !== "deterministic" || a.card || !a.hits.length) return null;
  const q = norm(query);
  const top = a.hits[0];
  if (top.kind === "event") return top.match !== "fuzzy" && norm(top.ref.split(":")[1] ?? "") === q ? top : null;
  // One team, as itself: not a topic, an event pick, a feature (Compare) or a set of names.
  if (a.hits.length !== 1 || top.kind !== "team" || a.understood?.kind === "names") return null;
  if (top.href || top.section || top.atEvent || top.facts?.length || top.events?.length) return null;
  const num = /^(?:(?:team|ftc)\s*)?#?(\d{1,6})$/.exec(q);
  if (num) return num[1] === top.ref ? top : null;
  return top.match !== "fuzzy" && norm(teamNameOf(top.title)) === q ? top : null;
}
