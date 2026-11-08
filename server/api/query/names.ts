// The names the parser recognises, read from the stored data (docs/search-pipeline.md, "Entities"): every team number
// and name, every place a team or event is in (a region, a country, a town), held in memory and rebuilt with the
// search index. Nothing here is typed by hand: a new team, town or country is known as soon as it's synced.
import { all, kvGet } from "../../db.js";
import { registerCache } from "../../caches.js";
import { countryOf, countryOfDemonym } from "../../../src/shared/countries.js";
import { regionOf, regionPartOf } from "../../../src/shared/searchEventQuery.js";
import { edits, nearRegion } from "../../../src/shared/regions.js";
import { joinThousands } from "../../../src/shared/fuzzy.js";
import { eventInitialisms } from "./initialisms.js";
import { LEXICON } from "./lexicon.js";

export interface TeamName { number: number; name: string | null; country: string | null; state: string | null; city: string | null; lastPlayed: number | null }
/** A place: a region (a state or province), a whole country, or a town (with the region it's in). */
/** `part`: the words when they named part of a region ("north jersey"), which is read as the whole region. */
export interface Place { kind: "region" | "country" | "city"; country: string; state: string | null; city: string | null; name: string; part?: string }

export interface Names {
  team(n: number): TeamName | undefined;
  /** Teams whose whole name is these words (folded). */
  teamsNamed(words: string): TeamName[];
  /** Teams these words call by their name's own part, when no team's whole name is them: the name without the words
   *  around it that only say it is a team ("calamari" for "Team Calamari", "revamped" for "RevAmped Robotics"), its
   *  words typed apart ("rev amped") or its last word made plural ("litbot juniors"). */
  teamsCalled(words: string): TeamName[];
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
  /** The codes of the events one word is the initialism of ("mti", "fr": ./initialisms.ts), looked up whole, so a
   *  two-letter one needs no search; none when it's no event's. */
  initialism(word: string): string[];
}

