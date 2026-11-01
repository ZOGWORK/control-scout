// Questions search answers directly (docs/search.md), by fixed rules and from the stored data only:
//   "when did hypnotic robotics go to worlds" / "did 4215 go to worlds in 2025"  → the team's Worlds appearances
//   "what events did hypnotic win"                                              → the events it won
//   "has bad wolf won anything"                                                 → every award it has won
//   "when is hypnotic's next event" / "… next match"                            → its next published event or match
// "Worlds" is the FIRST Championship: events.type = 'FIRSTChampionship' (FTCCMP1, its finals, and its divisions,
// FTCCMP1EDIS…), counted only where the team took part (api/teams.ts ATTENDED). Nothing found is said plainly
// ("No Worlds appearances found in recorded event history"), with the closest real records under it; a year, a
// season, an event or a date is never made up, and a next event or match is only one FIRST has published.
import type { SearchAnswer, SearchCard, SearchCardLine, SearchHit } from "../../src/shared/api.js";
import { awardLabel, dateRange, matchTime, place, seasonLabel } from "../../src/shared/format.js";
import { eventToday } from "../../src/shared/eventDay.js";
import { all } from "../db.js";
import { ROSTER } from "../data/registrations.js";
import { ATTENDED } from "./teams.js";

export type QuestionKind = SearchCard["kind"];

export interface ParsedQuestion {
  kind: QuestionKind;
  /** What names the team ("hypnotics robotics", "4215"). */
  core: string;
  /** "did hypnotic go to worlds in 2025": the year the championship was held in. */
  year: number | null;
}

