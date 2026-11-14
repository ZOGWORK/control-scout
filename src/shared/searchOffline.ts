// FTC One Search with no signal, from the event packs saved on a device (docs/event-bundle.md, "Search"). The same
// deterministic rules as online, never a guess:
//   1. a search the pack holds (every team's number and name, the event's code and name, "<code> Q12" for each match):
//      the server's own answer, as it gave it;
//   2. two to four of the pack's teams set against each other ("12722 vs 17064 vs 27851"): built from the pack's
//      `search` section by the functions the server builds it with (./searchVersus.ts), the two-team reading by
//      search's own parser (./query/parse.ts);
//   3. anything else: the same parser reads what it asks about, and the answer says it needs data the pack doesn't
//      hold, with what the pack does hold (SearchAnswer.notInPack).
// Pure (the packs are given, newest data first), so it's tested against the server's own answers. The app's side is
// src/lib/offline/search.ts.
import type { NotInPack, SearchAnswer, TeamSummary } from "./api";
import { packLookup, searchPackPath, type EventBundle } from "./eventBundle";
import { versusFromPack, versusNumbers } from "./searchVersus";
import { describe, parseQuery, type ParseContext, type Parsed } from "./query/parse";
import { packParseContext } from "./query/packContext";
import { seasonLabel } from "./format";

export type SearchPack = Pick<EventBundle, "api" | "search" | "event" | "compare" | "manifest">;

/** An answer and the pack it came from (an index into the packs given). */
export interface FromPack<T> { body: T; from: number }

const todayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The whole answer for /api/search?answer=1 from the packs, or null when it isn't one they take (one limited to some
 *  kinds, an empty query) or there are none. `ctx`: the parser's context for these packs (packParseContext). */
export async function searchFromPacks(path: string, packs: SearchPack[], now = Date.now(), ctx: ParseContext = packParseContext(packs, todayOf(now))): Promise<FromPack<SearchAnswer> | null> {
  const url = new URL(path, "http://offline.invalid");
  const q = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (url.searchParams.get("answer") !== "1" || url.searchParams.get("kinds") || !q || !packs.length) return null;
  const limit = Number(url.searchParams.get("limit")) || 0;
  // The season picker and "my team" ask the server for another answer than the pack's: those say what's missing.
  const asked = !url.searchParams.get("season") && !url.searchParams.get("my");
  if (asked) {
    // 1. The server's own answer, kept in the pack.
    for (const [from, pack] of packs.entries()) {
      const got = packLookup(pack.api, searchPackPath(q));
      if (got && "body" in got && got.body && typeof got.body === "object") {
        const body = structuredClone(got.body) as SearchAnswer;
        // The header's short list asks for fewer rows than the page the pack kept: the first ones.
        return { body: limit > 0 && body.hits.length > limit ? { ...body, hits: body.hits.slice(0, limit) } : body, from };
      }
    }
  }
  // 2. The pack's teams side by side.
  const nums = asked ? versusNumbers(q) : null;
  if (nums) {
    const read = nums.length === 2 ? await twoTeamReading(q, ctx) : null;
    for (const [from, pack] of packs.entries()) {
      const a = pack.search ? versusFromPack(q, pack.search, read) : null;
      if (a) return { body: a, from };
    }
  }
  // 3. What it needs that the packs don't hold.
  const p = await parseQuery(q, ctx).catch(() => null);
  return { body: notInPackAnswer(q, p, packs), from: 0 };
}

/** How search's parser reads "A vs B" (its describe, the answer's "read as" line), when it reads a comparison of two
 *  teams as the server does; null otherwise. */
async function twoTeamReading(q: string, ctx: ParseContext): Promise<string[] | null> {
  const p = await parseQuery(q, ctx).catch(() => null);
  return p && p.complete && p.intent === "compare" && p.teams.length === 2 ? describe(p) : null;
}

/** The answer saying the query needs data the packs don't hold: what it's about, as the parser read it, and what the
 *  packs do hold, with the pages of theirs it names. */
