// What the bot says: Discord embeds built from the same views the site renders (src/shared/api.ts).
// Pure (no database, no Discord connection), so every wording rule is unit tested in views.test.ts.
// The site's rules hold here too: a prediction always shows its confidence tier, odds never read a
// flat 0% or 100% (oddsPct), and a logged-before-the-match call is never mixed up with a replayed one.
import type { APIEmbed, APIEmbedField } from "discord.js";
import type { EventDetail, FieldRow, MatchView, TeamProfile } from "../src/shared/api.js";
import type { RankingRow } from "../src/shared/rankings.js";
import { allianceText, oddsPct, tierWords } from "../src/shared/share.js";
import { matchReportHref } from "../src/shared/matchReport.js";

/** Volt (the site's accent, --color-accent) for answers; the site's danger red for errors. */
export const VOLT = 0xffc700;
export const DANGER = 0xfb7185;
export const FOOTER = { text: "Control Scout • controlscout.org" };

/** A problem the person can fix or should know about (unknown team, no schedule): shown as is. */
export class Friendly extends Error {
  constructor(readonly title: string, readonly detail: string) { super(`${title}: ${detail}`); }
}

export function errorEmbed(title: string, detail: string): APIEmbed {
  return { title, description: detail, color: DANGER, footer: FOOTER };
}

