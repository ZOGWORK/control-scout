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
import { FOOTER, VOLT, dates } from "./views.js";
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
const bold = (teams: number[]) => teams.map((t) => `**${t}**`).join(" & ");
const num1 = (x: number | null) => (x == null ? "—" : (Math.round(x * 10) / 10).toFixed(1));

export function eveEmbed(due: EventDue, d: EventDetail, seasons: TeamSeason[], site: string): APIEmbed {
  const e = d.event;
  const strongest = d.field.filter((f) => f.rating).sort((a, b) => b.rating!.np - a.rating!.np || a.team - b.team).slice(0, 3);
  return {
    title: `Tomorrow: ${e.name}`,
    url: eventUrl(d, site),
    description: `${bold(due.teams)} ${due.teams.length > 1 ? "compete" : "competes"} tomorrow.`,
    color: VOLT,
    fields: [
      { name: "When", value: dates(e.start, e.end), inline: true },
      { name: "Where", value: [e.venue, e.city, e.state].filter(Boolean).join(", ") || "Not posted", inline: true },
      { name: "Teams", value: String(d.field.length || e.teams), inline: true },
      ...seasons.map((s) => ({ name: `${s.team}${s.name ? ` ${s.name}` : ""}`, value: `Season OPR **${num1(s.opr)}**${s.worldRank ? ` · #${s.worldRank.toLocaleString("en-US")} world` : ""}` })),
      ...(strongest.length ? [{ name: "Strongest there", value: strongest.map((f) => `${f.team}${f.name ? ` ${f.name}` : ""} · ${f.rating!.np.toFixed(1)}`).join("\n") }] : []),
    ],
    footer: { text: `The schedule posts here once FIRST publishes it · ${FOOTER.text}` },
  };
}

export function scheduleEmbed(due: EventDue, d: EventDetail, site: string): APIEmbed {
  const zone = d.event.timezone ?? null;
  const fields = due.teams.map((t) => {
    const quals = d.matches.filter((m) => m.level === "qual" && teamsOf(m).includes(t));
    const lines = quals.slice(0, 15).map((m) => {
      const red = m.red.teams.some((x) => x.number === t);
      const p = m.prediction;
      const odds = p ? ` · ${oddsPct(red ? p.pRed : 1 - p.pRed)} to win` : "";
      const partner = (red ? m.red : m.blue).teams.map((x) => x.number).filter((n) => n !== t).join(" & ");
      return `**${m.label}** ${clock(m, zone)} · ${red ? "red" : "blue"}${partner ? ` with ${partner}` : ""}${odds}`;
    });
    if (quals.length > 15) lines.push(`…and ${quals.length - 15} more`);
    return { name: `${t}: ${quals.length} qualification match${quals.length === 1 ? "" : "es"}`, value: lines.join("\n") || "None posted yet." };
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
    const calls = todays.filter((m) => m.prediction?.kind === "live" && m.prediction.pRed !== 0.5 && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total);
    const right = calls.filter((m) => (m.prediction!.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total)).length;
    const parts = [
      row?.rank != null ? `Rank **${row.rank}** of ${d.field.length}` : null,
      // A record the source hasn't reported is left out, never shown as 0–0–0.
      row && row.wins != null && row.losses != null ? `${row.wins}–${row.losses}–${row.ties ?? 0}` : null,
      `${todays.length} match${todays.length === 1 ? "" : "es"} today`,
      calls.length ? `live calls right: ${right} of ${calls.length}` : null,
    ].filter(Boolean);
    return { name: `${t}${row?.name ? ` ${row.name}` : ""}`, value: parts.join(" · ") };
  });
  return {
    title: `Day recap: ${d.event.name}`,
    url: eventUrl(d, site),
    color: VOLT,
    fields,
    footer: FOOTER,
  };
}
