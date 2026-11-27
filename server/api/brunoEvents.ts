// What Bruno knows about each event a Discord message is about, as labelled lines beside the team blocks
// (server/api/brunoDossier.ts). The 2026-11-26 audit asked about events and got nothing to answer from, since search
// resolves a team or a page, not "NJ States":
//   - Q68 "compare the Ohio State Qualifier v Lake Erie League Meet": no event facts at all;
//   - Q74 "how many teams in New Jersey: Worlds 2025 against Worlds 2026": no Worlds counts;
//   - Q76 "who should 24033 pick at NJ States", Q85 "what if 4215 allied with 6980 at NJ States, who wins",
//     Q87 "rank the teams at NJ States by auto OPR in a table": only one team's numbers;
//   - Q88 "who should I watch at the next NJ meet and why": no next meet;
//   - Q92 "which teams at NJ States have never been to Worlds": no Worlds history.
// So an event the message names — by its own name, as "<state> States" / "<state> championship", "the next <state>
// meet", or "Worlds" (with its year when one is said) — brings its block: what and when it is, its scores, every team
// there with its event OPR and phases (or, before it is played, its season OPR so far), and who there has been to
// Worlds. A championship with divisions is read whole: the parent and every division.
import { all } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { fixed } from "../../src/shared/format.js";
import { regionNamed, stateName } from "../../src/shared/regions.js";
import { opr, seasonWord, splitLine } from "./brunoDossier.js";

interface EventRow { season: number; code: string; name: string; type: string | null; division_code: string | null; league: string | null; region: string | null; city: string | null; state: string | null; country: string | null; start: string | null; end: string | null }
const EVENT_COLS = "season, code, name, type, division_code, league, region, city, state, country, start, end";
/** Events nobody asks a question about: practice, kickoff and volunteer days. */
const NOT_PLAYED_TYPES = "('Scrimmage', 'Kickoff', 'DemoExhibition', 'VolunteerSignup')";
/** At most this many events a message brings, and this many teams an event lists (a Worlds is 300+). */
const MAX_EVENTS = 3;
const MAX_TEAMS = 90;

const today = (now: number) => new Date(now).toISOString().slice(0, 10);
const kindWord = (t: string | null) =>
  t === "FIRSTChampionship" ? "FIRST Championship (Worlds)" : (t ?? "event").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** State codes that are also everyday words: read as a state only when typed in capitals. */
const WORD_CODES = new Set(["IN", "ME", "OR", "HI", "OK", "OH", "DE", "CO", "MA", "AL", "ID", "LA", "PA", "MO", "GA", "AS"]);

/** A state a message names: by name ("new jersey", "ohio") or, beside an event word, by its code ("nj states"). */
function stateIn(q: string): string | null {
  const words = q.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const r = regionNamed(words.slice(i, i + n).join(" "));
      if (r && r.country === "USA") return r.state;
    }
  }
  for (const code of q.matchAll(/\b([A-Za-z]{2})\s+(?:states?|state\s+championship|championship|cmp|meets?|league|qualifiers?|events?|teams?)\b/gi)) {
    const upper = code[1].toUpperCase();
    // "who won in championship", "show me events", "red or blue teams": a word, unless typed as a code ("IN states").
    if (WORD_CODES.has(upper) && code[1] !== upper) continue;
    if (stateName("US", upper) !== upper) return upper;
  }
  return null;
}

