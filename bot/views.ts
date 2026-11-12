// What the bot says: Discord embeds built from the same views the site renders (src/shared/api.ts).
// Pure (no database, no Discord connection), so every wording rule is unit tested in views.test.ts.
// The site's rules hold here too: a prediction always shows its confidence tier, odds never read a
// flat 0% or 100% (oddsPct), and a logged-before-the-match call is never mixed up with a replayed one.
import type { APIEmbed, APIEmbedField } from "discord.js";
import type { EventDetail, FieldRow, MatchView, TeamProfile } from "../src/shared/api.js";
import type { RankingRow } from "../src/shared/rankings.js";
import { oddsPct } from "../src/shared/share.js";
import { tierWord } from "../src/shared/tierWords.js";
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
// /predict, and the follow posts built on it (bot/follows.ts)
// ---------------------------------------------------------------------------
//
// One story, told once, in the description; no fields. A result is the score line (every team a link, the
// winner's score bold), the story (the call, predicted against actual) and where to go next. A pre-match post
// is the lineup and the call, with its confidence in plain words once. A live call (logged before the match)
// is the default and carries no label; the footer names only the exceptions, so a replayed (backtest) call is
// never mixed up with one logged beforehand.

/** Result colours: the followed team won (the site's success green), lost (the red alliance's rose, not the
 *  error colour), or tied (slate). Volt everywhere else. */
export const WIN = 0x34d399;
export const LOSS = 0xf43f5e;
export const TIE = 0x94a3b8;

/** The call's kind in the footer, only when it isn't a live call (logged before the match). */
const KIND: Record<string, string> = {
  now: "From today's ratings",
  backtest: "Replayed call",
};
const footerFor = (p: MatchView["prediction"]) => ({ text: p && KIND[p.kind] ? `${KIND[p.kind]} · ${FOOTER.text}` : FOOTER.text });

/** A team number as a link to its page. */
export const teamLink = (n: number, site: string) => `[${n}](${site}/teams/${n})`;
const joinAnd = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);
/** An alliance as linked team numbers, "[4215](…) & [23545](…)"; TBD when it isn't posted. */
export const linkedAlliance = (teams: readonly number[], site: string) => (teams.length ? joinAnd(teams.map((t) => teamLink(t, site))) : "TBD");
export const eventHref = (m: { season: number; code: string }, site: string) => `${site}/events/${m.season}/${encodeURIComponent(m.code)}`;

/** The robots on the field for a played match (a playoff alliance lists a third who may sit out), else everyone listed. */
export const teamsOf = (side: MatchView["red"], played: boolean) => (played && side.teams.some((t) => t.onField) ? side.teams.filter((t) => t.onField) : side.teams).map((t) => t.number);
const SIDE = { red: "Red", blue: "Blue" } as const;

/** A call has a favourite only when its chance reads 55% or more; inside 45–55% it's an even call. */
export const FAVOURITE_PCT = 55;

/** The favoured side and its chance, or null for an even call (a coin flip that loses is not an upset). */
export function favouriteOf(p: { pRed: number }): { side: "red" | "blue"; p: number } | null {
  const side = p.pRed >= 0.5 ? "red" : "blue";
  const q = side === "red" ? p.pRed : 1 - p.pRed;
  return Math.round(q * 100) >= FAVOURITE_PCT ? { side, p: q } : null;
}

type Prediction = NonNullable<MatchView["prediction"]>;
/** The predicted score as the story writes it, "97–93"; null when the season has nothing to base one on. */
export const predictedScore = (p: Prediction) => (p.noScoreBasis ? null : `${Math.round(p.redMean)}–${Math.round(p.blueMean)}`);

/** The predicted margin, "predicted Red by 4" (or "predicted level"); null without a score basis. */
function predictedMargin(p: Prediction): string | null {
  if (p.noScoreBasis) return null;
  const r = Math.round(p.redMean), b = Math.round(p.blueMean);
  return r === b ? "predicted level" : `predicted ${r > b ? "Red" : "Blue"} by ${Math.abs(r - b)}`;
}