/** Anything else (the database is unreachable, a bug): never the exception's own words. */
export const unavailableEmbed = () => errorEmbed("Something went wrong", "Control Scout's data isn't reachable right now. Try again in a minute.");

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 25" from a YYYY-MM-DD date. */
export const shortDate = (d: string) => `${MONTH[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
/** "Oct 25", "Oct 25–26", "Oct 31 – Nov 1". */
export function dates(start: string | null, end: string | null): string {
  if (!start) return "Dates not posted";
  if (!end || end === start) return shortDate(start);
  return start.slice(0, 7) === end.slice(0, 7) ? `${shortDate(start)}–${Number(end.slice(8, 10))}` : `${shortDate(start)} – ${shortDate(end)}`;
}

const one = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, ""));
const place = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join(", ");
const record = (w: number | null | undefined, l: number | null | undefined, t: number | null | undefined) => `${w ?? 0}–${l ?? 0}–${t ?? 0}`;
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * A win chance as a ten-block bar and its percentage: `██████░░░░ 62%`. Until the match is decided the
 * bar keeps at least one block of each, like the percentage it stands for (never a flat 0% or 100%).
 */
export function winBar(p: number): string {
  const blocks = Math.min(9, Math.max(1, Math.round(p * 10)));
  return `${"█".repeat(blocks)}${"░".repeat(10 - blocks)} ${oddsPct(p)}`;
}

/** Movement against last week, as the rankings page shows it: ↑3, ↓1, — (no change), new. */
export function movement(move: RankingRow["move"]): string {
  if (move === "new") return "new";
  if (move == null || move === 0) return "—";
  return move > 0 ? `↑${move}` : `↓${-move}`;
}

// ---------------------------------------------------------------------------
// /team
// ---------------------------------------------------------------------------

export interface TeamCard {
  profile: TeamProfile;
  /** The season's label, "2025–26". */
  seasonLabel: string;
  /** Today (YYYY-MM-DD), to tell upcoming events from past ones. */
  today: string;
}

export function teamEmbed(c: TeamCard, site: string): APIEmbed {
  const { team, stats, events } = c.profile;
  const fields: APIEmbedField[] = [];
  const where = place(team.city, team.state, team.country);
  if (where) fields.push({ name: "Location", value: where, inline: true });
  if (stats) {
    fields.push({ name: `Record (${c.seasonLabel})`, value: record(stats.record.wins, stats.record.losses, stats.record.ties), inline: true });
    if (stats.rating?.rank) fields.push({ name: "World ranking", value: `#${stats.rating.rank.toLocaleString("en-US")} world`, inline: true });
    if (stats.opr.np.value != null) {
      fields.push({ name: "OPR", value: `**${one(stats.opr.np.value)}**${stats.opr.np.rank ? ` (#${stats.opr.np.rank.toLocaleString("en-US")} worldwide)` : ""}`, inline: true });
      fields.push({ name: "Auto / TeleOp / Endgame", value: `${one(stats.opr.auto.value)} / ${one(stats.opr.teleop.value)} / ${one(stats.opr.endgame.value)}`, inline: true });
    }
  } else {
    fields.push({ name: `Season ${c.seasonLabel}`, value: "No matches played yet this season.", inline: true });
  }
  const next = events.filter((e) => e.start && (e.end ?? e.start) >= c.today).sort((a, b) => a.start!.localeCompare(b.start!))[0];
  const last = [...events].reverse().find((e) => (e.qualPlayed ?? 0) > 0 || e.rank != null);
  if (next) {
    fields.push({ name: "Next event", value: `[${next.name}](${site}/events/${next.season}/${encodeURIComponent(next.code)}) · ${dates(next.start, next.end)}` });
  } else if (last) {
    const result = [last.rank != null ? `Rank ${last.rank}` : null, (last.qualPlayed ?? 0) > 0 ? record(last.wins, last.losses, last.ties) : null].filter(Boolean).join(", ");
    fields.push({ name: "Last event", value: `[${last.name}](${site}/events/${last.season}/${encodeURIComponent(last.code)}) · ${dates(last.start, last.end)}${result ? ` · ${result}` : ""}` });
  }
  return {
    title: clip(`#${team.number} — ${team.name ?? "Team name not listed"}`, 256),
    url: `${site}/teams/${team.number}`,
    color: VOLT,
    fields,
    footer: FOOTER,
  };
}

// ---------------------------------------------------------------------------
// /predict
// ---------------------------------------------------------------------------

const KIND: Record<string, string> = {
  live: "Called before the match",
  now: "From today's ratings",
  backtest: "Replayed call (walk-forward backtest), not logged before the match",
};

const teamsOf = (side: MatchView["red"], played: boolean) => (played && side.teams.some((t) => t.onField) ? side.teams.filter((t) => t.onField) : side.teams).map((t) => t.number);

/** The match's call in words (called / upset / tie), as the site's match rows say it. */
export function verdict(m: MatchView): { called: boolean | null; text: string } | null {
  const p = m.prediction;
  if (!p || !m.played || !m.red.score || !m.blue.score) return null;
  const red = m.red.score.total, blue = m.blue.score.total;
  if (red === blue) return { called: null, text: "Tie: no winner to call" };
  if (p.pRed === 0.5) return { called: null, text: "Even call: no favourite" };
  const called = (p.pRed > 0.5) === (red > blue);
  return { called, text: called ? "✅ Called it" : "❌ Upset" };
}

export function predictEmbed(d: Pick<EventDetail, "event">, m: MatchView, site: string): APIEmbed {
  const red = teamsOf(m.red, m.played), blue = teamsOf(m.blue, m.played);
  const p = m.prediction;
  const fields: APIEmbedField[] = [
    { name: "🔴 Red", value: allianceText(red) || "TBD", inline: true },
    { name: "🔵 Blue", value: allianceText(blue) || "TBD", inline: true },
  ];
  const score = p && !p.noScoreBasis ? `${Math.round(p.redMean)} – ${Math.round(p.blueMean)}` : null;
  if (m.played && m.red.score && m.blue.score) {
    const r = m.red.score.total, b = m.blue.score.total;
    fields.push({ name: "Final score", value: `Red ${r > b ? `**${r}**` : r} – ${b > r ? `**${b}**` : b} Blue` });
    if (p) {
      const fav = p.pRed === 0.5 ? `Even call (${oddsPct(0.5)} each)` : p.pRed > 0.5 ? `Red ${oddsPct(p.pRed)}` : `Blue ${oddsPct(1 - p.pRed)}`;
      fields.push({ name: "Predicted", value: `${fav}${score ? ` · ${score}` : ""} · ${tierWords(p.tier)}` });
      const v = verdict(m);
      if (v) fields.push({ name: "Verdict", value: v.text });
    } else {
      fields.push({ name: "Predicted", value: "No prediction was logged for this match." });
    }
  } else if (p) {
    fields.push({ name: "Red win", value: `\`${winBar(p.pRed)}\`` });
    fields.push({ name: "Blue win", value: `\`${winBar(1 - p.pRed)}\`` });
    if (score) fields.push({ name: "Predicted score", value: score, inline: true });
    fields.push({ name: "Confidence", value: tierWords(p.tier), inline: true });
  } else {
    fields.push({ name: "Prediction", value: "No prediction for this match yet." });
  }
  if (!m.played && m.time) fields.push({ name: "Scheduled", value: m.startsAt ? `<t:${Math.floor(Date.parse(m.startsAt) / 1000)}:t>` : m.time.slice(11, 16), inline: true });
  return {
    title: clip(`${d.event.name} · ${m.label}`, 256),
    url: `${site}${matchReportHref(m)}`,
    color: VOLT,
    fields,
    footer: { text: p ? `${KIND[p.kind] ?? ""} · ${FOOTER.text}` : FOOTER.text },
  };
}

// ---------------------------------------------------------------------------
// /event
// ---------------------------------------------------------------------------

const STATUS: Record<string, string> = { upcoming: "Upcoming", live: "🔴 Live", finished: "Finished" };

/** The top five by OPR at the event; before it has any, by the season OPR the teams bring to it. */
export function topByOpr(field: FieldRow[]): { rows: { team: number; name: string | null; opr: number }[]; season: boolean } {
  const pick = (v: (f: FieldRow) => number | null | undefined) => field
    .map((f) => ({ team: f.team, name: f.name, opr: v(f) }))
    .filter((r): r is { team: number; name: string | null; opr: number } => r.opr != null && Number.isFinite(r.opr))
    .sort((a, b) => b.opr - a.opr || a.team - b.team).slice(0, 5);
  const event = pick((f) => f.opr.np);
  return event.length ? { rows: event, season: false } : { rows: pick((f) => f.seasonOpr), season: true };
}

/**
 * Who won: the Winner award's teams; until FIRST posts awards (they can come after the last match), the
 * winner of the last playoff match played (the final decides the event), with its alliance's members.
 */
export function winningAlliance(d: Pick<EventDetail, "awards" | "alliances" | "matches">): { alliance: number | null; teams: number[] } | null {
  const allianceOf = (teams: number[]) => d.alliances.find((a) => [a.captain, a.pick1, a.pick2].some((t) => t != null && teams.includes(t)));
  const awarded = d.awards.filter((a) => a.type === "Winner").map((a) => a.team);
  if (awarded.length) return { alliance: allianceOf(awarded)?.number ?? null, teams: awarded };
  const finals = d.matches.filter((m) => m.level === "playoff" && m.played && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total)
    .sort((a, b) => a.series - b.series || a.number - b.number);
  const last = finals.at(-1);
  if (!last) return null;
  const side = last.red.score!.total > last.blue.score!.total ? last.red : last.blue;
  const played = teamsOf(side, true);
  const a = allianceOf(played);
  const members = a ? [a.captain, a.pick1, a.pick2].filter((t): t is number => t != null) : played;
  return { alliance: a?.number ?? null, teams: members };
}

export function eventEmbed(d: EventDetail, site: string): APIEmbed {
  const e = d.event;
  const fields: APIEmbedField[] = [
    { name: "Status", value: STATUS[e.status] ?? e.status, inline: true },
    { name: "Matches played", value: e.matchesTotal ? `${e.matchesPlayed} of ${e.matchesTotal}` : "Schedule not posted yet", inline: true },
    { name: "Teams", value: String(d.field.length || e.teams), inline: true },
  ];
  const top = topByOpr(d.field);
  if (top.rows.length) {
    fields.push({
      name: top.season ? "Top 5 by season OPR" : "Top 5 by OPR",
      value: top.rows.map((r, i) => `${i + 1}. [${r.team}](${site}/teams/${r.team}) ${clip(r.name ?? "", 40)} · **${one(r.opr)}**`).join("\n"),
    });
  }
  if (e.status === "finished") {
    const w = winningAlliance(d);
    if (w) fields.push({ name: "Winning alliance", value: `${w.alliance ? `Alliance ${w.alliance}: ` : ""}${allianceText(w.teams)}` });
  }
  return {
    title: clip(e.name, 256),
    url: `${site}/events/${e.season}/${encodeURIComponent(e.code)}`,
    description: [dates(e.start, e.end), place(e.city, e.state, e.country), e.code].filter(Boolean).join(" · "),
    color: VOLT,
    fields,
    footer: FOOTER,
  };
}

// ---------------------------------------------------------------------------
// /rankings
// ---------------------------------------------------------------------------

export function rankingsEmbed(rows: RankingRow[], seasonLabel: string, site: string): APIEmbed {
  return {
    title: `World rankings · ${seasonLabel}`,
    url: `${site}/rankings`,
    description: rows.slice(0, 10).map((r) => `**${r.rank}.** \`${movement(r.move).padEnd(3)}\` [${r.team}](${site}/teams/${r.team}) ${clip(r.name ?? "", 40)} · **${r.rating.toFixed(1)}**`).join("\n"),
    color: VOLT,
    footer: { text: `Movement vs last week · rating = points a robot adds per match · ${FOOTER.text}` },
  };
}
