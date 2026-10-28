// FIRST Events API (ftc-api.firstinspires.org) — the primary source.
//
// One event = schedule (who plays, surrogates) + results (scores, who was on
// the field, DQs, video) + score breakdowns (auto/TeleOp/endgame/penalties)
// + rankings + alliances + awards + advancement. Requests go through a small
// concurrency limiter with retries; credentials never leave this module.
import { env, hasFirst } from "../env.js";
import type { AdvancementRow, AllianceRow, AwardRow, EntryRow, EventBundle, EventRow, MatchRow, MatchTeam, TeamRow } from "../data/bundle.js";
import { matchKey, matchLabel } from "../data/bundle.js";
import { normalizeAwardName, normalizeEventType, ownScorePenalties, scoreDetail, splitFirstScore, type ScoreSplit } from "../data/seasons.js";

const BASE = "https://ftc-api.firstinspires.org/v2.0";

export class FirstError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

// ---------------------------------------------------------------------------
// HTTP: concurrency limit + retries
// ---------------------------------------------------------------------------

let active = 0;
const waiting: (() => void)[] = [];
let maxConcurrent = 4;
export const setFirstConcurrency = (n: number) => { maxConcurrent = Math.max(1, n); };
export const firstStats = { requests: 0, retries: 0, notFound: 0 };

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= maxConcurrent) await new Promise<void>((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One GET with retries (network errors, 429, 5xx). 404 and 304 come back as responses. */
async function request(path: string, headers: Record<string, string> = {}, tries: { network: number; server: number; rateLimited?: number } = { network: 4, server: 5 }): Promise<Response> {
  if (!hasFirst()) throw new FirstError(0, "FIRST Events API credentials are not configured");
  const auth = "Basic " + Buffer.from(`${env.firstUser}:${env.firstToken}`).toString("base64");
  return slot(async () => {
    for (let attempt = 0; ; attempt++) {
      firstStats.requests++;
      let res: Response;
      try {
        res = await fetch(BASE + path, { headers: { Authorization: auth, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(45000) });
      } catch (e) {
        if (attempt < tries.network) { firstStats.retries++; await sleep(1000 * 2 ** attempt); continue; }
        throw new FirstError(0, `FIRST ${path}: ${(e as Error).message}`);
      }
      if (res.status === 404) { firstStats.notFound++; return res; }
      // 429 (slow down) retries on its own budget: an optional request skips 5xx retries, never rate limits.
      if (res.status === 429 || res.status >= 500) {
        if (attempt < (res.status === 429 ? tries.rateLimited ?? tries.server : tries.server)) { firstStats.retries++; await sleep(Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt); continue; }
      }
      if (!res.ok && res.status !== 304) {
        // FIRST answers "no data yet" for some endpoints with 400/500 + a message.
        const text = await res.text().catch(() => "");
        throw new FirstError(res.status, `FIRST ${path}: HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      return res;
    }
  });
}

/** GET a FIRST endpoint. Null on 404 (not published / no such event).
 *  `optional`: also null (no retries) on a 5xx — for data FIRST no longer serves. */
export async function firstGet<T = any>(path: string, optional = false): Promise<T | null> {
  let res: Response;
  try { res = await request(path, {}, optional ? { network: 4, server: 0, rateLimited: 5 } : undefined); }
  catch (e) { if (optional && e instanceof FirstError && e.status >= 500) return null; throw e; }
  if (res.status === 404) return null;
  return (await res.json()) as T;
}

/** What a conditional GET saw: unchanged (304), or the body and its change marker. */
export type FirstProbe = { changed: false } | { changed: true; lastModified: string | null; body: string };

/**
 * Conditional GET: FIRST's schedule, matches and scores endpoints send
 * Last-Modified and answer If-Modified-Since with an empty 304 (checked
 * 2026-10; rankings/alliances/awards don't). One cheap request tells the live
 * fast lane whether anything at an event moved. A 404 reads as an empty body.
 * Fewer retries than a full sync: the next tick tries again within a minute.
 */
export async function firstProbe(path: string, since: string | null): Promise<FirstProbe> {
  const res = await request(path, since ? { "If-Modified-Since": since } : {}, { network: 1, server: 1 });
  if (res.status === 304) return { changed: false };
  const body = res.status === 404 ? "" : await res.text();
  return { changed: true, lastModified: res.headers.get("last-modified"), body };
}

const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const day = (x: unknown) => (typeof x === "string" && x.length >= 10 ? x.slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Season-level lists
// ---------------------------------------------------------------------------

export async function firstSeasonInfo(season: number): Promise<{ gameName: string | null; teamCount: number | null } | null> {
  const d = await firstGet<any>(`/${season}`);
  return d ? { gameName: str(d.gameName), teamCount: num(d.teamCount) } : null;
}

export function eventRowFromFirst(season: number, e: any): EventRow {
  return {
    season, code: e.code, name: str(e.name) ?? e.code, type: normalizeEventType(e.typeName), divisionCode: str(e.divisionCode),
    region: str(e.regionCode), league: str(e.leagueCode), venue: str(e.venue), address: str(e.address), city: str(e.city), state: str(e.stateprov), country: str(e.country),
    start: day(e.dateStart), end: day(e.dateEnd) ?? day(e.dateStart), timezone: str(e.timezone), remote: !!e.remote, hybrid: !!e.hybrid,
    website: str(e.website), livestream: str(e.liveStreamUrl), source: "first", upstreamUpdated: null,
  };
}

export async function firstEvents(season: number): Promise<EventRow[]> {
  const d = await firstGet<any>(`/${season}/events`);
  // `published` is not a visibility flag (FIRST marks most upcoming events false); keep every event.
  return (d?.events ?? []).filter((e: any) => e?.code).map((e: any) => eventRowFromFirst(season, e));
}

/** Split FIRST's "Org/Sponsor&School" nameFull into sponsors and school. */
export function parseFullName(full: string | null): { sponsors: string[]; school: string | null } {
  if (!full) return { sponsors: [], school: null };
  const amp = full.lastIndexOf("&");
  const sponsorsPart = amp >= 0 ? full.slice(0, amp) : full;
  const school = amp >= 0 ? full.slice(amp + 1).trim() || null : null;
  const sponsors = sponsorsPart.split("/").map((s) => s.trim()).filter(Boolean);
  return { sponsors: amp >= 0 || !school ? sponsors : [], school };
}

export function teamRowFromFirst(t: any): TeamRow {
  const full = str(t.nameFull);
  const { sponsors, school } = parseFullName(full);
  return {
    number: t.teamNumber, name: str(t.nameShort), fullName: full, school: str(t.schoolName) ?? school, sponsors,
    city: str(t.city), state: str(t.stateProv), country: str(t.country), rookieYear: num(t.rookieYear), website: str(t.website), homeRegion: str(t.homeRegion),
  };
}

/** Every page of a team list (`query` without the page). Null when FIRST answers 404.
 *  `whole`: the caller replaces its rows with the list, so anything short of the whole list fails the read
 *  (a page missing or without its teams array, or fewer teams than FIRST's own count); an empty list is fine. */
async function teamPages(season: number, query: string, o: { onPage?: (page: number, of: number) => void; whole?: boolean } = {}): Promise<TeamRow[] | null> {
  const first = await firstGet<any>(`/${season}/teams?${query}page=1`);
  if (!first) return null;
  const pages = num(first.pageTotal) ?? 1;
  const out: TeamRow[] = (first.teams ?? []).filter((t: any) => t?.teamNumber).map(teamRowFromFirst);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => firstGet<any>(`/${season}/teams?${query}page=${i + 2}`).then((d) => { o.onPage?.(i + 2, pages); return d; })));
  if (o.whole && [first, ...rest].some((d) => !Array.isArray(d?.teams))) throw new FirstError(0, `FIRST /${season}/teams?${query}: a page of ${pages} is missing its teams`);
  for (const d of rest) out.push(...(d?.teams ?? []).filter((t: any) => t?.teamNumber).map(teamRowFromFirst));
  const total = num(first.teamCountTotal);
  if (o.whole && total != null && out.length < total) throw new FirstError(0, `FIRST /${season}/teams?${query}: ${out.length} of ${total} teams`);
  return out;
}

/** Every registered team of a season (paged). */
export async function firstTeams(season: number, onPage?: (page: number, of: number) => void): Promise<TeamRow[]> {
  return (await teamPages(season, "", { onPage })) ?? [];
}

/** The teams registered for one event: FIRST lists them about a week ahead, before rankings or a schedule.
 *  Null: FIRST doesn't know the event (404). */
export function firstEventTeams(season: number, code: string): Promise<TeamRow[] | null> {
  return teamPages(season, `eventCode=${encodeURIComponent(code)}&`, { whole: true });
}

// ---------------------------------------------------------------------------
// One event, in full
// ---------------------------------------------------------------------------

const levelOf = (x: unknown): "qual" | "playoff" | null => {
  const s = String(x ?? "").toUpperCase();
  if (s.startsWith("QUAL")) return "qual";
  if (s.startsWith("PLAYOFF") || s.startsWith("SEMI") || s.startsWith("FINAL") || s.startsWith("ELIM")) return "playoff";
  return null;
};
const allianceOf = (station: unknown): "red" | "blue" | null => {
  const s = String(station ?? "").toLowerCase();
  return s.startsWith("red") ? "red" : s.startsWith("blue") ? "blue" : null;
};
const stationNo = (station: unknown) => num(Number(String(station ?? "").replace(/\D/g, ""))) || null;

/** Totals-only split (no breakdown). In FIRST's results feed `scoreXFoul` is the
 *  foul points alliance X committed, in every season (checked against the
 *  breakdowns, 2019–2026). Own fouls either came off X's score (2020, 2021) or
 *  were added to the opponent's (every other season, 2023+ included), so X's
 *  non-penalty score is its total minus the opponent's fouls. */
export function totalsOnly(season: number, final: unknown, ownFoul: unknown, oppFoul: unknown, auto: unknown): ScoreSplit | null {
  const t = num(final);
  if (t == null) return null;
  const pen = num(ownFoul) ?? 0, a = num(auto) ?? 0;
  const np = ownScorePenalties(season) ? t + pen : Math.max(0, t - (num(oppFoul) ?? 0));
  return { total: t, np, auto: a, teleop: Math.max(0, np - a), endgame: 0, pen };
}

/**
 * Assemble a full bundle for one event. `meta` is the event-list row.
 * FIRST answers "not published yet" with 200 + empty lists (and 404 for an
 * unknown event), so any other failure is real: it propagates, the caller
 * falls back to FTC Scout, and if that fails too the stored event is left
 * untouched — a partial bundle never replaces good data.
 */
export async function firstEventBundle(meta: EventRow): Promise<EventBundle> {
  const { season, code } = meta;
  const c = encodeURIComponent(code);
  // Remote events (2020–2022): every team plays alone under the same match
  // numbers, so the keys collide; keep the event, rankings and awards only.
  const solo = <T,>(f: () => Promise<T>) => (meta.remote ? Promise.resolve(null) : f());
  const [schedQ, schedP, results, scoresQ, scoresP, rankings, alliances, awards, advancement] = await Promise.all([
    solo(() => firstGet<any>(`/${season}/schedule/${c}?tournamentLevel=qual`)),
    solo(() => firstGet<any>(`/${season}/schedule/${c}?tournamentLevel=playoff`)),
    solo(() => firstGet<any>(`/${season}/matches/${c}`)),
    solo(() => firstGet<any>(`/${season}/scores/${c}/qual`)),
    solo(() => firstGet<any>(`/${season}/scores/${c}/playoff`)),
    firstGet<any>(`/${season}/rankings/${c}`),
    firstGet<any>(`/${season}/alliances/${c}`),
    firstGet<any>(`/${season}/awards/${c}`),
    // 2019–2022: FIRST answers 503 "Advancement data unavailable" for many events; don't let that cost the event.
    firstGet<any>(`/${season}/advancement/${c}`, season <= 2022),
  ]);

  // Score breakdowns by match key.
  const breakdown = new Map<string, { red: ScoreSplit; blue: ScoreSplit; redDetail: Record<string, number> | null; blueDetail: Record<string, number> | null }>();
  for (const s of [...(scoresQ?.matchScores ?? []), ...(scoresP?.matchScores ?? [])]) {
    const level = levelOf(s.matchLevel);
    if (!level) continue;
    const red = (s.alliances ?? []).find((a: any) => String(a.alliance).toLowerCase() === "red");
    const blue = (s.alliances ?? []).find((a: any) => String(a.alliance).toLowerCase() === "blue");
    if (!red || !blue) continue;
    breakdown.set(matchKey({ level, series: s.matchSeries ?? 0, number: s.matchNumber }), { red: splitFirstScore(season, red, blue), blue: splitFirstScore(season, blue, red), redDetail: scoreDetail(season, red), blueDetail: scoreDetail(season, blue) });
  }

  // Matches: start from the schedule (surrogates, unplayed matches), overlay results.
  const byKey = new Map<string, MatchRow>();
  const teamsOf = (list: any[], al: "red" | "blue"): MatchTeam[] => (list ?? []).filter((t: any) => t?.teamNumber && allianceOf(t.station) === al).map((t: any) => ({
    team: t.teamNumber, station: stationNo(t.station), surrogate: !!t.surrogate, dq: !!t.dq, onField: t.onField !== false && !t.noShow,
  }));
  for (const m of [...(schedQ?.schedule ?? []), ...(schedP?.schedule ?? [])]) {
    const level = levelOf(m.tournamentLevel);
    if (!level || !m.matchNumber) continue;
    const series = m.series ?? 0;
    const row: MatchRow = {
      level, series, number: m.matchNumber, label: matchLabel(level, series, m.matchNumber), description: str(m.description),
      time: str(m.startTime), played: false, red: teamsOf(m.teams, "red"), blue: teamsOf(m.teams, "blue"), redScore: null, blueScore: null,
      field: str(m.field == null ? null : String(m.field)),
    };
    byKey.set(matchKey(row), row);
  }
  for (const m of results?.matches ?? []) {
    const level = levelOf(m.tournamentLevel);
    if (!level || !m.matchNumber) continue;
    const series = m.series ?? 0;
    const key = matchKey({ level, series, number: m.matchNumber });
    const prev = byKey.get(key);
    const red = teamsOf(m.teams, "red"), blue = teamsOf(m.teams, "blue");
    // Surrogate flags only exist on the schedule; keep them.
    const keepSur = (ts: MatchTeam[], old?: MatchTeam[]) => ts.map((t) => ({ ...t, surrogate: t.surrogate || !!old?.find((o) => o.team === t.team)?.surrogate }));
    // Some events report every robot as off the field; then everyone listed played.
    const fixField = (ts: MatchTeam[]) => (ts.length && ts.every((t) => !t.onField) ? ts.map((t) => ({ ...t, onField: true })) : ts);
    const bd = breakdown.get(key);
    // Prefer the breakdown; fall back to totals (no endgame split). scoreRedFoul = the fouls red committed.
    let redScore = bd?.red ?? totalsOnly(season, m.scoreRedFinal, m.scoreRedFoul, m.scoreBlueFoul, m.scoreRedAuto);
    let blueScore = bd?.blue ?? totalsOnly(season, m.scoreBlueFinal, m.scoreBlueFoul, m.scoreRedFoul, m.scoreBlueAuto);
    // Final totals come from the results feed (authoritative after adjustments).
    if (redScore && num(m.scoreRedFinal) != null) redScore = { ...redScore, total: m.scoreRedFinal };
    if (blueScore && num(m.scoreBlueFinal) != null) blueScore = { ...blueScore, total: m.scoreBlueFinal };
    const played = !!(m.postResultTime || m.actualStartTime) && redScore != null && blueScore != null;
    byKey.set(key, {
      level, series, number: m.matchNumber, label: matchLabel(level, series, m.matchNumber), description: str(m.description) ?? prev?.description ?? null,
      time: str(m.actualStartTime) ?? prev?.time ?? null, played,
      red: fixField(keepSur(red.length ? red : prev?.red ?? [], prev?.red)), blue: fixField(keepSur(blue.length ? blue : prev?.blue ?? [], prev?.blue)),
      redScore: played ? redScore : null, blueScore: played ? blueScore : null, video: str(m.videoURL),
      // The field is only on the schedule (the results feed has none).
      field: prev?.field ?? null,
      // Totals only until FIRST publishes the breakdown: that split is an estimate, not reported values.
      breakdown: !!bd,
      redDetail: bd?.redDetail ?? null, blueDetail: bd?.blueDetail ?? null,
    });
  }
  // A best-of-3 final between two alliances: FIRST numbers it series 1,
  // "Finals 1..3"; the engine (and FTC Scout) use series 0 for that format.
  // Double-elimination brackets ("… Bracket Round N Match M") keep theirs.
  for (const m of byKey.values()) {
    if (m.level === "playoff" && /^finals\s+\d+$/i.test(m.description ?? "")) { m.series = 0; m.label = matchLabel("playoff", 0, m.number); }
  }
  const matches = [...byKey.values()].sort((a, b) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number);

  const entries: EntryRow[] = (rankings?.rankings ?? []).filter((r: any) => r?.teamNumber).map((r: any) => ({
    team: r.teamNumber, rank: num(r.rank), rp: num(r.sortOrder1), tbp: num(r.sortOrder2), wins: num(r.wins), losses: num(r.losses), ties: num(r.ties),
    qualPlayed: num(r.matchesPlayed), dq: num(r.dq),
  }));
  // Teams that are scheduled but not (yet) ranked still belong to the event.
  const seen = new Set(entries.map((e) => e.team));
  for (const m of matches) for (const t of [...m.red, ...m.blue]) if (!seen.has(t.team)) { seen.add(t.team); entries.push({ team: t.team, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, dq: null }); }

  const allianceRows: AllianceRow[] = (alliances?.alliances ?? []).filter((a: any) => a?.number).map((a: any) => ({
    number: a.number, name: str(a.name), captain: num(a.captain?.teamNumber ?? a.captain), pick1: num(a.round1?.teamNumber ?? a.round1),
    pick2: num(a.round2?.teamNumber ?? a.round2), backup: num(a.backup?.teamNumber ?? a.backup),
  }));

  const awardRows: AwardRow[] = [];
  for (const a of awards?.awards ?? []) {
    const type = normalizeAwardName(String(a.name ?? ""));
    if (!type || !a.teamNumber) continue;
    awardRows.push({ type, placement: num(a.series) || 1, team: a.teamNumber, name: str(a.name) });
  }

  let adv: AdvancementRow | null = null;
  if (advancement && num(advancement.slots)) {
    adv = {
      slots: advancement.slots, advancesTo: str(advancement.advancesTo),
      rows: (advancement.advancement ?? []).filter((r: any) => r?.team && r.status).map((r: any) => ({ team: r.team, status: String(r.status), declined: r.declined === true })),
    };
  }

  return { event: meta, teams: [], detail: { entries, matches, alliances: allianceRows, awards: awardRows, advancement: adv } };
}