/**
 * The match's call in words, wherever a verdict is shown: "Called it ✅" / "Upset ❌" for a favourite (55%+);
 * no verdict (called: null) for an even call or a tie; null before the match or without a logged call.
 */
export function verdict(m: MatchView): { called: boolean | null; text: string } | null {
  const p = m.prediction;
  if (!p || !m.played || !m.red.score || !m.blue.score) return null;
  const red = m.red.score.total, blue = m.blue.score.total;
  if (red === blue) return { called: null, text: "Tie" };
  const f = favouriteOf(p);
  if (!f) return { called: null, text: "Even call" };
  const called = (f.side === "red") === (red > blue);
  return { called, text: called ? "Called it ✅" : "Upset ❌" };
}

/** "🔴 [23314](…) & [8902](…) **81** – 65 [4215](…) & [23545](…) 🔵": the winner's score bold. */
export function scoreLine(m: MatchView, site: string): string {
  const r = m.red.score?.total ?? 0, b = m.blue.score?.total ?? 0;
  return `🔴 ${linkedAlliance(teamsOf(m.red, true), site)} ${r > b ? `**${r}**` : r} – ${b > r ? `**${b}**` : b} ${linkedAlliance(teamsOf(m.blue, true), site)} 🔵`;
}

/** The result's story in one line: the call, then predicted against actual. */
export function storyLine(m: MatchView): string {
  const r = m.red.score?.total ?? 0, b = m.blue.score?.total ?? 0;
  if (r === b) return `Tie at ${r} — no winner to call.`;
  const p = m.prediction;
  if (!p) return "No prediction was logged for this match.";
  const won = r > b ? "Red" : "Blue", by = Math.abs(r - b);
  const f = favouriteOf(p);
  if (!f) {
    const margin = predictedMargin(p);
    return `Even call — ${margin ? `${margin}, ` : ""}${won} won by ${by}.`;
  }
  const score = predictedScore(p), pct = oddsPct(f.p), fav = SIDE[f.side];
  const predicted = score ? ` (predicted ${score})` : "";
  return (f.side === "red") === (r > b)
    ? `Called it ✅ — ${fav} ${pct}${predicted}, won by ${by}.`
    : `Upset ❌ — ${fav} was ${pct}${predicted}, ${won} won by ${by}.`;
}

