// The names the parser recognises, read from the stored data (docs/search-pipeline.md, "Entities"): every team number
// and name, every place a team or event is in (a region, a country, a town), held in memory and rebuilt with the
// search index. Nothing here is typed by hand: a new team, town or country is known as soon as it's synced.
import { all, kvGet } from "../../db.js";
import { registerCache } from "../../caches.js";
import { countryOf } from "../../../src/shared/countries.js";
import { regionOf, regionPartOf } from "../../../src/shared/searchEventQuery.js";
import { edits, nearRegion } from "../../../src/shared/regions.js";

export interface TeamName { number: number; name: string | null; country: string | null; state: string | null; city: string | null; lastPlayed: number | null }
/** A place: a region (a state or province), a whole country, or a town (with the region it's in). */
/** `part`: the words when they named part of a region ("north jersey"), which is read as the whole region. */
export interface Place { kind: "region" | "country" | "city"; country: string; state: string | null; city: string | null; name: string; part?: string }

export interface Names {
  team(n: number): TeamName | undefined;
  /** Teams whose whole name is these words (folded). */
  teamsNamed(words: string): TeamName[];
  /** The one team whose name these words nearly spell ("the robcats": The Robocats): one letter off in a name of up
   *  to eight letters, two in a longer one, and no other name as close. Null when none is, or two are. */
  nearTeam(words: string): TeamName | null;
  /** The place these words name, or null. */
  place(words: string, typed?: string): Place | null;
  /** The longest team name, in words (the parser looks no further). */
  longest: number;
  /** Whether a word starts the way some word of an event's name or code does (its first three letters): words that
   *  share no start with any event can't name one, so the event search is skipped for them. */
  eventStem(word: string): boolean;
}

/** Lower case, accents and punctuation dropped, single spaces: how names are compared. */
export const fold = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

interface Row { number: number; name: string | null; city: string | null; state: string | null; country: string | null; lastPlayed?: number | null }

/** The index for these rows (tests build one from fixtures). */
export function buildNames(teams: Row[], places: { city: string | null; state: string | null; country: string | null; name?: string | null; code?: string | null }[]): Names {
  const byNumber = new Map<number, TeamName>(), byName = new Map<string, TeamName[]>();
  let longest = 1;
  /** Folded names by length, for the near-miss look-up. */
  const byLength = new Map<number, string[]>();
  for (const t of teams) {
    const tn: TeamName = { number: Number(t.number), name: t.name, city: t.city, state: t.state, country: t.country, lastPlayed: t.lastPlayed == null ? null : Number(t.lastPlayed) };
    byNumber.set(tn.number, tn);
    const k = fold(t.name ?? "");
    if (!k) continue;
    if (!byName.has(k)) (byLength.get(k.length) ?? byLength.set(k.length, []).get(k.length)!).push(k);
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(tn);
    longest = Math.max(longest, k.split(" ").length);
  }
  // A town is known with the region (or country) it's in; the same town name in two regions stays ambiguous.
  const towns = new Map<string, Map<string, { country: string; state: string | null; city: string }>>();
  for (const p of [...teams, ...places]) {
    const k = fold(p.city ?? "");
    if (!k || !p.country) continue;
    const where = `${p.country}:${p.state ?? ""}`;
    (towns.get(k) ?? towns.set(k, new Map()).get(k)!).set(where, { country: p.country, state: p.state, city: p.city! });
  }
  const stems = new Set<string>();
  for (const p of places) for (const w of fold(`${p.name ?? ""} ${p.code ?? ""}`).split(" ")) if (w.length >= 3) stems.add(w.slice(0, 3));
  const countries = new Map<string, string>();
  for (const p of [...teams, ...places]) if (p.country) countries.set(fold(p.country), p.country);
  return {
    team: (n) => byNumber.get(n),
    teamsNamed: (w) => byName.get(fold(w)) ?? [],
    nearTeam(w) {
      const f = fold(w);
      if (f.replace(/\s/g, "").length < 5 || byName.has(f)) return null;
      const most = f.length <= 8 ? 1 : 2;
      let best = most + 1, found: string[] = [];
      for (let len = f.length - most; len <= f.length + most; len++) {
        for (const k of byLength.get(len) ?? []) {
          // Same first letter, as a near-miss of a name starts as the name does.
          if (k[0] !== f[0]) continue;
          const d = edits(f, k);
          if (d < best) { best = d; found = [k]; } else if (d === best) found.push(k);
        }
      }
      const teams = found.length === 1 ? byName.get(found[0]) ?? [] : [];
      return teams.length === 1 ? teams[0] : null;
    },
    longest,
    eventStem: (w) => stems.has(fold(w).slice(0, 3)),
    place(w, typed) {
      const f = fold(w);
      if (!f) return null;
      // A region by its name or code (a two-letter code that's also a word only as typed in capitals).
      const r = regionOf((typed ?? w).split(/\s+/)) ?? (f.length >= 5 ? nearRegion(f) : null);
      if (r) return { kind: "region", country: r.country, state: r.state, city: null, name: r.name };
      const half = regionPartOf(f.split(" "));
      if (half) return { kind: "region", country: half.region.country, state: half.region.state, city: null, name: half.region.name, part: half.part };
      // A country as the data stores it ("Romania", "USA") or by another of its names ("Turkey", "UK").
      const stored = countries.get(f) ?? [...countries.values()].find((c) => countryOf(c) && countryOf(c) === countryOf(w));
      if (stored && f.length >= 3) return { kind: "country", country: stored, state: null, city: null, name: countryOf(stored)?.name ?? stored };
      const town = towns.get(f);
      if (town && town.size === 1 && f.length >= 3) {
        const t = [...town.values()][0];
        return { kind: "city", country: t.country, state: t.state, city: t.city, name: t.city };
      }
      return null;
    },
  };
}

let cache: { version: string; names: Promise<Names> } | null = null;

/** The index from the database, rebuilt when the search index is. */
export async function names(): Promise<Names> {
  const version = (await kvGet<string>("search:version")) ?? "0";
  if (cache?.version === version) return cache.names;
  const n = Promise.all([
    all<Row>(`SELECT t.number, t.name, t.city, t.state, t.country, p.last lastPlayed FROM teams t
      LEFT JOIN (SELECT team, MAX(season) last FROM team_event_stats WHERE matches > 0 GROUP BY team) p ON p.team = t.number`),
    all<{ city: string | null; state: string | null; country: string | null; name: string | null; code: string | null }>("SELECT city, state, country, name, code FROM events"),
  ]).then(([teams, places]) => buildNames(teams, places));
  cache = { version, names: n };
  n.catch(() => { if (cache?.names === n) cache = null; });
  return n;
}
registerCache("Search pipeline names", () => { cache = null; });
