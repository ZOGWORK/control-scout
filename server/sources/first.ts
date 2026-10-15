// FIRST Events API (ftc-api.firstinspires.org) — the primary source.
//
// One event = schedule (who plays, surrogates) + results (scores, who was on
// the field, DQs, video) + score breakdowns (auto/TeleOp/endgame/penalties)
// + rankings + alliances + awards + advancement. Requests go through a small
// concurrency limiter with retries; credentials never leave this module.
import { env, hasFirst } from "../env.js";
import type { AdvancementRow, AllianceRow, AwardRow, EntryRow, EventBundle, EventRow, MatchRow, MatchTeam, TeamRow } from "../data/bundle.js";
import { matchKey, matchLabel } from "../data/bundle.js";
import { normalizeAwardName, normalizeEventType, ownScorePenalties, splitFirstScore, type ScoreSplit } from "../data/seasons.js";

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

/** GET a FIRST endpoint. Null on 404 (not published / no such event).
 *  `optional`: also null (no retries) on a 5xx — for data FIRST no longer serves. */
export async function firstGet<T = any>(path: string, optional = false): Promise<T | null> {
  if (!hasFirst()) throw new FirstError(0, "FIRST Events API credentials are not configured");
  const auth = "Basic " + Buffer.from(`${env.firstUser}:${env.firstToken}`).toString("base64");
  return slot(async () => {
    for (let attempt = 0; ; attempt++) {
      firstStats.requests++;
      let res: Response;
      try {
        res = await fetch(BASE + path, { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(45000) });
      } catch (e) {
        if (attempt < 4) { firstStats.retries++; await sleep(1000 * 2 ** attempt); continue; }
        throw new FirstError(0, `FIRST ${path}: ${(e as Error).message}`);
      }
      if (res.status === 404) { firstStats.notFound++; return null; }
      if (optional && res.status >= 500) { await res.arrayBuffer().catch(() => {}); return null; }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 5) { firstStats.retries++; await sleep(Number(res.headers.get("retry-after")) * 1000 || 1500 * 2 ** attempt); continue; }
      }
      if (!res.ok) {
        // FIRST answers "no data yet" for some endpoints with 400/500 + a message.
        const text = await res.text().catch(() => "");
        throw new FirstError(res.status, `FIRST ${path}: HTTP ${res.status} ${text.slice(0, 160)}`);
      }
      return (await res.json()) as T;
    }
  });
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
    region: str(e.regionCode), league: str(e.leagueCode), venue: str(e.venue), city: str(e.city), state: str(e.stateprov), country: str(e.country),
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

/** Every registered team of a season (paged). */
export async function firstTeams(season: number, onPage?: (page: number, of: number) => void): Promise<TeamRow[]> {
  const first = await firstGet<any>(`/${season}/teams?page=1`);
  if (!first) return [];
  const pages = num(first.pageTotal) ?? 1;
  const out: TeamRow[] = (first.teams ?? []).map(teamRowFromFirst);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => firstGet<any>(`/${season}/teams?page=${i + 2}`).then((d) => { onPage?.(i + 2, pages); return d; })));
  for (const d of rest) out.push(...(d?.teams ?? []).map(teamRowFromFirst));
  return out;
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

/** Totals-only split for 2019–2022 (no breakdown): own fouls either came off
 *  this score (2020, 2021) or were added to the opponent's (2019, 2022). */
export function legacyTotals(season: number, final: unknown, ownFoul: unknown, oppFoul: unknown, auto: unknown): ScoreSplit | null {
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
  const breakdown = new Map<string, { red: ScoreSplit; blue: ScoreSplit }>();
  for (const s of [...(scoresQ?.matchScores ?? []), ...(scoresP?.matchScores ?? [])]) {
    const level = levelOf(s.matchLevel);
    if (!level) continue;
    const red = (s.alliances ?? []).find((a: any) => String(a.alliance).toLowerCase() === "red");
    const blue = (s.alliances ?? []).find((a: any) => String(a.alliance).toLowerCase() === "blue");
    if (!red || !blue) continue;
    breakdown.set(matchKey({ level, series: s.matchSeries ?? 0, number: s.matchNumber }), { red: splitFirstScore(season, red, blue), blue: splitFirstScore(season, blue, red) });
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
    const totals = (final: unknown, foul: unknown, auto: unknown): ScoreSplit | null => {
      const t = num(final);
      if (t == null) return null;
      const f = num(foul) ?? 0, a = num(auto) ?? 0;
      return { total: t, np: Math.max(0, t - f), auto: a, teleop: Math.max(0, t - f - a), endgame: 0, pen: 0 };
    };
    // Prefer the breakdown; fall back to totals (no endgame split, penalties unknown per side).
    let redScore = bd?.red ?? null, blueScore = bd?.blue ?? null;
    if ((!redScore || !blueScore) && season <= 2022) {
      // 2019–2022 results: scoreRedFoul = the fouls red committed (checked against the breakdowns).
      redScore = redScore ?? legacyTotals(season, m.scoreRedFinal, m.scoreRedFoul, m.scoreBlueFoul, m.scoreRedAuto);
      blueScore = blueScore ?? legacyTotals(season, m.scoreBlueFinal, m.scoreBlueFoul, m.scoreRedFoul, m.scoreBlueAuto);
    } else if (!redScore || !blueScore) {
      const rt = totals(m.scoreRedFinal, m.scoreRedFoul, m.scoreRedAuto), bt = totals(m.scoreBlueFinal, m.scoreBlueFoul, m.scoreBlueAuto);
      // scoreRedFoul = points red received from blue's fouls → blue committed them.
      if (rt && bt) { rt.pen = num(m.scoreBlueFoul) ?? 0; bt.pen = num(m.scoreRedFoul) ?? 0; }
      redScore = redScore ?? rt; blueScore = blueScore ?? bt;
    }
    // Final totals come from the results feed (authoritative after adjustments).
    if (redScore && num(m.scoreRedFinal) != null) redScore = { ...redScore, total: m.scoreRedFinal };
    if (blueScore && num(m.scoreBlueFinal) != null) blueScore = { ...blueScore, total: m.scoreBlueFinal };
    const played = !!(m.postResultTime || m.actualStartTime) && redScore != null && blueScore != null;
    byKey.set(key, {
      level, series, number: m.matchNumber, label: matchLabel(level, series, m.matchNumber), description: str(m.description) ?? prev?.description ?? null,
      time: str(m.actualStartTime) ?? prev?.time ?? null, played,
      red: fixField(keepSur(red.length ? red : prev?.red ?? [], prev?.red)), blue: fixField(keepSur(blue.length ? blue : prev?.blue ?? [], prev?.blue)),
      redScore: played ? redScore : null, blueScore: played ? blueScore : null, video: str(m.videoURL),
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
