// The Chicago Robotics Invitational's own results site (results.chicagoroboticsinvitational.com).
//
// FIRST's API lists CRI (FPECRI) but publishes no teams, matches or awards for it; CRI posts them all on its
// own site, which reads a public JSON API (/api/v1/...). This file reads that API and normalises one event into
// an EventBundle (source "cri"); data/criResults.ts decides when to read and whether to write (never over FIRST).
//
// Quirks of the site's data, handled here:
// - 2025–26's rankings come back numbered from the bottom (its rank 1 has the fewest ranking points and went
//   1–7; its rank 38 was the 1st alliance captain). The order is read from the ranking points, not assumed.
// - Each match's split (auto, TeleOp, endgame, penalty) is on its own page; the list has totals only. `penalty`
//   is what that alliance gave away: the opponent's total includes it.
// - The per-alliance score sheets ("score_details") are not used: the site has posted both alliances' sheets
//   identical in some matches.
// - Practice matches are left out, like FIRST's.
import type { AllianceRow, AwardRow, EntryRow, EventBundle, EventRow, MatchRow, MatchTeam } from "../data/bundle.js";
import { matchLabel } from "../data/bundle.js";
import type { ScoreSplit } from "../data/seasons.js";

export const CRI_SOURCE = "cri";
export const CRI_SITE = "chicagoroboticsinvitational.com";
export const CRI_ORIGIN = "https://results.chicagoroboticsinvitational.com";
const API = `${CRI_ORIGIN}/api/v1`;

/** The site's public results page for one event (linked from the event page). */
export const criEventUrl = (criSeason: string, slug: string) => `${CRI_ORIGIN}/${criSeason}/events/${slug}/quals`;

/** One of the site's seasons: "2025-2026-cri" is CRI's 2025–26 (DECODE) edition. */
export interface CriSeason { id: number; year: string; name: string; active: boolean; offseason: boolean }
export interface CriEvent { id: number; slug: string; name: string; season: string; start_date: string | null; end_date: string | null; timezone: string | null; aasm_state?: string }

/**
 * The Scout season of a CRI edition ("2025-2026-cri" and "2023-2024-off-cri" → 2025 and 2023), or null for one of
 * the site's regular (non-CRI) seasons, which aren't CRI's own results.
 */
export function criSeasonNumber(s: Pick<CriSeason, "year" | "offseason">): number | null {
  const m = /^(\d{4})-(\d{4})\b.*\bcri$/i.exec(s.year);
  if (!s.offseason || !m || Number(m[2]) !== Number(m[1]) + 1) return null;
  return Number(m[1]);
}