/** The championship events of a state, newest first: parents only, the divisions are read with them. */
async function stateChampionships(state: string): Promise<EventRow[]> {
  return all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE state = ? AND country = 'USA' AND type = 'Championship' AND division_code IS NULL AND season >= ? ORDER BY season DESC`, [state, CURRENT_SEASON - 2]);
}

/** Has any match of the event (or its divisions) been played? */
async function played(e: EventRow): Promise<boolean> {
  const r = await all<{ n: number }>("SELECT COUNT(*) n FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE m.season = ? AND (m.code = ? OR e.division_code = ?) AND m.played = 1", [e.season, e.code, e.code]);
  return Number(r[0]?.n ?? 0) > 0;
}

/** The latest of these events that has been played, and the next one still ahead when it is a different one. */
async function latestAndNext(rows: EventRow[], now: number): Promise<EventRow[]> {
  const out: EventRow[] = [];
  for (const e of rows) { if (await played(e)) { out.push(e); break; } }
  const ahead = rows.filter((e) => (e.end ?? e.start ?? "") >= today(now)).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))[0];
  if (ahead && !out.some((e) => e.season === ahead.season && e.code === ahead.code)) out.push(ahead);
  return out;
}

/** Words an event's name has that every event of its kind has too: they don't tell one event from another. */
const GENERIC = new Set(["the", "of", "and", "a", "at", "in", "ftc", "first", "tech", "challenge", "league", "meet", "qualifier", "championship", "tournament", "division", "event", "state", "regional", "super", "premier", "interleague", "inter", "cmp", "lt", "day", "1", "2", "3", "4", "5", "6", "7", "8"]);
const words = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** Events whose own name the message says: every distinctive word of the name, and its kind word when it has one
 *  ("lake erie league meet", "ohio state qualifier", "central ohio league meet 2"). */
async function byName(q: string): Promise<EventRow[]> {
  const said = new Set(words(q));
  const rows = await all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE season >= ? AND type NOT IN ${NOT_PLAYED_TYPES} AND division_code IS NULL`, [CURRENT_SEASON - 1]);
  const scored: { e: EventRow; score: number }[] = [];
  for (const e of rows) {
    const w = words(e.name);
    const own = w.filter((x) => !GENERIC.has(x));
    if (!own.length || !own.every((x) => said.has(x))) continue;
    const kind = w.filter((x) => ["meet", "qualifier", "championship", "tournament"].includes(x));
    if (kind.length && !kind.some((x) => said.has(x))) continue;
    const num = w.find((x) => /^\d$/.test(x));
    if (num && !said.has(num)) continue;
    scored.push({ e, score: own.length * 2 + kind.length + (num ? 1 : 0) });
  }
  // The most specific name wins; the same name in two seasons keeps the newer one that has been played.
  scored.sort((a, b) => b.score - a.score || b.e.season - a.e.season);
  const out: EventRow[] = [];
  for (const { e, score } of scored) {
    if (score < scored[0].score) break;
    const same = out.find((x) => x.name === e.name);
    if (same) { if (!(await played(same)) && (await played(e))) out.splice(out.indexOf(same), 1, e); continue; }
    out.push(e);
  }
  return out;
}

/** The years a message says beside "worlds": "worlds 2025", "2025 worlds", "worlds in 2025". A number anywhere else
 *  is a team ("how did 2024 do at worlds" is team 2024), never a year. */
function worldsYears(q: string): number[] {
  const W = String.raw`(?:worlds|world\s+championships?|first\s+championship|world\s+champs?)`;
  return [...q.matchAll(new RegExp(String.raw`\b${W}\s+(?:in\s+|of\s+)?(20\d{2})\b|\b(20\d{2})(?:'s)?\s+${W}\b`, "gi"))].map((m) => Number(m[1] ?? m[2]));
}

/** The FIRST Championships a message means: one per year it says beside "worlds" ("Worlds 2025" is the 2024–25
 *  season's, played in April 2025), or the latest played one. */
async function worlds(q: string, now: number): Promise<EventRow[]> {
  const rows = await all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE type = 'FIRSTChampionship' AND division_code IS NULL ORDER BY season DESC`);
  const years = worldsYears(q);
  if (years.length) return rows.filter((e) => years.some((y) => Number((e.start ?? "").slice(0, 4)) === y));
  return latestAndNext(rows, now).then((r) => r.slice(0, 1));
}

/** The events a message names, at most three, each once. */
export async function namedEvents(q: string, now = Date.now()): Promise<EventRow[]> {
  const found: EventRow[] = [];
  const add = (rows: EventRow[]) => { for (const e of rows) if (!found.some((x) => x.season === e.season && x.code === e.code)) found.push(e); };
  const state = stateIn(q);
  const champs = !!state && /\b(?:states|state\s+championship|state\s+champs?|championship|cmp)\b/i.test(q);
  // "Teams at NJ States who have never been to Worlds" asks about NJ States: Worlds is what each team's line says, not
  // an event to list. A Worlds said with its year, or without a state championship, is one.
  const saysWorlds = /\b(?:worlds|world\s+championship|first\s+championship|world\s+champs?)\b/i.test(q);
  if (saysWorlds && (!champs || worldsYears(q).length)) add(await worlds(q, now));
  if (state) {
    if (/\bnext\b[^.?!]{0,30}\b(?:meet|event|qualifier|competition|tournament)\b/i.test(q)) {
      add(await all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE state = ? AND country = 'USA' AND type NOT IN ${NOT_PLAYED_TYPES} AND division_code IS NULL AND COALESCE(end, start) >= ? ORDER BY start LIMIT 1`, [state, today(now)]));
    }
    if (champs) add(await latestAndNext(await stateChampionships(state), now));
  }
  add(await byName(q));
  return found.slice(0, MAX_EVENTS);
}

