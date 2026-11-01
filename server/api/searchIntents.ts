// What a query asks for besides a name (docs/search.md): a season ("last year's DECODE season"), a region ("state of
// New Jersey"), a ranking, or something no view answers yet ("reputation", robot specs). Parsed by fixed rules,
// so it works offline of any model, and every number shown still comes from the stored data:
//   - Understood, and a view answers it: that view ("4215 ranking last season in New Jersey" → 4215 in New Jersey's
//     2025–26 rankings, with its place there, and its 2025–26 page).
//   - Understood, but no view answers it: the closest real result and a plain note on what's missing (step
//     "closest"). Never a stand-in number: there is no reputation score, so none is shown.
//   - Not understood: search goes on as before (and ends in the recovery state when nothing matches).
// Each understood intent is counted, as a pattern with teams, seasons and regions replaced by placeholders, in
// search_intents (migration 65): the build list of what people ask search for. Counts and a day only.
import type { SearchAnswer, SearchHit, SearchIntentNote } from "../../src/shared/api.js";
import { findRegions, type Region } from "../../src/shared/regions.js";
import { seasonLabel } from "../../src/shared/format.js";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASONS } from "../data/seasons.js";
import { all, run } from "../db.js";
import { defaultRankingsSeason, regionPlace } from "./rankings.js";
import { teamSeason } from "./searchFacts.js";

/** Things people ask search for that no view answers yet: the note says so, and the closest real result stands. */
const MISSING: { id: string; words: RegExp; label: string; note: (compare: boolean) => string }[] = [
  {
    id: "reputation", label: "reputation",
    words: /\b(?:reputation|reputable|respected|prestige|prestigious|famous|popularity|popular|well[- ]known|legacy)\b/i,
    note: (compare) => `There's no reputation score on Control Scout, and none is made up. ${compare ? "Their records, event histories and awards are side by side here." : "Their record, events and awards are on the team page."}`,
  },
  {
    id: "robot-specs", label: "robot specs",
    words: /\b(?:robot specs?|specs|specifications|drive ?train|robot weight|weight|cad|robot design|mechanisms?|intake)\b/i,
    note: () => "Robot specs (drivetrain, weight, design) aren't tracked yet.",
  },
  {
    id: "roster", label: "team members",
    words: /\b(?:roster|members|students|mentors?|coach(?:es)?|captain|who is on)\b/i,
    note: () => "Team members aren't listed: FIRST doesn't publish rosters.",
  },
  {
    id: "budget", label: "budget",
    words: /\b(?:budget|funding|money|cost|costs|spend|spent)\b/i,
    note: () => "Team budgets and costs aren't tracked.",
  },
  {
    id: "social", label: "social media",
    words: /\b(?:instagram|tiktok|twitter|social media|socials|youtube channel)\b/i,
    note: () => "Teams' social media accounts aren't listed yet.",
  },
];

const RANKING = /\b(?:rank|ranks|ranking|rankings|ranked|standing|standings)\b/i;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export interface ParsedIntent {
  season: number | null;
  /** The game, when it was named ("DECODE"). */
  game: string | null;
  region: Region | null;
  ranking: boolean;
  missing: (typeof MISSING)[number] | null;
  /** The query without the words read here: what names the team(s) or event. */
  core: string;
  /** The region came from a bare name, with no "in"/"state of" ("New Jersey Championship rankings"): it may be part
   *  of an event's name, which the caller checks (`withoutRanking`: the query without the ranking words). */
  regionBare: boolean;
  withoutRanking: string;
}

