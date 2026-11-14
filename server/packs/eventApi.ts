// The event pack (docs/event-bundle.md, "The event pack"): the server's own JSON for every page a team opens at the
// venue, so the whole event works with no signal and shows the same numbers as online. Each path is read through
// the very function its route calls (server/api/reads.ts, teams.ts, matchReport.ts …), in process: never a
// re-implementation. Then checked: a team in the event, or a match on its schedule, missing from the pack makes the
// build fail loudly ("If a team in the event is not in the pack, the pack is broken").
//
// Adding a page: one entry in PACK_READS (paths and the function that answers each), nothing else.
import { createHash } from "node:crypto";
import { kvGet } from "../db.js";
import { registerCache } from "../caches.js";
import { dataVersion, liveVersion } from "../predict/engine.js";
import { CURRENT_SEASON, isLegacy } from "../data/seasons.js";
import { isEnabled } from "../flags.js";
import { compareBlockOf, latestResultsSeason, teamProfile } from "../api/teams.js";
import { matchDetailAnswer, teamMatchesAnswer, teamReportCardAnswer, teamScheduleAnswer } from "../api/reads.js";
import { eventDetail } from "../api/events.js";
import { matchReport } from "../api/matchReport.js";
import { pickRatings } from "../api/pickRatings.js";
import { readProjections } from "../projections/store.js";
import { hasTeamPage } from "../../src/shared/teamPages.js";
import { packPath, stableJson, type PackApi, type PackCompareTeam } from "../../src/shared/eventBundle.js";
import type { EventDetail, MatchView } from "../../src/shared/api.js";

/** What every entry of PACK_READS is given: the event as the bundle holds it, and who and what is in it. */
export interface PackContext {
  season: number;
  /** The stored event code (paths use it; the app's own requests are matched case-blind, packPath). */
  code: string;
  ev: EventDetail;
  /** The field and everyone in a lineup on the schedule, by number. */
  teams: number[];
  matches: MatchView[];
  /** The event's detail as matchDetail builds it, made once for every match (the route builds it per request). */
  detail: () => Promise<EventDetail | null>;
}

/** One path the pack answers. `read` gives the route's answer, null where the route answers 404. `needed`: what a
 *  page can't do without it ("team 4215"), so a pack without its answer is broken and the build fails. */
export interface PackRead { path: string; read: () => Promise<unknown | null>; needed?: string; notFound?: string }

type Reads = (c: PackContext) => PackRead[] | Promise<PackRead[]>;
const ev = (c: PackContext) => `/api/events/${c.season}/${encodeURIComponent(c.code)}`;

/** The pages the pack makes work offline: one array, in the order the pack stores them. */
export const PACK_READS: Reads[] = [
  // Team pages: the profile (with and without ?season=, stored once when the same), its season matches (Compare's
  // head-to-head reads them too) and the collapsed sections.
  (c) => c.teams.flatMap((t): PackRead[] => [
    { path: `/api/teams/${t}?season=${c.season}`, read: () => teamProfile(t, c.season), needed: `team ${t}`, notFound: `No FTC team ${t} in our data` },
    { path: `/api/teams/${t}`, read: () => teamProfile(t), notFound: `No FTC team ${t} in our data` },
    { path: `/api/teams/${t}/matches?season=${c.season}`, read: () => teamMatchesAnswer(t, c.season), needed: `team ${t}'s matches` },
    // The route's default season is the current one.
    ...(c.season === CURRENT_SEASON ? [{ path: `/api/teams/${t}/matches`, read: () => teamMatchesAnswer(t, c.season) }] : []),
    { path: `/api/teams/${t}/report-card?season=${c.season}`, read: () => teamReportCardAnswer(t, c.season) },
  ]),
  async (c) => ((await isEnabled("scheduleDifficulty")) ? c.teams.map((t) => ({ path: `/api/teams/${t}/schedule?season=${c.season}`, read: () => teamScheduleAnswer(t, c.season) })) : []),
  // Match pages: every match's detail (the event page's opened match) and its Know your match report.
  (c) => c.matches.map((m) => ({ path: `${ev(c)}/matches/${m.key}`, read: async () => matchDetailAnswer(c.season, c.code, m.key, await c.detail()), needed: `match ${m.label}` })),
  (c) => c.matches.map((m) => ({ path: `${ev(c)}/matches/${m.key}/report`, read: () => matchReport(c.season, c.code, m.key), needed: `match ${m.label}'s report` })),
  // The event page's advancement odds and the pick helper.
  async (c) => (!isLegacy(c.season) && (await isEnabled("advancementOdds")) ? [{ path: `/api/projections/${c.season}/${encodeURIComponent(c.code)}`, read: () => readProjections(c.season, c.code) }] : []),
  (c) => [{ path: `${ev(c)}/pick-ratings`, read: () => pickRatings(c.season, c.code) }],
];

/** Everyone the pack must hold: the field, and anyone in a lineup on the schedule. */
export function packTeams(ev: EventDetail): number[] {
  const out = new Set(ev.field.map((f) => f.team));
  for (const m of ev.matches) for (const t of [...m.red.teams, ...m.blue.teams]) out.add(t.number);
  return [...out].sort((a, b) => a - b);
}

