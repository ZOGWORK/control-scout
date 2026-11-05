// Where Enter (or the magnifier) goes for a query that names one thing exactly: a team number ("6980", "team 6980",
// "ftc 6980"), one team's whole name ("bad wolf"), or an event code ("USNJNEM2"). Straight to that page, never a
// results page with one card on it. Read off the server's own answer for the query (the one the dropdown shows), so
// the box guesses nothing: one deterministic team hit that is the team typed, or an event whose code was typed.
// Anything else (a question, a place, a versus, a topic like "6980 record", two teams named alike) opens /search.
// A team goes there by way of /search: the results page's own answer may carry the team's highlights (its standout
// matches, server/api/answers/highlights.ts), and then the page stays; with none, it goes on to the team's page.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchAnswer, SearchHit } from "../../shared/api";
import { hitHref } from "../../shared/search";
import { teamNameOf } from "../../shared/teamTitle";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function directHit(a: SearchAnswer | undefined, query: string): SearchHit | null {
  if (!a || a.step !== "deterministic" || a.card || a.stat || !a.hits.length) return null;
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

// Enter never waits on Home (or any page) for the answer: a box whose answer isn't in yet opens /search at once and
// marks the query here; /search, once its own answer for that query is in, swaps itself for the one page the query
// names (replace: Back returns to where it was typed, never to a results page that only redirected). The page that
// lands takes the mark as its own at once, so it belongs to that one visit: left before its answer, it's gone, and a
// later visit to the same /search link (a link, "See all results") shows the results. Unclaimed, it lapses soon.
const MARK_MS = 30_000;
let marked: { q: string; at: number } | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const f of listeners) f(); };
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
const markedNow = () => marked;

/** A box sent this query to /search before its answer was in: /search may open the one page it names. */
export function markDirect(query: string) { marked = { q: norm(query), at: Date.now() }; notify(); }

/** /search's side (src/pages/SearchPage.tsx): a new query is asked at once (it was submitted, not typed: no typing
 *  pause), and a query marked by a box goes on to the one page it names once the page's own answer for it is in
 *  (`live`: answered by this page's request, never the first paint's hits it may open with). True while that's
 *  pending: the page keeps its loading screen rather than flash results it may leave. */
export function useSubmittedSearch(query: string, s: { answer: SearchAnswer | undefined; live: boolean; error: string | null; searchNow: () => void }) {
  const { answer, live, error, searchNow } = s;
  const nav = useNavigate();
  const mark = useSyncExternalStore(subscribe, markedNow, () => null);
  const q = norm(query);
  const [claim, setClaim] = useState<string | null>(null);
  useEffect(() => { searchNow(); }, [searchNow]);
  useEffect(() => {
    if (!mark) return;
    if (Date.now() - mark.at > MARK_MS) { marked = null; return; }
    if (mark.q === q) { marked = null; setClaim(q); }
  }, [mark, q]);
  const mine = claim !== null && claim === q;
  useEffect(() => {
    if (!mine || !(live || error)) return;
    setClaim(null);
    const d = live ? directHit(answer, query) : null;
    if (d) nav(hitHref(d), { replace: true });
  }, [mine, live, error, answer, query, nav]);
  return mine && !error && (!live || !!directHit(answer, query));
}