/** Everything read for one event: the lists, and each played match's split by its name ("Q1", "M3"). */
export interface CriRaw {
  event: CriEvent;
  teams: { number: number }[];
  matches: any[];
  rankings: any[];
  alliances: { alliances?: { seed: number; teams: number[] }[] } | null;
  awards: any[];
  details: Record<string, any>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A volunteer-run site: one request at a time, a pause between them, and a plain identifying agent. */
export async function criGet<T>(path: string, o: { timeoutMs?: number; pauseMs?: number } = {}): Promise<T> {
  await sleep(o.pauseMs ?? 1500);
  const res = await fetch(`${API}${path}`, {
    headers: { "user-agent": "control-scout (+https://controlscout.org)", accept: "application/json" },
    signal: AbortSignal.timeout(o.timeoutMs ?? 30000),
  });
  if (!res.ok) throw new Error(`${CRI_SITE} ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** The event's lists (five requests). Match splits are read separately (criDetails), only when the lists changed. */
export async function fetchCriLists(criSeason: string, slug: string): Promise<Omit<CriRaw, "details">> {
  const base = `/${encodeURIComponent(criSeason)}/events/${encodeURIComponent(slug)}`;
  const event = await criGet<CriEvent>(base);
  const teams = await criGet<{ number: number }[]>(`${base}/teams`);
  const matches = await criGet<any[]>(`${base}/matches`);
  const rankings = await criGet<any[]>(`${base}/rankings`);
  const alliances = await criGet<CriRaw["alliances"]>(`${base}/alliances`);
  const awards = await criGet<any[]>(`${base}/awards`);
  return { event, teams, matches, rankings, alliances, awards };
}

/** Each played qualification and playoff match's own page (its split). `known`: pages already read, kept. */
export async function fetchCriDetails(criSeason: string, slug: string, matches: any[], known: Record<string, any> = {}): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const m of matches) {
    if (!m?.played || !isScored(m) || typeof m.name !== "string") continue;
    const prev = known[m.name];
    // A page read before with the same totals is the same result: not read again.
    if (prev && prev.red_score_total === m.red_score && prev.blue_score_total === m.blue_score) { out[m.name] = prev; continue; }
    // Small pages, read once each (later reads reuse them): a shorter pause keeps the first read near a minute.
    out[m.name] = await criGet(`/${encodeURIComponent(criSeason)}/events/${encodeURIComponent(slug)}/matches/${encodeURIComponent(m.name)}`, { pauseMs: 600 });
  }
  return out;
}

const isScored = (m: any) => m.phase === "qual" || m.phase === "playoff";
/** A finite number (ranking points are fractional), else null. */
const int = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const teamNo = (x: unknown): number | null => { const n = int(x); return n != null && n > 0 ? n : null; };

/** A match time as the venue's wall clock (FIRST's own format: no zone), or the site's text when it can't be read. */
export function venueTime(iso: string | null | undefined, timezone: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !timezone) return iso;
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const ms = String(new Date(t).getUTCMilliseconds()).padStart(3, "0");
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}`;
  } catch { return iso; }
}

/** One alliance's split from the match page; null without one (the total alone isn't a breakdown). */
export function criSplit(detail: any, side: "red" | "blue"): ScoreSplit | null {
  const s = detail?.[`${side}_score`];
  const total = int(detail?.[`${side}_score_total`]);
  if (!s || total == null) return null;
  const auto = int(s.auto) ?? 0, teleop = int(s.teleop) ?? 0, endgame = int(s.endgame) ?? 0, pen = int(s.penalty) ?? 0;
  return { total, np: auto + teleop + endgame, auto, teleop, endgame, pen };
}

/** Totals only (no match page): the split is unknown, so it is all TeleOp and marked as no breakdown. */
const totalOnly = (total: number): ScoreSplit => ({ total, np: total, auto: 0, teleop: total, endgame: 0, pen: 0 });

function side(teams: unknown, surrogate: unknown): MatchTeam[] {
  const list = Array.isArray(teams) ? teams : [];
  const sur = Array.isArray(surrogate) ? surrogate : [];
  return list.map((t, i) => ({ team: teamNo(t), i })).filter((x): x is { team: number; i: number } => x.team != null)
    .map(({ team, i }) => ({ team, station: i < 3 ? i + 1 : null, surrogate: !!sur[i], dq: false, onField: true }));
}

/**
 * Rank 1 is the best team. The site numbers some years from the bottom: when its rank 1 has fewer ranking points
 * than its last-ranked team, the numbers are turned around (its own tie order kept).
 */
export function criRanks(rankings: any[]): Map<number, number> {
  const rows = rankings.filter((r) => teamNo(r?.team) != null && int(r?.ranking) != null && r.ranking > 0).sort((a, b) => a.ranking - b.ranking);
  const out = new Map<number, number>();
  if (!rows.length) return out;
  const first = Number(rows[0].sort_order1), last = Number(rows[rows.length - 1].sort_order1);
  const flipped = Number.isFinite(first) && Number.isFinite(last) && first < last;
  rows.forEach((r, i) => out.set(r.team, flipped ? rows.length - i : i + 1));
  return out;
}

/** The award as Scout files it: FIRST's two alliance awards by their type, CRI's own awards by their name. */
export function criAwardType(name: string): string | null {
  const s = name.trim().replace(/^the\s+/i, "");
  if (!s) return null;
  if (/^winning alliance$/i.test(s) || /^winner/i.test(s)) return "Winner";
  if (/^finalist alliance$/i.test(s)) return "Finalist";
  return s;
}

/** Everything read for the event → the bundle written under FIRST's code for it (`meta`: Scout's stored row). */
export function bundleFromCri(raw: CriRaw, meta: EventRow): EventBundle {
  const tz = meta.timezone ?? raw.event.timezone ?? null;
  const matches: MatchRow[] = [];
  for (const m of raw.matches ?? []) {
    if (!isScored(m)) continue;
    const level: "qual" | "playoff" = m.phase === "qual" ? "qual" : "playoff";
    const series = level === "qual" ? 0 : int(m.series) ?? 0;
    const number = int(m.number);
    if (number == null) continue;
    const red = int(m.red_score), blue = int(m.blue_score);
    const played = !!m.played && red != null && blue != null;
    const d = played ? raw.details[m.name] : null;
    // A match page whose totals disagree with the list is from an earlier read: the list's totals win.
    const fits = d && int(d.red_score_total) === red && int(d.blue_score_total) === blue;
    const redScore = played ? (fits ? criSplit(d, "red") : null) ?? totalOnly(red!) : null;
    const blueScore = played ? (fits ? criSplit(d, "blue") : null) ?? totalOnly(blue!) : null;
    const time = venueTime(m.start ?? m.scheduled_start, tz);
    matches.push({
      level, series, number, label: matchLabel(level, series, number), description: null,
      time, scheduled: venueTime(m.scheduled_start, tz),
      played, red: side(m.red_alliance, m.red_surrogate), blue: side(m.blue_alliance, m.blue_surrogate),
      redScore, blueScore, breakdown: played ? !!(fits && criSplit(d, "red") && criSplit(d, "blue")) : undefined,
    });
  }
  matches.sort((a, b) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number);

  const ranks = criRanks(raw.rankings ?? []);
  const entries: EntryRow[] = [];
  const seen = new Set<number>();
  for (const r of raw.rankings ?? []) {
    const team = teamNo(r?.team);
    if (team == null || seen.has(team)) continue;
    seen.add(team);
    entries.push({
      team, rank: ranks.get(team) ?? null, rp: int(r.sort_order1), tbp: int(r.sort_order2),
      wins: int(r.record?.win), losses: int(r.record?.loss), ties: int(r.record?.tie), qualPlayed: int(r.matches_played), dq: null,
    });
  }
  // Listed or playing teams without a ranking still belong to the event.
  const unranked = (team: number): EntryRow => ({ team, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null, dq: null });
  for (const t of raw.teams ?? []) { const n = teamNo(t?.number); if (n != null && !seen.has(n)) { seen.add(n); entries.push(unranked(n)); } }
  for (const m of matches) for (const t of [...m.red, ...m.blue]) if (!seen.has(t.team)) { seen.add(t.team); entries.push(unranked(t.team)); }

  const alliances: AllianceRow[] = (raw.alliances?.alliances ?? []).filter((a) => int(a?.seed) != null && Array.isArray(a.teams)).map((a) => {
    const t = a.teams.map(teamNo);
    return { number: a.seed, name: `Alliance ${a.seed}`, captain: t[0] ?? null, pick1: t[1] ?? null, pick2: t[2] ?? null, backup: t[3] ?? null };
  });

  const awards: AwardRow[] = [];
  const awardSeen = new Set<string>();
  for (const a of raw.awards ?? []) {
    const name = String(a?.name ?? "").trim();
    const type = criAwardType(name);
    if (!type) continue;
    // An alliance award goes to every member alike; the site numbers its members in "place".
    const alliance = /alliance/i.test(name);
    for (const f of a.finalists ?? []) {
      const team = teamNo(f?.team_id);
      if (team == null) continue;
      const placement = alliance ? 1 : int(f.place) ?? 1;
      const key = `${type}|${placement}|${team}`;
      if (awardSeen.has(key)) continue;
      awardSeen.add(key);
      awards.push({ type, placement, team, name: name.replace(/^the\s+/i, "") });
    }
  }

  return {
    event: { ...meta, source: CRI_SOURCE, upstreamUpdated: null },
    teams: [],
    detail: { entries, matches, alliances, awards, advancement: undefined },
  };
}
