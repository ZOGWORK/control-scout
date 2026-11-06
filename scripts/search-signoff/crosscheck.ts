// Numbers on the card against the team page's own API, fetched at test time (never numbers written in a file).
// Checks the headline of the answers the team page also shows: season OPR, rating, record, and a team's record at
// one event. Anything else is left to the grade (kind, filters), and the check says it wasn't compared.
import type { Live } from "./grade.js";

type TeamEvent = { season: number; code: string; wins: number | null; losses: number | null; ties: number | null; opr: { np: number | null } };
type TeamPage = { stats: { opr?: { np?: { value: number } }; rating?: { np: number }; record?: { wins: number; losses: number; ties: number } } | null; events: TeamEvent[] };

const pages = new Map<string, Promise<TeamPage | null>>();
export function teamPage(base: string, team: number, season: number): Promise<TeamPage | null> {
  const k = `${team}:${season}`;
  if (!pages.has(k)) pages.set(k, fetch(`${base}/api/teams/${team}?season=${season}`, { headers: { "user-agent": "cs-signoff" } })
    .then((r) => (r.ok ? (r.json() as Promise<TeamPage>) : null)).catch(() => null));
  return pages.get(k)!;
}

/** The season the answer is about: the reading's season, else the first season chip ("2025–26" → 2025). */
export function answerSeason(r: Live & { understood?: { season?: number } | null }): number | null {
  if (r.understood && typeof r.understood.season === "number") return r.understood.season;
  for (const s of r.stat?.scope ?? []) { const m = s.match(/\b(20\d\d)[–-]\d\d\b/); if (m) return +m[1]; }
  return null;
}

const num = (s: string | undefined) => { const m = s?.match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : null; };
const wlt = (s: string | undefined) => s?.match(/^(\d+)-(\d+)-(\d+)$/)?.slice(1).map(Number) ?? null;

export type Check = { compared: boolean; ok: boolean; note: string };

export async function crosscheck(base: string, r: Live): Promise<Check> {
  const s = r.stat, team = s?.team?.number, season = answerSeason(r);
  if (!s || !team || season == null || s.none || !s.headline?.value) return { compared: false, ok: true, note: "" };
  const page = await teamPage(base, team, season);
  if (!page) return { compared: false, ok: true, note: "team page unavailable" };
  const v = s.headline.value, st = page.stats;
  const near = (a: number | null, b: number | undefined, what: string): Check =>
    a == null || b == null ? { compared: false, ok: true, note: "" }
      : { compared: true, ok: Math.abs(a - b) < 0.06, note: Math.abs(a - b) < 0.06 ? "" : `${what} ${a} on the card, ${b.toFixed(1)} on the team page` };
  // A season's number only when the card covers the whole season: its one scope chip is the season, and its title
  // names no part of it (playoffs, a month, an event, a side). A filtered number is left to the grade.
  const whole = (title: RegExp) => (s.scope ?? []).length === 1 && /^20\d\d[–-]\d\d$/.test(s.scope![0]) && title.test(s.title ?? "");
  if (s.family === "stat" && s.intent === "opr" && whole(/^OPR in 20\d\d[–-]\d\d$/)) return near(num(v), st?.opr?.np?.value, "OPR");
  if (s.family === "stat" && s.intent === "rating" && whole(/^(?:Prediction )?[Rr]ating in 20\d\d[–-]\d\d$/)) return near(num(v), st?.rating?.np, "rating");
  const card = wlt(v);
  if (card && s.intent === "record" && whole(/^Record in 20\d\d[–-]\d\d$/)) {
    const t = st?.record;
    if (!t) return { compared: false, ok: true, note: "" };
    const ok = card[0] === t.wins && card[1] === t.losses && card[2] === t.ties;
    return { compared: true, ok, note: ok ? "" : `record ${v} on the card, ${t.wins}-${t.losses}-${t.ties} on the team page` };
  }
  // A team's results at events, or its record at one with nothing filtered out (no match type, no side).
  const atEvents = (s.family === "event" && s.intent === "results") || (s.intent === "record" && /^Record at /.test(s.title ?? "") && (s.scope ?? []).length === 1 && !/state championships/i.test(s.title ?? ""));
  if (card && atEvents) {
    // Every event the card links (a division and its finals, or several meets), summed as the team page lists them.
    const codes = new Set([...JSON.stringify(s).matchAll(new RegExp(`/events/${season}/([A-Z0-9]+)`, "g"))].map((m) => m[1]));
    const es = page.events.filter((x) => codes.has(x.code) && x.wins != null);
    if (!es.length) return { compared: false, ok: true, note: "" };
    const t = es.reduce((a, e) => [a[0] + e.wins!, a[1] + e.losses!, a[2] + e.ties!], [0, 0, 0]);
    const ok = card[0] === t[0] && card[1] === t[1] && card[2] === t[2];
    return { compared: true, ok, note: ok ? "" : `${es.map((e) => e.code).join("+")}: ${v} on the card, ${t.join("-")} on the team page` };
  }
  return { compared: false, ok: true, note: "" };
}