/** The pre-match call: "Blue 62% to win · predicted 97–93 · solid", or "Even call · predicted 97–93 · rough guess". */
export function callLine(p: MatchView["prediction"]): string {
  if (!p) return "No prediction for this match yet";
  const f = favouriteOf(p), score = predictedScore(p);
  return [f ? `${SIDE[f.side]} ${oddsPct(f.p)} to win` : "Even call", score ? `predicted ${score}` : null, tierWord(p.tier)].filter(Boolean).join(" · ");
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const matchTitle = (m: MatchView, eventName: string) => clip(`${m.label} · ${eventName}`, 256);

/** A followed team's outcome in a played match. */
export function outcomeFor(m: MatchView, team: number): "won" | "lost" | "tied" {
  const r = m.red.score?.total ?? 0, b = m.blue.score?.total ?? 0;
  if (r === b) return "tied";
  return teamsOf(m.red, m.played).includes(team) === r > b ? "won" : "lost";
}

/** The border: the followed teams' outcome when it's one clear outcome; volt when mixed or nobody's followed. */
export function resultColor(m: MatchView, followed: readonly number[]): number {
  if (!followed.length) return VOLT;
  const outs = new Set(followed.map((t) => outcomeFor(m, t)));
  if (outs.size > 1) return VOLT;
  return outs.has("won") ? WIN : outs.has("lost") ? LOSS : TIE;
}

export interface ResultOptions {
  /** The followed teams it's about (follow posts): they set the colour. */
  followed?: readonly number[];
  /** The followed team's next unplayed match at the event (named when the post is about more than one team).
   *  No next match, no line: never invented. */
  next?: { match: MatchView; team: number | null } | null;
}

/** "Next: Q21 · 5:10 PM · [Match](…) · [Event](…)"; just the event link when there's no next match. */
function nextLine(m: MatchView, site: string, next: ResultOptions["next"]): string {
  const ev = `[Event](${eventHref(m, site)})`;
  if (!next) return ev;
  const n = next.match;
  // A next match on another day shows its date too.
  const otherDay = m.startsAt && n.startsAt && Math.abs(Date.parse(n.startsAt) - Date.parse(m.startsAt)) > 12 * 3600_000;
  const when = n.startsAt ? ` · <t:${unix(n.startsAt)}:${otherDay ? "f" : "t"}>` : "";
  return `Next${next.team != null ? ` for ${next.team}` : ""}: ${n.label}${when} · [Match](${site}${matchReportHref(n)}) · ${ev}`;
}

/** A played match: the score line, the story, and what's next. No fields. */
export function resultEmbed(eventName: string, m: MatchView, site: string, o: ResultOptions = {}): APIEmbed {
  return {
    title: matchTitle(m, eventName),
    url: `${site}${matchReportHref(m)}`,
    description: [scoreLine(m, site), storyLine(m), nextLine(m, site, o.next)].join("\n"),
    color: resultColor(m, o.followed ?? []),
    footer: footerFor(m.prediction),
  };
}

/**
 * A match not played yet: a lead line (the follow reminder's side and time; /predict's start when known), then
 * the lineup and the call. No fields, no win bars.
 */
export function preMatchEmbed(eventName: string, m: MatchView, site: string, lead?: string | null): APIEmbed {
  const starts = m.startsAt ? `Starts <t:${unix(m.startsAt)}:R> (<t:${unix(m.startsAt)}:t>).` : m.time ? `Scheduled ${m.time.slice(11, 16)}.` : null;
  const lineup = `🔴 ${linkedAlliance(teamsOf(m.red, false), site)} vs ${linkedAlliance(teamsOf(m.blue, false), site)} 🔵 · ${callLine(m.prediction)}`;
  return {
    title: matchTitle(m, eventName),
    url: `${site}${matchReportHref(m)}`,
    description: [lead === undefined ? starts : lead, lineup].filter(Boolean).join("\n"),
    color: VOLT,
    footer: footerFor(m.prediction),
  };
}

/** /predict: the result design once played, the pre-match design before. */
export function predictEmbed(d: Pick<EventDetail, "event">, m: MatchView, site: string): APIEmbed {
  return m.played && m.red.score && m.blue.score ? resultEmbed(d.event.name, m, site) : preMatchEmbed(d.event.name, m, site);
}

/** How tall an embed renders: its title, each description line and each field (the footer isn't counted). */
export function embedBlocks(e: APIEmbed): number {
  return (e.title ? 1 : 0) + (e.description ? e.description.split("\n").length : 0) + (e.fields?.length ?? 0);
}

/** The characters a reader sees: a link counts as its text, a timestamp as the time it shows. */
export function embedReadChars(e: APIEmbed): number {
  const seen = (s = "") => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<t:\d+:R>/g, "in 15 minutes").replace(/<t:\d+:[tf]>/g, "10:00 AM").replace(/\*\*/g, "");
  return seen(e.title).length + seen(e.description).length + (e.fields ?? []).reduce((n, f) => n + seen(f.name).length + seen(f.value).length, 0) + seen(e.footer?.text).length;
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
 * Who won: the Winner award's teams, as the event page says it. Nothing until FIRST posts awards: a
 * finished status alone doesn't prove the final was decided (it can mean every posted match is scored,
 * or the end date passed), so the last playoff match is never taken for the championship.
 */
export function winningAlliance(d: Pick<EventDetail, "awards" | "alliances">): { alliance: number | null; teams: number[] } | null {
  const awarded = d.awards.filter((a) => a.type === "Winner").map((a) => a.team);
  if (!awarded.length) return null;
  const alliance = d.alliances.find((a) => [a.captain, a.pick1, a.pick2].some((t) => t != null && awarded.includes(t)));
  return { alliance: alliance?.number ?? null, teams: awarded };
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
    fields.push({ name: "Winning alliance", value: w ? `${w.alliance ? `Alliance ${w.alliance}: ` : ""}${linkedAlliance(w.teams, site)}` : "Not posted yet (it comes with the awards)" });
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