const WORLDS = /\b(?:worlds?|world champ(?:ionships?|s)?|first champ(?:ionships?|s)?|houston champ(?:ionships?|s)?)\b/i;
// The question's own words, never part of a team's name here: what's left names the team.
const FRAME = /\b(?:when|whens|did|does|do|has|have|had|what|which|is|was|were|where|will|ever|go|goes|going|went|gone|been|get|got|make|made|qualify|qualified|attend|attended|compete|competed|play|played|to|the|at|in|for|a|an|any|their|its|team)\b/gi;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const coreOf = (s: string) => squash(s.replace(/['’]s\b/gi, " ").replace(FRAME, " "));

/** The question `q` asks, or null when it isn't one of these. */
export function parseQuestion(q: string): ParsedQuestion | null {
  const next = /\bnext\s+(match|game|event|competition|tournament|meet)\b/i.exec(q);
  if (next) {
    const core = coreOf(q.replace(next[0], " "));
    return core ? { kind: /match|game/i.test(next[1]) ? "next-match" : "next-event", core, year: null } : null;
  }
  if (WORLDS.test(q)) {
    // A year only as a date ("in 2025", "during 2024"): a bare 2000–2099 may be a team ("when did 2025 go to worlds").
    const y = /\b(?:in|during)\s+(20\d\d)\b/i.exec(q);
    const core = coreOf((y ? q.replace(y[0], " ") : q).replace(new RegExp(WORLDS.source, "gi"), " "));
    // A question needs its frame ("when did … go to worlds", "did … make worlds", "… worlds appearances"): "worlds"
    // on its own beside a name stays search's ("worlds" is the championship's events).
    const asked = /\b(?:when|did|does|has|have|was|were|go|went|make|made|qualif\w*|attend\w*|appearances?|history)\b/i.test(q);
    return core && asked ? { kind: "worlds", core: squash(core.replace(/\bappearances?\b|\bhistory\b/gi, " ")), year: y ? Number(y[1]) : null } : null;
  }
  const won = /\bwhat\s+(?:events?|tournaments?|competitions?|meets?)\s+(?:did|has|have)\s+(.+?)\s+(?:win|won)\b/i.exec(q);
  if (won) return coreOf(won[1]) ? { kind: "wins", core: coreOf(won[1]), year: null } : null;
  const any = /\b(?:has|have|did)\s+(.+?)\s+(?:ever\s+)?(?:won|win)\s+(?:anything|any\s*thing|any|awards?|an?\s+awards?|any\s+awards?|events?)\b/i.exec(q);
  if (any) return coreOf(any[1]) ? { kind: "awards", core: coreOf(any[1]), year: null } : null;
  return null;
}

const TITLE: Record<QuestionKind, string> = {
  worlds: "Worlds appearances", wins: "Event wins", awards: "Awards won", "next-event": "Next event", "next-match": "Next match",
};
/** Where on the team's page the answer's records are (src/shared/search.ts TOPIC_SECTION). */
const SECTION: Record<QuestionKind, SearchHit["section"]> = { worlds: "events", wins: "awards", awards: "awards", "next-event": "events", "next-match": "matches" };
const PATTERN: Record<QuestionKind, string> = {
  worlds: "when did [team] go to worlds", wins: "what events did [team] win", awards: "has [team] won anything",
  "next-event": "when is [team]'s next event", "next-match": "when is [team]'s next match",
};

const eventHref = (season: number, code: string, team?: number) => `/events/${season}/${encodeURIComponent(code)}${team ? `?team=${team}` : ""}`;
const rec = (w: number | null, l: number | null, t: number | null) => (w == null || l == null ? "" : `${w}-${l}-${t ?? 0} in quals`);
// An event's dates are its venue's calendar (src/shared/eventDay.ts): the query keeps everything that could still be on
// anywhere (from yesterday, UTC), then each event stays only while today at its venue is on or before its last day.
const yesterday = () => new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
const notEnded = (e: { start: string | null; end: string | null; timezone: string | null }) => (e.end ?? e.start ?? "") >= eventToday(Date.now(), e.timezone).from;

interface EvRow { season: number; code: string; name: string; start: string | null; end: string | null; city: string | null; state: string | null; rank: number | null; wins: number | null; losses: number | null; ties: number | null }
const EV_COLS = "e.season, e.code, e.name, e.start, e.end, e.city, e.state, et.rank, et.wins, et.losses, et.ties";

/** The team's awards at the given events ("season|code" → labels). */
async function awardsAt(team: number, events: { season: number; code: string }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!events.length) return out;
  const rows = await all<{ season: number; code: string; type: string; placement: number }>(
    `SELECT season, code, type, placement FROM awards WHERE team = ? AND (${events.map(() => "(season = ? AND code = ?)").join(" OR ")}) ORDER BY type = 'Winner' DESC, type = 'Finalist' DESC, placement`,
    [team, ...events.flatMap((e) => [e.season, e.code])]);
  for (const r of rows) { const k = `${r.season}|${r.code}`; out.set(k, [...(out.get(k) ?? []), awardLabel(r.type, Number(r.placement))]); }
  return out;
}

const eventLine = (team: number, e: EvRow, awards: string[] = []): SearchCardLine => ({
  text: e.name,
  detail: [seasonLabel(e.season), dateRange(e.start, e.end), place(e.city, e.state), e.rank ? `ranked #${e.rank}` : "", rec(e.wins, e.losses, e.ties), ...awards].filter(Boolean).join(" · "),
  href: eventHref(e.season, e.code, team),
});

/** The card for a question about `team` (its number and name). */
export async function questionCard(it: ParsedQuestion, team: { number: number; name: string | null }): Promise<SearchCard> {
  const n = team.number, who = team.name?.trim() || `Team ${n}`;
  const card: SearchCard = { kind: it.kind, title: TITLE[it.kind], team, lines: [] };

  if (it.kind === "worlds") {
    const rows = await all<EvRow>(
      `SELECT ${EV_COLS} FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
       WHERE et.team = ? AND e.type = 'FIRSTChampionship' AND ${ATTENDED} ORDER BY e.start, e.code`, [n]);
    // One line per championship: its division (where the team ranked), with the finals noted when it played them.
    const bySeason = new Map<number, EvRow[]>();
    for (const r of rows) bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r]);
    const awards = await awardsAt(n, rows);
    const all_ = [...bySeason.values()].map((evs) => {
      const division = evs.find((e) => e.rank != null && /division/i.test(e.name)) ?? evs.find((e) => /division/i.test(e.name)) ?? evs[0];
      const finals = evs.find((e) => e !== division && !/division/i.test(e.name));
      const line = eventLine(n, division, evs.flatMap((e) => awards.get(`${e.season}|${e.code}`) ?? []));
      return { year: Number((division.start ?? "").slice(0, 4)) || null, line: finals ? { ...line, detail: `${line.detail} · played the finals` } : line };
    });
    const asked = it.year != null ? all_.filter((x) => x.year === it.year) : all_;
    card.lines = asked.map((x) => x.line);
    if (!card.lines.length) {
      card.none = it.year != null
        ? `No Worlds appearance in ${it.year} found in ${who}'s recorded event history.`
        : `No Worlds appearances found in ${who}'s recorded event history.`;
      // Its other Worlds trips when a year was asked; else its state championships, the closest real results.
      if (all_.length) card.closest = all_.map((x) => x.line);
      else {
        const champs = await all<EvRow>(
          `SELECT ${EV_COLS} FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code
           WHERE et.team = ? AND e.type = 'Championship' AND ${ATTENDED} ORDER BY e.start DESC, e.code LIMIT 3`, [n]);
        const aw = await awardsAt(n, champs);
        card.closest = champs.map((e) => eventLine(n, e, aw.get(`${e.season}|${e.code}`)));
      }
    }
    return card;
  }

  if (it.kind === "wins" || it.kind === "awards") {
    const rows = await all<{ season: number; code: string; name: string; start: string | null; end: string | null; type: string; placement: number }>(
      `SELECT a.season, a.code, e.name, e.start, e.end, a.type, a.placement FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code
       WHERE a.team = ? ${it.kind === "wins" ? "AND a.type = 'Winner'" : ""} ORDER BY e.start DESC, a.code, a.type = 'Winner' DESC, a.placement`, [n]);
    card.lines = rows.map((r) => ({
      text: it.kind === "wins" ? `Won ${r.name}` : `${awardLabel(r.type, Number(r.placement))}: ${r.name}`,
      detail: [seasonLabel(r.season), dateRange(r.start, r.end), it.kind === "wins" ? "Winning Alliance" : ""].filter(Boolean).join(" · "),
      href: eventHref(r.season, r.code, n),
    }));
    if (!card.lines.length) {
      card.none = it.kind === "wins" ? `No event wins found in ${who}'s recorded history.` : `No awards found in ${who}'s recorded history.`;
      if (it.kind === "wins") {
        const other = await all<{ season: number; code: string; name: string; type: string; placement: number }>(
          "SELECT a.season, a.code, e.name, a.type, a.placement FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team = ? ORDER BY e.start DESC LIMIT 5", [n]);
        card.closest = other.map((r) => ({ text: `${awardLabel(r.type, Number(r.placement))}: ${r.name}`, detail: seasonLabel(r.season), href: eventHref(r.season, r.code, n) }));
      }
    }
    return card;
  }

  if (it.kind === "next-match") {
    // A match FIRST has scheduled and not yet played, at an event that hasn't ended.
    const m = (await all<{ season: number; code: string; level: string; series: number; number: number; label: string; time: string | null; name: string; alliance: string; start: string | null; end: string | null; timezone: string | null }>(
      `SELECT m.season, m.code, m.level, m.series, m.number, m.label, m.time, e.name, x.alliance, e.start, e.end, e.timezone
       FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
       JOIN events e ON e.season = m.season AND e.code = m.code
       WHERE x.team = ? AND m.played = 0 AND COALESCE(e.end, e.start) >= ? ORDER BY m.time IS NULL, m.time, m.level = 'qual' DESC, m.series, m.number LIMIT 20`, [n, yesterday()])).filter(notEnded);
    if (m[0]) {
      const r = m[0];
      card.lines = [{ text: `${r.label} at ${r.name}`, detail: [matchTime(r.time), `${r.alliance[0].toUpperCase()}${r.alliance.slice(1)} alliance`].filter(Boolean).join(" · "), href: `/events/${r.season}/${encodeURIComponent(r.code)}?match=${r.level}:${r.series}:${r.number}` }];
      return card;
    }
    card.none = `No upcoming match is scheduled for ${who} yet: match lists are published at the event.`;
    card.closest = await nextEvents(n);
    return card;
  }

  card.lines = await nextEvents(n);
  if (!card.lines.length) card.none = `No upcoming event is published for ${who} yet.`;
  return card;
}

