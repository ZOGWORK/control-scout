// Event-level posts for followed teams (bot/follows.ts runs them on its minute tick, with the per-match ones):
//   eve       the evening before the team's event (from 4 pm at the venue): where, when, who's there, and the
//             team's season so far.
//   schedule  once the team's qualification matches are posted: each one with its time and win odds.
//   recap     at the end of each event day, once the team's matches that day are all scored (30 minutes after
//             its last): its record and rank at the event, and how many calls were right that day.
// Pure over the event's detail (the same one the event page reads), tested in eventAlerts.test.ts.
import type { APIEmbed } from "discord.js";
import type { EventDetail, MatchView } from "../src/shared/api.js";
import { localDate } from "../src/shared/eventDay.js";
import { oddsPct, tierWords } from "../src/shared/share.js";
import { FOOTER, VOLT, dates, favouriteOf, linkedAlliance, teamLink, teamsOf as sideTeams } from "./views.js";
import type { Follow } from "./follows.js";

export type EventKind = "eve" | "schedule" | "recap";
/** One post: a channel, the followed teams it's about, what kind, and its key in discord_posts (match_key). */
export interface EventDue { channel: string; teams: number[]; kind: EventKind; key: string }

/** From this hour at the venue the evening-before post goes out. */
export const EVE_HOUR = 16;
/** The day's recap waits this long after the team's last scored match that day. */
export const RECAP_AFTER_MS = 30 * 60_000;

const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
const teamsOf = (m: MatchView) => {
  const side = (s: MatchView["red"]) => (m.played && s.teams.some((t) => t.onField) ? s.teams.filter((t) => t.onField) : s.teams);
  return [...side(m.red), ...side(m.blue)].map((t) => t.number);
};

/** The calendar date and hour at the venue (UTC when its time zone is unknown). */
export function venueClock(now: number, zone: string | null): { date: string; hour: number } {
  const date = (zone && localDate(now, zone)) || new Date(now).toISOString().slice(0, 10);
  let hour = new Date(now).getUTCHours();
  if (zone) {
    try { hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(new Date(now))); } catch { /* unknown zone: UTC */ }
  }
  return { date, hour };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** A match's calendar date at the venue, or null without a time. */
const dayOf = (m: MatchView, zone: string | null) => (Number.isFinite(at(m)) ? venueClock(at(m), zone).date : null);

export function eventDue(follows: Follow[], d: EventDetail, now: number): EventDue[] {
  const e = d.event, zone = e.timezone ?? null;
  const { date: today, hour } = venueClock(now, zone);
  const here = new Set<number>([...d.field.map((f) => f.team), ...d.matches.flatMap(teamsOf)]);
  const out = new Map<string, EventDue>();
  const add = (f: Follow, kind: EventKind, key: string) => {
    const id = `${f.channel_id}|${kind}|${key}`;
    const x = out.get(id) ?? { channel: f.channel_id, teams: [], kind, key };
    if (!x.teams.includes(f.team)) x.teams.push(f.team);
    out.set(id, x);
  };
  for (const f of follows) {
    if (!here.has(f.team)) continue;
    const mine = d.matches.filter((m) => teamsOf(m).includes(f.team));
    // The evening before its first day.
    if (e.start && addDays(e.start, -1) === today && hour >= EVE_HOUR) add(f, "eve", "eve");
    // Its quals are posted (and the event isn't over). One post per team, so a channel following many teams
    // never builds one message past Discord's 6,000-character limit.
    if (e.status !== "finished" && mine.some((m) => m.level === "qual")) add(f, "schedule", `schedule:${f.team}`);
    // The end of an event day: it played today, nothing of its today is left, and its last match was a while ago.
    const todays = mine.filter((m) => dayOf(m, zone) === today);
    const last = Math.max(...todays.filter((m) => m.played).map(at));
    // One per team: teams in one channel finish their days at different times, and each gets its own.
    if (todays.length && todays.every((m) => m.played) && Number.isFinite(last) && now - last >= RECAP_AFTER_MS) add(f, "recap", `recap:${today}:${f.team}`);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The posts
// ---------------------------------------------------------------------------

export interface TeamSeason { team: number; name: string | null; opr: number | null; worldRank: number | null }

const clock = (m: MatchView, zone: string | null) => {
  if (Number.isFinite(at(m))) {
    try { return new Date(at(m)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }); } catch { /* below */ }
  }
  return m.time ? m.time.slice(11, 16) : "time TBA";
};
const eventUrl = (d: EventDetail, site: string) => `${site}/events/${d.event.season}/${encodeURIComponent(d.event.code)}`;
/** Discord's cap on one field's value. */
export const FIELD_MAX = 1024;
/** Schedule lines per team before "…and N more" (the character cap can cut sooner). */
export const SCHEDULE_MAX = 15;

/** Lines into one field value, never past `max` characters nor `cap` lines: the rest becomes "…and N more". */
export function clipLines(lines: string[], max = FIELD_MAX, cap = Infinity): string {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = (out.length ? 1 : 0) + lines[i].length;
    // Room for the "…and N more" line, whenever a line would still be left after this one.
    const left = lines.length - i - 1;
    const room = left > 0 ? 1 + `…and ${left} more`.length : 0;
    if (i >= cap || used + add + room > max) { out.push(`…and ${lines.length - i} more`); break; }
    out.push(lines[i]);
    used += add;
  }
  return out.join("\n");
}

/** A team's first unplayed qualification match (on one venue day, when given): "Q3 · 9:00 AM". */
function firstOn(d: EventDetail, team: number, date: string | null): string | null {
  const zone = d.event.timezone ?? null;
  const m = d.matches
    .filter((x) => x.level === "qual" && !x.played && teamsOf(x).includes(team) && Number.isFinite(at(x)) && (date == null || dayOf(x, zone) === date))
    .sort((a, b) => at(a) - at(b))[0];
  return m ? `${m.label} · ${clock(m, zone)}` : null;
}
const num1 = (x: number | null) => (x == null ? "—" : (Math.round(x * 10) / 10).toFixed(1));