/** Run `fn` over `items`, `n` at a time, in order. */
async function inTurns<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  for (let i = 0; i < items.length; i += n) {
    const part = await Promise.all(items.slice(i, i + n).map(fn));
    part.forEach((r, j) => { out[i + j] = r; });
  }
  return out;
}

/** The pack is broken: the build stops here, with what's missing. */
export class PackBroken extends Error {}

/**
 * Check the pack holds every team and every match of the event (a team with no team page, a placeholder, has the
 * route's 404 instead). Throws PackBroken naming what's missing.
 */
export function assertComplete(c: Pick<PackContext, "season" | "code" | "ev" | "teams" | "matches">, api: PackApi, compare: Record<string, PackCompareTeam>): void {
  const has = (p: string) => { const k = packPath(p)!; return Object.prototype.hasOwnProperty.call(api.answers, api.same[k] ?? k); };
  const name = new Map(c.ev.field.map((f) => [f.team, f.name]));
  const missing: string[] = [];
  for (const t of c.teams) {
    const pageless = !hasTeamPage(t, name.get(t));
    if (!pageless && !has(`/api/teams/${t}?season=${c.season}`)) missing.push(`team ${t}`);
    if (!has(`/api/teams/${t}/matches?season=${c.season}`)) missing.push(`team ${t}'s matches`);
    if (!compare[String(t)]) missing.push(`team ${t}'s Compare column`);
  }
  const base = `/api/events/${c.season}/${encodeURIComponent(c.code)}/matches`;
  for (const m of c.matches) if (!has(`${base}/${m.key}`)) missing.push(`match ${m.label}`);
  if (missing.length) throw new PackBroken(`The event pack for ${c.season} ${c.code} is broken: it's missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ` and ${missing.length - 8} more` : ""}.`);
}

export interface PackParts { api: PackApi; compare: Record<string, PackCompareTeam> }

/** Packs kept per event and data (a build reads a few hundred answers: seconds, so it's made once per data version,
 *  not on every manifest look). Kept PACK_TTL_MS at most: a clip's timing is judged against the clock. */
export const PACK_TTL_MS = 10 * 60_000;
const MAX_PACKS = 20;
const packs = new Map<string, { at: number; value: Promise<PackParts> }>();
registerCache("Event packs", () => packs.clear());
/** Tests: forget every kept pack. */
export function clearPackCache() { packs.clear(); }

/** The event pack's `api` and `compare` sections for an event (its detail as the bundle holds it): kept per data
 *  version, the event's own data and the owner switches that gate its paths. */
export async function packApi(season: number, ev: EventDetail): Promise<PackParts> {
  const switches = await Promise.all(["scheduleDifficulty", "advancementOdds"].map((f) => isEnabled(f as "scheduleDifficulty").catch(() => false)));
  const key = [await dataVersion(), (await kvGet<string>("data:settled")) ?? "", await liveVersion(season), season, ev.event.code,
    createHash("sha256").update(stableJson(ev)).digest("hex").slice(0, 16), switches.join(",")].join("|");
  const hit = packs.get(key);
  if (hit && Date.now() - hit.at < PACK_TTL_MS) return hit.value;
  const value = buildPackApi(season, ev);
  packs.delete(key);
  packs.set(key, { at: Date.now(), value });
  value.catch(() => { if (packs.get(key)?.value === value) packs.delete(key); });
  while (packs.size > MAX_PACKS) packs.delete(packs.keys().next().value!);
  return value;
}

/** Build the event pack's `api` and `compare` sections for an event (its detail as the bundle holds it). */
export async function buildPackApi(season: number, ev: EventDetail, reads: Reads[] = PACK_READS): Promise<PackParts> {
  const code = ev.event.code;
  let detail: Promise<EventDetail | null> | undefined;
  const c: PackContext = { season, code, ev, teams: packTeams(ev), matches: ev.matches, detail: () => (detail ??= eventDetail(season, code)) };
  const list = (await Promise.all(reads.map((r) => r(c)))).flat();
  const api: PackApi = { answers: {}, same: {}, errors: {} };
  // The same answer twice (a profile with and without ?season=) is stored once.
  const byText = new Map<string, string>();
  const got = await inTurns(list, 6, async (r) => {
    try { return await r.read(); } catch (e) { throw new Error(`Event pack: reading ${r.path} failed: ${(e as Error).message}`); }
  });
  list.forEach((r, i) => {
    const key = packPath(r.path)!;
    const body = got[i];
    if (body == null) {
      if (r.notFound) api.errors[key] = { status: 404, error: r.notFound };
      return;
    }
    const text = JSON.stringify(body);
    const first = byText.get(text);
    if (first) { api.same[key] = first; return; }
    byText.set(text, key);
    api.answers[key] = body;
  });
  const compare: Record<string, PackCompareTeam> = {};
  await inTurns(c.teams, 6, async (t) => { compare[String(t)] = { block: await compareBlockOf(t, season), latest: await latestResultsSeason(t) }; });
  assertComplete(c, api, compare);
  return { api, compare };
}

/** Every path the pack answers (answers, aliases, errors), for the manifest. */
export const packApiPaths = (api: PackApi): string[] => [...Object.keys(api.answers), ...Object.keys(api.same), ...Object.keys(api.errors)];