/** The team's published events that haven't ended, soonest first (a registration counts: it's FIRST's own list). */
async function nextEvents(n: number): Promise<SearchCardLine[]> {
  const rows = (await all<{ season: number; code: string; name: string; start: string | null; end: string | null; city: string | null; state: string | null; timezone: string | null }>(
    `SELECT DISTINCT e.season, e.code, e.name, e.start, e.end, e.city, e.state, e.timezone FROM ${ROSTER} et JOIN events e ON e.season = et.season AND e.code = et.code
     WHERE et.team = ? AND COALESCE(e.end, e.start) >= ? ORDER BY e.start, e.code LIMIT 10`, [n, yesterday()])).filter(notEnded).slice(0, 3);
  return rows.map((e) => ({ text: e.name, detail: [dateRange(e.start, e.end), place(e.city, e.state)].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, n) }));
}

/** The answer for a question: the team found for its core (`team`, from search), the card, and the rest of search's hits. */
export async function questionAnswer(q: string, it: ParsedQuestion, team: SearchHit, rest: SearchHit[], pages: SearchAnswer["pages"]): Promise<SearchAnswer> {
  const name = team.title.replace(/^\d+\s*/, "").trim() || null;
  const card = await questionCard(it, { number: Number(team.ref), name });
  const top: SearchHit = { ...team, section: SECTION[it.kind], facts: undefined, events: undefined };
  return {
    q, hits: [top, ...rest.filter((h) => !(h.kind === "team" && h.ref === team.ref))], pages, step: "deterministic", weak: false, card,
    intent: { kind: `question-${it.kind}`, pattern: PATTERN[it.kind], met: true, understood: [`Team ${team.title}`, `Their ${TITLE[it.kind].toLowerCase()}${it.year != null ? ` in ${it.year}` : ""}`] },
  };
}