/** Lower case, accents and punctuation dropped, single spaces: how names are compared. */
export const fold = (s: string): string => joinThousands(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Initials written with dots joined into the word they spell: "I.C.E. Robotics" → "ICE Robotics". */
export const joinDotted = (s: string): string => s.replace(/(?<![\p{L}\p{N}])(?:\p{L}\.){2,}(?:\p{L}(?![\p{L}\p{N}]))?/gu, (m) => m.replace(/\./g, ""));

interface Row { number: number; name: string | null; city: string | null; state: string | null; country: string | null; lastPlayed?: number | null }

/** The words around a name that only say it is a team ("Team …", "… Robotics", "The …"): the lexicon's filler and its
 *  word for a team, and "robotics", the word most teams' names end with. */
const TEAM_WORDS = new Set(["robotics", ...LEXICON.filter((e) => e.words.length === 1 && e.syms.every((x) => x.k === "filler" || (x.k === "thing" && x.v === "team"))).map((e) => e.words[0])]);
/** A name's own part: its words without those around them, or null when nothing distinctive is left (four letters
 *  at least, not a number, not a word the lexicon reads). */
function corePart(k: string): string | null {
  const ws = k.split(" ");
  let a = 0, b = ws.length;
  while (a < b && TEAM_WORDS.has(ws[a])) a++;
  while (b > a && TEAM_WORDS.has(ws[b - 1])) b--;
  const core = ws.slice(a, b).join(" ");
  if (core === k || core.replace(/\s/g, "").length < 4 || /^\d+$/.test(core) || LEXICON.some((e) => e.words.join(" ") === core)) return null;
  return core;
}

/** The index for these rows (tests build one from fixtures). */
export function buildNames(teams: Row[], places: { city: string | null; state: string | null; country: string | null; name?: string | null; code?: string | null }[]): Names {
  const byNumber = new Map<number, TeamName>(), byName = new Map<string, TeamName[]>();
  let longest = 1;
  /** Folded names by length, for the near-miss look-up. */
  const byLength = new Map<number, string[]>(), lengthed = new Set<string>();
  for (const t of teams) {
    const tn: TeamName = { number: Number(t.number), name: t.name, city: t.city, state: t.state, country: t.country, lastPlayed: t.lastPlayed == null ? null : Number(t.lastPlayed) };
    byNumber.set(tn.number, tn);
    const k = fold(t.name ?? "");
    if (!k) continue;
    // byLength holds stored names only, tracked apart from byName (which holds the names as typed too): an alias
    // read first must never keep another team's own name out of the near-miss look-up.
    if (!lengthed.has(k)) { lengthed.add(k); (byLength.get(k.length) ?? byLength.set(k.length, []).get(k.length)!).push(k); }
    (byName.get(k) ?? byName.set(k, []).get(k)!).push(tn);
    longest = Math.max(longest, k.split(" ").length);
    // The name as a query reads it, its possessive "'s" dropped ("The King's School" → "the king school"), too. And
    // initials written with dots as the word they spell ("I.C.E. Robotics" is "ice robotics"), possessive dropped or not.
    const plain = (t.name ?? "").replace(/(?<=[\p{L}\p{N}])['’]s\b/giu, "");
    for (const said of [fold(plain), fold(joinDotted(t.name ?? "")), fold(joinDotted(plain))]) {
      if (said && said !== k && !byName.get(said)?.includes(tn)) (byName.get(said) ?? byName.set(said, []).get(said)!).push(tn);
    }
    // The dotted name as its word is a name people type, so a near miss of it is looked up too ("ice robotcs").
    const word = fold(joinDotted(t.name ?? ""));
    if (word !== k && !lengthed.has(word)) { lengthed.add(word); (byLength.get(word.length) ?? byLength.set(word.length, []).get(word.length)!).push(word); }
  }
  // Each name's own part, and each name and part with its spaces taken out ("rev amped" is "RevAmped").
  const byCore = new Map<string, TeamName[]>(), byJoined = new Map<string, TeamName[]>();
  const put = (m: Map<string, TeamName[]>, k: string, t: TeamName) => { if (!m.get(k)?.includes(t)) (m.get(k) ?? m.set(k, []).get(k)!).push(t); };
  for (const [k, ts] of byName) {
    const core = corePart(k);
    for (const t of ts) {
      if (core) put(byCore, core, t);
      put(byJoined, k.replace(/ /g, ""), t);
      if (core) put(byJoined, core.replace(/ /g, ""), t);
    }
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
  // An event's initialisms too ("mti"), which the search index holds with its name (./initialisms.ts).
  const initials = new Map<string, Set<string>>();
  for (const p of places) {
    for (const w of [...fold(`${p.name ?? ""} ${p.code ?? ""}`).split(" "), ...eventInitialisms(p.name ?? "")]) if (w.length >= 3) stems.add(w.slice(0, 3));
    if (p.code) for (const i of eventInitialisms(p.name ?? "")) (initials.get(i) ?? initials.set(i, new Set()).get(i)!).add(p.code);
  }
  const countries = new Map<string, string>();
  for (const p of [...teams, ...places]) if (p.country) countries.set(fold(p.country), p.country);
  return {
    team: (n) => byNumber.get(n),
    teamsNamed: (w) => byName.get(fold(w)) ?? [],
    teamsCalled(w) {
      const f = fold(w);
      if (!f || byName.has(f)) return [];
      const plain = f.replace(/(?<=\p{L}{4})s$/u, "");
      return byCore.get(f) ?? (plain !== f ? byName.get(plain) ?? byCore.get(plain) : undefined) ?? (f.includes(" ") ? byJoined.get(f.replace(/ /g, "")) : undefined) ?? [];
    },
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
          if (d > most) continue;
          if (d < best) { best = d; found = [k]; } else if (d === best) found.push(k);
        }
      }
      // Spellings that tie may be one team's ("a b c robotics" and "abc robotics"): one team is the answer, two never.
      const teams = [...new Set(found.flatMap((k) => byName.get(k) ?? []))];
      return teams.length === 1 ? teams[0] : null;
    },
    longest,
    eventStem: (w) => stems.has(fold(w).slice(0, 3)),
    initialism: (w) => [...(initials.get(fold(w)) ?? [])],
    place(w, typed) {
      const f = fold(w);
      if (!f) return null;
      // A region by its name or code (a two-letter code that's also a word only as typed in capitals).
      const r = regionOf((typed ?? w).split(/\s+/)) ?? (f.length >= 5 ? nearRegion(f) : null);
      if (r) return { kind: "region", country: r.country, state: r.state, city: null, name: r.name };
      // A country as the data stores it ("Romania", "USA") or by another of its names ("Turkey", "UK").
      // Or by its people's word ("Romanian teams").
      const people = countryOfDemonym(f);
      const stored = countries.get(f) ?? [...countries.values()].find((c) => countryOf(c) && (countryOf(c) === countryOf(w) || (!!people && countryOf(c) === people)));
      if (stored && f.length >= 3) return { kind: "country", country: stored, state: null, city: null, name: countryOf(stored)?.name ?? stored };
      const town = towns.get(f);
      if (town && town.size === 1 && f.length >= 3) {
        const t = [...town.values()][0];
        return { kind: "city", country: t.country, state: t.state, city: t.city, name: t.city };
      }
      // A part of a region ("north jersey", "northern IN"), as typed so a code in capitals still reads: after a stored
      // town of that name ("East Brunswick" is a town, never New Brunswick).
      const half = regionPartOf((typed ?? w).split(/\s+/));
      if (half) return { kind: "region", country: half.region.country, state: half.region.state, city: null, name: half.region.name, part: half.part };
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