interface TeamAt { team: number; name: string | null; state: string | null; country: string | null; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; rank: number | null; wins: number | null; losses: number | null; ties: number | null; division: string | null }

/** One event's block: what and when, its scores, every team there with its numbers, and who has been to Worlds. */
export async function eventDossier(e: EventRow): Promise<string[]> {
  const label = `${e.name}, ${seasonWord(e.season)}`;
  const divisions = await all<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE season = ? AND division_code = ? ORDER BY name`, [e.season, e.code]);
  const codes = [e.code, ...divisions.map((d) => d.code)];
  const marks = codes.map(() => "?").join(", ");
  const short = (name: string) => name.replace(e.name, "").replace(/^\s*-\s*/, "").trim() || name;
  const scores = await all<{ played: number; total: number; avg: number | null; high: number | null }>(
    `SELECT SUM(played) played, COUNT(*) total,
            AVG(CASE WHEN played = 1 AND level = 'qual' THEN (red_total + blue_total) / 2.0 END) avg,
            MAX(CASE WHEN played = 1 THEN MAX(red_total, blue_total) END) high
       FROM matches WHERE season = ? AND code IN (${marks})`, [e.season, ...codes]);
  const s = scores[0] ?? { played: 0, total: 0, avg: null, high: null };
  const teams = await all<TeamAt>(
    `SELECT et.team, t.name, t.state, t.country, s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, et.rank, et.wins, et.losses, et.ties,
            CASE WHEN et.code = ? THEN NULL ELSE ev.name END division
       FROM event_teams et JOIN events ev ON ev.season = et.season AND ev.code = et.code
       LEFT JOIN teams t ON t.number = et.team
       LEFT JOIN team_event_stats s ON s.season = et.season AND s.code = et.code AND s.team = et.team
      WHERE et.season = ? AND et.code IN (${marks})`, [e.code, e.season, ...codes]);
  // A team listed at the parent and at its division is one team: its division's row has the numbers.
  const byTeam = new Map<number, TeamAt>();
  for (const t of teams) { const had = byTeam.get(Number(t.team)); if (!had || (had.opr_np == null && t.opr_np != null)) byTeam.set(Number(t.team), t); }
  // A league meet nobody has entered yet is played by its league's teams: "who should I watch at the next NJ meet"
  // reads them, said as the league's and not as entered.
  let leagueOnly = false;
  if (!byTeam.size && e.league && e.type === "LeagueMeet") {
    const league = await all<TeamAt>(
      `SELECT DISTINCT et.team, t.name, t.state, t.country, NULL opr_np, NULL opr_auto, NULL opr_teleop, NULL opr_endgame, NULL rank, NULL wins, NULL losses, NULL ties, NULL division
         FROM event_teams et JOIN events ev ON ev.season = et.season AND ev.code = et.code LEFT JOIN teams t ON t.number = et.team
        WHERE ev.season = ? AND ev.league = ? AND COALESCE(ev.region, '') = COALESCE(?, '')`, [e.season, e.league, e.region]);
    for (const t of league) byTeam.set(Number(t.team), t);
    leagueOnly = byTeam.size > 0;
  }
  const list = [...byTeam.values()];
  // Played is what the matches say; the list reads event OPRs only once they exist (an event mid-way, or just finished
  // before its OPRs are worked out, lists the teams by their season OPR so far instead, still said as played).
  const anyPlayed = Number(s.played ?? 0) > 0;
  const isPlayed = anyPlayed && list.some((t) => t.opr_np != null);

  const when = e.start ? (e.end && e.end !== e.start ? `${e.start} to ${e.end}` : e.start) : "date not set";
  const where = [e.city, e.state, e.country].filter(Boolean).join(", ");
  const out = [`${label}: a ${kindWord(e.type)}, ${when}${where ? `, in ${where}` : ""}. ${list.length} teams${divisions.length ? ` in ${divisions.length} divisions (${divisions.map((d) => short(d.name)).join(", ")})` : ""}. ${anyPlayed ? `${Number(s.played)} matches played${Number(s.played) < Number(s.total) ? ` of ${Number(s.total)} scheduled` : ""}; average alliance score in qualification ${s.avg == null ? "–" : fixed(s.avg)}, highest alliance score ${s.high ?? "–"}.${isPlayed ? "" : " Event OPRs aren't worked out yet."}` : "Not played yet."}`];

  if (e.type === "FIRSTChampionship") {
    // Where Worlds' teams are from, said first ("how many NJ teams were at Worlds" is read here, never counted by
    // hand), so a packet trimmed at its end keeps it.
    const from = new Map<string, number>();
    for (const t of list) { const k = t.country === "USA" && t.state ? stateName("US", t.state) : (t.country ?? "unknown"); from.set(k, (from.get(k) ?? 0) + 1); }
    out.push(...splitLine(`Teams at ${label} by home: US state, or country outside the USA`, [...from].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, c]) => `${k} ${c}`)));
  }

  if (isPlayed) {
    list.sort((a, b) => (b.opr_np ?? -1e9) - (a.opr_np ?? -1e9));
    const items = list.slice(0, MAX_TEAMS).map((t) => `${t.team}${t.name ? ` ${t.name.slice(0, 22)}` : ""} ${opr(t.opr_np)} (A ${opr(t.opr_auto)}, T ${opr(t.opr_teleop)}, E ${opr(t.opr_endgame)}), rank ${t.rank ?? "–"}${t.division ? ` in ${short(t.division)}` : ""}, ${t.wins ?? 0}-${t.losses ?? 0}-${t.ties ?? 0}`);
    out.push(...splitLine(`Teams at ${label} by event OPR${list.length > MAX_TEAMS ? ` (top ${MAX_TEAMS} of ${list.length})` : ""} — OPR (Auto, TeleOp, Endgame), rank there, record`, items));
    out.push(`To weigh a what-if alliance at ${e.name}, add its teams' event OPRs above (each is the points a team adds per match, before penalties) and compare the sums; say it's an estimate, since OPR can't see defence or how two robots fit.`);
  } else if (list.length) {
    const nums = list.map((t) => Number(t.team));
    const season = await all<{ team: number; opr_np: number | null; opr_auto: number | null; opr_teleop: number | null; opr_endgame: number | null; matches: number | null }>(
      `SELECT team, opr_np, opr_auto, opr_teleop, opr_endgame, matches FROM team_season_stats WHERE season = ? AND team IN (${nums.map(() => "?").join(", ")})`, [e.season, ...nums]);
    const by = new Map(season.map((r) => [Number(r.team), r]));
    list.sort((a, b) => (by.get(Number(b.team))?.opr_np ?? -1e9) - (by.get(Number(a.team))?.opr_np ?? -1e9));
    const items = list.slice(0, MAX_TEAMS).map((t) => { const r = by.get(Number(t.team)); return `${t.team}${t.name ? ` ${t.name.slice(0, 22)}` : ""} ${r?.matches ? `${opr(r.opr_np)} (A ${opr(r.opr_auto)}, T ${opr(r.opr_teleop)}, E ${opr(r.opr_endgame)})` : "no matches yet"}`; });
    out.push(...splitLine(`${leagueOnly ? `No teams are entered in ${label} yet; its league's teams` : `Teams entered in ${label}`}, by their ${seasonWord(e.season)} season OPR so far — OPR (Auto, TeleOp, Endgame)`, items));
  } else out.push(`${label} has no teams entered yet.`);

  if (e.type !== "FIRSTChampionship" && list.length) {
    const nums = list.map((t) => Number(t.team));
    const been = await all<{ team: number; season: number }>(
      `SELECT DISTINCT et.team, et.season FROM event_teams et JOIN events ev ON ev.season = et.season AND ev.code = et.code
        WHERE ev.type = 'FIRSTChampionship' AND et.team IN (${nums.map(() => "?").join(", ")}) ORDER BY et.season`, nums);
    const seasons = new Map<number, number[]>();
    for (const r of been) seasons.set(Number(r.team), [...(seasons.get(Number(r.team)) ?? []), Number(r.season)]);
    const at = nums.filter((t) => seasons.has(t)), never = nums.filter((t) => !seasons.has(t));
    out.push(...splitLine(`Teams at ${label} who have played at Worlds (the FIRST Championship), with the seasons`, at.length ? at.map((t) => `${t} (${seasons.get(t)!.map((x) => seasonWord(x).replace(/ \(.*\)$/, "")).join(", ")})`) : ["none"]));
    out.push(...splitLine(`Teams at ${label} who have never played at Worlds`, never.length ? never.map(String) : ["none — every team here has"]));
  }
  return out;
}