export function notInPackAnswer(q: string, p: Parsed | null, packs: SearchPack[]): SearchAnswer {
  const held = new Map<number, number>();
  for (const pack of packs) for (const t of Object.keys(pack.search?.teams ?? {})) if (!held.has(Number(t))) held.set(Number(t), pack.event.event.season);
  const about: string[] = [];
  // Team numbers the packs don't hold (the parser reads a number as a team only when it knows the team).
  const words = q.split(/\s+/);
  for (const w of p?.leftover ?? words) if (/^\d{1,6}$/.test(w) && !held.has(Number(w)) && !about.includes(`team ${w}`)) about.push(`team ${w}`);
  if (p) {
    // A pack is one event, never a whole season: a season named is always more than it holds.
    if (p.time?.kind === "season" && p.time.season != null) about.push(`the ${seasonLabel(p.time.season)} season`);
    else if (p.time?.kind === "ever") about.push("every season");
    else if (p.time?.kind === "window") about.push(p.time.label.replace(/^in /, ""));
    if (p.worlds) about.push("Worlds");
    else if (p.states) about.push("state championships");
    if (p.place) about.push(p.place.name);
    if (p.event) about.push(`the event "${p.event.typed}"`);
    // A question about no team, event or place: every team's data.
    if (!about.length && p.intent && !p.teams.length) about.push("all teams worldwide");
  }
  const links: NotInPack["links"] = [];
  for (const t of p?.teams ?? []) {
    const season = held.get(t.number);
    if (season != null && !links.some((l) => l.href.startsWith(`/teams/${t.number}?`))) links.push({ label: `${t.number}${t.name ? ` ${t.name}` : ""}`, href: `/teams/${t.number}?season=${season}` });
  }
  // A match the query names by its label ("Q12"): the pack's.
  for (const pack of packs) {
    const ev = pack.event.event;
    for (const w of words) {
      const m = pack.event.matches.find((x) => x.label.toLowerCase() === w.toLowerCase());
      if (m && !links.some((l) => l.href.endsWith(`match=${m.key}`))) links.push({ label: `${m.label} at ${ev.name}`, href: `/events/${ev.season}/${encodeURIComponent(ev.code)}?match=${m.key}` });
    }
  }
  const notInPack: NotInPack = {
    about,
    packs: packs.map((x) => ({ season: x.manifest.season, code: x.manifest.code, name: x.manifest.name, teams: Object.keys(x.compare ?? {}).length || x.event.field.length, matches: x.event.matches.length, dataAsOf: x.manifest.dataAsOf ?? x.manifest.builtAt })),
    links,
  };
  return { q, hits: [], pages: [], step: "recovery", weak: false, notInPack, understood: { kind: "names", label: `Not in your downloaded pack: "${q}"` } };
}

/** /api/teams-summary from the packs: each team's summary as the server gave it for the season (the pack keeps one
 *  team a path), in the order asked; teams no pack holds are left out (their cards show no numbers). Null when no
 *  pack holds any of them. */
export function teamSummariesFromPacks(path: string, packs: SearchPack[]): FromPack<{ season: number; teams: TeamSummary[] }> | null {
  const url = new URL(path, "http://offline.invalid");
  const season = Number(url.searchParams.get("season"));
  const teams = (url.searchParams.get("teams") ?? "").split(",").filter((t) => /^\d{1,6}$/.test(t));
  if (!season || !teams.length) return null;
  const out: TeamSummary[] = [];
  let from = -1;
  for (const t of teams) {
    for (const [i, pack] of packs.entries()) {
      const got = packLookup(pack.api, `/api/teams-summary?season=${season}&teams=${t}`);
      const one = got && "body" in got ? (got.body as { teams?: TeamSummary[] }).teams?.[0] : undefined;
      if (one) { out.push(structuredClone(one)); if (from < 0) from = i; break; }
    }
  }
  return from >= 0 ? { body: { season, teams: out }, from } : null;
}