/** The season a query names: "last year's" / "last season", "this season", or a game ("DECODE season", "in INTO THE DEEP"). */
function seasonIn(q: string): { season: number; game: string | null; rest: string } | null {
  let rest = q, season: number | null = null, game: string | null = null;
  const rel = /\b(?:last|previous|past)\s+(?:year|season)(?:'?s)?\b|\b(?:this|current)\s+(?:year|season)(?:'?s)?\b/i.exec(rest);
  if (rel) { season = /^(?:last|previous|past)/i.test(rel[0]) ? CURRENT_SEASON - 1 : CURRENT_SEASON; rest = rest.replace(rel[0], " "); }
  for (const s of SEASONS) {
    // A game's name alone could be a team's ("Decode Robotics"): it's a season only beside "season", or after in/during/the/'s.
    const name = s.game.toLowerCase().split(" ").map((w) => w.replace(/(stage|play)$/, " ?$1")).join("\\s*");
    const m = new RegExp(`(?:\\b(?:in|during|the|of)\\s+|'s\\s+|^|\\s)(${name})(?:\\s+season)?\\b`, "i").exec(rest);
    if (!m) continue;
    const named = new RegExp(`\\b${name}\\s+season\\b|(?:\\b(?:in|during|the|of)\\s+|'s\\s+)${name}\\b`, "i").test(rest) || season != null;
    if (!named) continue;
    game = s.game; season = s.season; rest = rest.replace(m[0], " ");
    break;
  }
  if (season == null) return null;
  rest = rest.replace(/\b(?:season|year)'?s?\b/gi, " ");
  return { season, game, rest: squash(rest) };
}

/** The region a query names: "state of New Jersey", "in Texas", "from NJ", "New Jersey state", or (with a ranking
 *  word) a region's full name anywhere. Only exact names: "new" is no region. */
function regionIn(q: string, ranking: boolean): { region: Region; rest: string; bare: boolean } | null {
  const exact = (cand: string): Region | null => {
    const c = cand.trim();
    if (!c) return null;
    return findRegions(c).find((r) => fold(r.name) === fold(c) || (c.length === 2 && /^[A-Z]{2}$/.test(c) && r.state === c)) ?? null;
  };
  const tokens = q.split(" ");
  for (let i = 0; i < tokens.length; i++) {
    const marker = /^(?:in|from|across|within|around)$/i.test(tokens[i]) ? 1 : /^(?:state|province)$/i.test(tokens[i]) && /^of$/i.test(tokens[i + 1] ?? "") ? 2 : 0;
    if (!marker) continue;
    for (let n = 4; n >= 1; n--) {
      const cand = tokens.slice(i + marker, i + marker + n).join(" ");
      const r = exact(cand);
      if (r) return { region: r, rest: squash([...tokens.slice(0, i), ...tokens.slice(i + marker + n)].join(" ")), bare: false };
    }
  }
  for (let i = 0; i < tokens.length; i++) for (let n = 3; n >= 1; n--) {
    const cand = tokens.slice(i, i + n).join(" ");
    const stateAfter = /^state$/i.test(tokens[i + n] ?? "");
    if ((stateAfter || (ranking && cand.length >= 4)) && exact(cand)) {
      return { region: exact(cand)!, rest: squash([...tokens.slice(0, i), ...tokens.slice(i + n + (stateAfter ? 1 : 0))].join(" ")), bare: !stateAfter };
    }
  }
  return null;
}

/** The parts of `q` read here; null when it asks for none of them (search then goes on as before). */
export function parseIntent(q: string): ParsedIntent | null {
  const missing = MISSING.find((m) => m.words.test(q)) ?? null;
  let rest = missing ? squash(q.replace(new RegExp(missing.words.source, "gi"), " ")) : q;
  const s = seasonIn(rest);
  if (s) rest = s.rest;
  const ranking = RANKING.test(rest);
  const r = regionIn(rest, ranking);
  if (r) rest = r.rest;
  // A typed year ("hypnotic 2025-26") is search's own rule (searchAnswer's seasonOf); one in words ("last season",
  // "DECODE season") is read here and passed on the same way.
  if (!missing && !r && !s) return null;
  if (ranking) rest = squash(rest.replace(new RegExp(RANKING.source, "gi"), " "));
  rest = squash(rest.replace(/\b(?:at|in|of|for|the|on|state|during|and|with|vs\.?|versus)$/i, "").replace(/^(?:at|in|of|for|the|on)\b/i, ""));
  return { season: s?.season ?? null, game: s?.game ?? null, region: r?.region ?? null, ranking, missing, core: rest, regionBare: !!r?.bare, withoutRanking: squash(q.replace(new RegExp(RANKING.source, "gi"), " ")) };
}

/** The answer for a parsed intent: `base` is search's answer for the core (the team, the teams, or nothing). */
export async function intentAnswer(q: string, it: ParsedIntent, base: SearchAnswer): Promise<SearchAnswer | null> {
  const compare = !!base.hits[0]?.href?.startsWith("/compare");
  const team = !compare && base.step !== "recovery" && base.hits[0]?.kind === "team" ? base.hits[0] : null;
  const season = it.season ?? null;
  const understood: string[] = [];
  if (compare) understood.push(`A comparison: ${base.hits[0].title}`);
  else if (team) understood.push(`Team ${team.title}`);
  if (season != null) understood.push(`Season ${seasonLabel(season)}${it.game ? ` (${it.game})` : ""}`);
  if (it.region) understood.push(`Region: ${it.region.name}`);
  if (it.ranking) understood.push("Rankings");
  if (it.missing) understood.push(`Their ${it.missing.label}`);

  const parts = [compare ? base.hits.slice(1).map(() => "[team]").join(" vs ") : team ? "[team]" : "", it.ranking ? "ranking" : "", it.missing?.label ?? "", season != null ? "[season]" : "", it.region ? "[region]" : ""].filter(Boolean);
  const kind = [compare ? "compare" : "", season != null ? "season" : "", it.region ? "region" : "", it.ranking ? "ranking" : "", it.missing?.id ?? ""].filter(Boolean).join("-");

  const hits: SearchHit[] = [];
  let gap: string | undefined;
  if (it.missing) gap = it.missing.note(compare);

  // Rankings in a region: the region's rankings page (a real view), with the team's place there.
  if (it.ranking && it.region) {
    // No season named: the team's newest season with stats, else the rankings page's own default (its newest ranked season).
    const s = season ?? (team ? (await teamSeason(Number(team.ref))).season : null) ?? (await defaultRankingsSeason());
    const key = it.region.key;
    const view: SearchHit = {
      kind: "place", ref: key, season: s, href: `/rankings?season=${s}&region=${encodeURIComponent(key)}`,
      title: `${it.region.name} rankings, ${seasonLabel(s)}`, subtitle: `Every ranked team in ${it.region.name}`,
    };
    if (!PREDICT_SEASONS.includes(s)) {
      gap ??= `Rankings start in ${seasonLabel(PREDICT_SEASONS[0])}: ${seasonLabel(s)} has none.`;
    } else if (team) {
      const place = await regionPlace(s, Number(team.ref), { country: it.region.country, state: it.region.state });
      if (place) view.facts = [{ label: `${it.region.name} rank`, value: `#${place.rank} of ${place.of.toLocaleString("en-US")}` }, { label: "World rank", value: `#${place.world.toLocaleString("en-US")}` }, { label: "Season", value: seasonLabel(s) }];
      else gap ??= `${team.title} isn't ranked in ${it.region.name} for ${seasonLabel(s)}.`;
    }
    // The team's page on that season first (its events, ranks and records), then the region's rankings.
    // (A season named in the query is already on the team's subtitle and link: searchAnswer's own season rule.)
    if (team) hits.push({ ...team, linkSeason: s, section: "ranking", subtitle: season != null ? team.subtitle : [seasonLabel(s), team.subtitle].filter(Boolean).join(" · "), facts: undefined, events: undefined });
    hits.push(view);
  } else if (compare || team) {
    const top = base.hits[0];
    // The season, when one was named, is already in the link (Compare's ?season=, a team's ?season=) and facts.
    hits.push(top);
  }
  if (!hits.length) return null;
  const rest = base.hits.filter((h) => !hits.some((x) => x.kind === h.kind && x.ref === h.ref));
  const intent: SearchIntentNote = { kind, pattern: parts.join(" "), met: !gap, understood, ...(gap ? { gap } : {}) };
  return { q, hits: [...hits, ...rest], pages: base.pages, step: gap ? "closest" : "deterministic", weak: false, intent };
}

/** Count one intent (aggregate: its kind and pattern, how often, the day last seen). */
export async function recordIntent(i: SearchIntentNote | undefined, now = new Date()): Promise<void> {
  if (!i?.kind || !i.pattern) return;
  await run(`INSERT INTO search_intents (kind, pattern, met, count, last_seen) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (kind, pattern) DO UPDATE SET count = count + 1, met = excluded.met, last_seen = excluded.last_seen`,
  [i.kind.slice(0, 80), i.pattern.slice(0, 120), i.met ? 1 : 0, now.toISOString().slice(0, 10)]);
}

/** The most-asked intents, unmet first by default: what search shows people want built. */
export async function topIntents(limit = 20, unmetOnly = true): Promise<{ kind: string; pattern: string; met: boolean; count: number; lastSeen: string }[]> {
  const rows = await all<{ kind: string; pattern: string; met: number; count: number; last_seen: string }>(
    `SELECT kind, pattern, met, count, last_seen FROM search_intents ${unmetOnly ? "WHERE met = 0" : ""} ORDER BY count DESC, last_seen DESC, pattern LIMIT ?`, [limit]);
  return rows.map((r) => ({ kind: r.kind, pattern: r.pattern, met: Number(r.met) === 1, count: Number(r.count), lastSeen: r.last_seen }));
}