export function eveEmbed(due: EventDue, d: EventDetail, seasons: TeamSeason[], site: string): APIEmbed {
  const e = d.event;
  const strongest = d.field.filter((f) => f.rating).sort((a, b) => b.rating!.np - a.rating!.np || a.team - b.team).slice(0, 3);
  return {
    title: `Tomorrow: ${e.name}`,
    url: eventUrl(d, site),
    description: `${linkedAlliance(due.teams, site)} ${due.teams.length > 1 ? "compete" : "competes"} tomorrow.`,
    color: VOLT,
    fields: [
      { name: "When", value: dates(e.start, e.end), inline: true },
      { name: "Where", value: [e.venue, e.city, e.state].filter(Boolean).join(", ") || "Not posted", inline: true },
      { name: "Teams", value: String(d.field.length || e.teams), inline: true },
      ...seasons.map((s) => {
        // Once the schedule is posted, the team's first match (nothing before it is).
        const first = firstOn(d, s.team, null);
        return { name: `${s.team}${s.name ? ` ${s.name}` : ""}`, value: `Season OPR **${num1(s.opr)}**${s.worldRank ? ` · #${s.worldRank.toLocaleString("en-US")} world` : ""}${first ? `\nFirst match: ${first}` : ""}` };
      }),
      ...(strongest.length ? [{ name: "Strongest there", value: strongest.map((f) => `${teamLink(f.team, site)}${f.name ? ` ${f.name}` : ""} · ${f.rating!.np.toFixed(1)}`).join("\n") }] : []),
    ],
    footer: { text: `${d.matches.some((m) => m.level === "qual") ? "" : "The schedule posts here once FIRST publishes it · "}${FOOTER.text}` },
  };
}

export function scheduleEmbed(due: EventDue, d: EventDetail, site: string): APIEmbed {
  const zone = d.event.timezone ?? null;
  const fields = due.teams.map((t) => {
    const quals = d.matches.filter((m) => m.level === "qual" && teamsOf(m).includes(t));
    // "**Q12** 4:30 PM · 🔵 with 23545 vs 23314 & 8902 · 54%": the team's side, partner, opponents and its chance.
    const lines = quals.map((m) => {
      const red = sideTeams(m.red, false).includes(t);
      const p = m.prediction;
      const odds = p ? ` · ${oddsPct(red ? p.pRed : 1 - p.pRed)}` : "";
      const partner = sideTeams(red ? m.red : m.blue, false).filter((n) => n !== t).join(" & ");
      const opp = sideTeams(red ? m.blue : m.red, false).join(" & ");
      return `**${m.label}** ${clock(m, zone)} · ${red ? "🔴" : "🔵"}${partner ? ` with ${partner}` : ""}${opp ? ` vs ${opp}` : ""}${odds}`;
    });
    return { name: `${t}: ${quals.length} qualification match${quals.length === 1 ? "" : "es"}`, value: clipLines(lines, FIELD_MAX, SCHEDULE_MAX) || "None posted yet." };
  });
  const tier = d.matches.find((m) => m.prediction)?.prediction?.tier;
  return {
    title: `Schedule posted: ${d.event.name}`,
    url: eventUrl(d, site),
    color: VOLT,
    fields,
    footer: { text: `${tier ? `Win odds from today's ratings, ${tierWords(tier)} · ` : ""}A post 15 minutes before each match · ${FOOTER.text}` },
  };
}

export function recapEmbed(due: EventDue, d: EventDetail, today: string, site: string): APIEmbed {
  const zone = d.event.timezone ?? null;
  const fields = due.teams.map((t) => {
    const row = d.field.find((f) => f.team === t);
    const todays = d.matches.filter((m) => m.played && teamsOf(m).includes(t) && dayOf(m, zone) === today);
    // Only calls logged before the match count: a replayed (backtest) one wasn't made beforehand.
    // An even call (45–55%) or a tie has no verdict, so it counts neither way.
    const calls = todays.filter((m) => m.prediction?.kind === "live" && favouriteOf(m.prediction) && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total);
    const right = calls.filter((m) => (favouriteOf(m.prediction!)!.side === "red") === (m.red.score!.total > m.blue.score!.total)).length;
    // A multi-day event: the team's first match tomorrow, once it's on the schedule.
    const tomorrow = d.event.end && d.event.end > today ? firstOn(d, t, addDays(today, 1)) : null;
    // At a league meet FIRST's rank is the league's running standing (it can be past the meet's team count): the
    // meet's own rank is the one "of N" here.
    const rank = row?.meet !== undefined ? row.meet?.rank ?? null : row?.rank ?? null;
    const parts = [
      rank != null ? `Rank **${rank}** of ${d.field.length}` : null,
      // A record the source hasn't reported is left out, never shown as 0–0–0.
      row && row.wins != null && row.losses != null ? `${row.wins}–${row.losses}–${row.ties ?? 0}` : null,
      `${todays.length} match${todays.length === 1 ? "" : "es"} today`,
      calls.length ? `Calls: ${right} of ${calls.length} right` : null,
    ].filter(Boolean);
    return { name: `${t}${row?.name ? ` ${row.name}` : ""}`, value: `${parts.join(" · ")}${tomorrow ? `\nTomorrow: first match ${tomorrow}` : ""}` };
  });
  return {
    title: `Day recap: ${d.event.name}`,
    url: eventUrl(d, site),
    color: VOLT,
    fields,
    footer: FOOTER,
  };
}
