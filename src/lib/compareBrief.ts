// The Compare brief: short, rule-based sentences built from the Compare data the page already has. No model,
// no prediction: every number is one the table, the charts or the head-to-head list shows (or a difference of
// two of them, taken from the rounded values shown), and every sentence links to the events or matches behind it.
//
// Rules (constants below, so tests can pin them):
// - A team with fewer than BRIEF.minMatches matches this season is left out of the OPR comparisons, and the
//   brief says so plainly. OPR from a handful of matches is mostly noise.
// - Differences under BRIEF.levelPoints (after rounding) read as level, not as one team ahead.
// - Consistency needs BRIEF.minEvents events with an OPR; the trend compares a team's first and latest of them.
// - Never "will win", "better team" or anything guaranteed: the brief only describes what has happened.
// Phases are season-blind: auto / TeleOp / endgame as the server maps each season's score breakdown
// (server/data/seasons.ts), the same split the table shows.
import type { CompareTeam, CompareView, MatchView } from "../shared/api";
import { num, seasonLabel } from "./format";

export const BRIEF = {
  /** Matches a team needs this season before its OPR is compared. */
  minMatches: 5,
  /** Gaps smaller than this (in points, after rounding) are called level. */
  levelPoints: 1,
  /** Events with an OPR a team needs before its consistency or trend is described. */
  minEvents: 2,
  /** Most head-to-head matches linked from one sentence. */
  maxMatchLinks: 6,
} as const;

/** Phrases the brief must never use: it reports results, it never calls a winner. */
export const WINNER_WORDS = /\b(will win|would win|wins? for sure|guarantee\w*|certain(ly)?|definitely|lock|unbeatable|better team|best team|favou?rite)\b/i;

export type BriefTopic = "Sample size" | "Overall" | "Auto" | "TeleOp" | "Endgame" | "Consistency" | "Recency" | "Head to head";
export interface BriefSource { label: string; href: string }
export interface BriefSentence {
  topic: BriefTopic;
  text: string;
  /** "missing" and "thin" sentences say what can't be said and why. */
  kind: "fact" | "thin" | "missing";
  sources: BriefSource[];
}

type Phase = "np" | "auto" | "teleop" | "endgame";
const PHASES: { key: Phase; topic: BriefTopic; what: string }[] = [
  { key: "np", topic: "Overall", what: "points" },
  { key: "auto", topic: "Auto", what: "auto points" },
  { key: "teleop", topic: "TeleOp", what: "TeleOp points" },
  { key: "endgame", topic: "Endgame", what: "endgame points" },
];

/** A value as the page shows it (one decimal, trailing ".0" dropped), and as a number for differences. */
const shown = (v: number) => num(v);
const val = (v: number) => Number(num(v));
/** A difference of two shown values, without float dust (40.1 - 27.7 = 12.4, not 12.400000000000002). */
const gap = (a: number, b: number) => Math.round((val(a) - val(b)) * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "a", "a and b", "a, b and c". */
export const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-03-14" → "Mar 14, 2026" (no time zone, so the same everywhere). */
export const shortDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

const matches = (x: CompareTeam) => x.stats?.record.matches ?? 0;
const eventHref = (season: number, code: string) => `/events/${season}/${encodeURIComponent(code)}`;
const teamHref = (season: number, team: number) => `/teams/${team}?season=${season}`;
const matchHref = (m: MatchView) => `/events/${m.season}/${encodeURIComponent(m.code)}/match/${encodeURIComponent(m.key)}`;

/** The season value of a phase: the table's number. */
function seasonValue(x: CompareTeam, k: Phase): number | null {
  const v = x.stats?.opr[k].value;
  return v == null || !Number.isFinite(v) ? null : v;
}

/** The event a season OPR part came from: the season part is the best event's, so the listed event showing the
 *  same value. None when no listed event shows it (the season can count an event the list leaves out), and the
 *  sentence links the team's season instead of an event whose number wouldn't back it up. */
function sourceEvent(x: CompareTeam, k: Phase): CompareTeam["events"][number] | null {
  const v = seasonValue(x, k);
  if (v == null) return null;
  const key = k === "np" ? "opr" : k;
  return x.events.find((e) => e[key] != null && shown(e[key]!) === shown(v)) ?? null;
}

/** Events with an OPR, oldest first (the server sends them in date order). */
const rated = (x: CompareTeam) => x.events.filter((e) => e.opr != null && Number.isFinite(e.opr));

export function compareBrief(d: CompareView, label = seasonLabel(d.season)): BriefSentence[] {
  const out: BriefSentence[] = [];
  const t = d.teams;
  if (!t.length) return out;
  const season = d.season;
  const n = (x: CompareTeam) => String(x.team.number);
  const enough = t.filter((x) => matches(x) >= BRIEF.minMatches);

  // Sample size: one sentence for everyone, then a plain one for each team too thin or with nothing.
  const played = t.filter((x) => matches(x) > 0);
  if (played.length) {
    out.push({
      topic: "Sample size", kind: "fact",
      text: `In ${label}, ${list(played.map((x) => `${n(x)} played ${plural(matches(x), "match", "matches")} at ${plural(x.stats!.record.events, "event")}`))}.`,
      sources: played.map((x) => ({ label: `${n(x)}'s season`, href: teamHref(season, x.team.number) })),
    });
  }
  for (const x of t) {
    const m = matches(x);
    if (m === 0) {
      out.push({ topic: "Sample size", kind: "missing", text: `No results for ${n(x)} in ${label}, so it's left out of every comparison.`, sources: [{ label: `${n(x)}'s season`, href: teamHref(season, x.team.number) }] });
    } else if (m < BRIEF.minMatches) {
      out.push({
        topic: "Sample size", kind: "thin",
        text: `Only ${plural(m, "match", "matches")} for ${n(x)} in ${label}, fewer than the ${BRIEF.minMatches} needed, so its OPR isn't compared.`,
        sources: [{ label: `${n(x)}'s season`, href: teamHref(season, x.team.number) }],
      });
    }
  }

  // OPR by phase: overall, then auto, TeleOp and endgame. With fewer than two teams to compare at all, one
  // sentence says so instead of four.
  if (enough.filter((x) => PHASES.some((p) => seasonValue(x, p.key) != null)).length < 2) {
    out.push({ topic: "Overall", kind: "missing", text: `Not enough data to compare OPR, auto, TeleOp or endgame: it needs two teams with ${BRIEF.minMatches} or more matches and an OPR.`, sources: [] });
  } else for (const p of PHASES) {
    const ok = enough.filter((x) => seasonValue(x, p.key) != null);
    if (ok.length < 2) {
      out.push({ topic: p.topic, kind: "missing", text: `Not enough data to compare: it needs two teams with ${BRIEF.minMatches} or more matches and an OPR.`, sources: [] });
      continue;
    }
    // Highest first; equal shown values keep the page's order.
    const ranked = [...ok].sort((a, b) => val(seasonValue(b, p.key)!) - val(seasonValue(a, p.key)!));
    const v = (x: CompareTeam) => seasonValue(x, p.key)!;
    const sources = ranked.map((x) => {
      const e = sourceEvent(x, p.key);
      return e ? { label: `${n(x)} at ${e.name}`, href: eventHref(season, e.code) } : { label: `${n(x)}'s season`, href: teamHref(season, x.team.number) };
    });
    let text: string;
    if (ranked.length === 2) {
      const [a, b] = ranked;
      const g = gap(v(a), v(b));
      text = g < BRIEF.levelPoints
        ? `${n(a)} and ${n(b)} are level, within ${plural(BRIEF.levelPoints, "point")} (best-event OPR ${shown(v(a))} vs ${shown(v(b))}; ${matches(a)} vs ${matches(b)} matches).`
        : `${n(a)} adds an estimated ${shown(g)} more ${p.what} per match than ${n(b)} (best-event OPR ${shown(v(a))} vs ${shown(v(b))}; ${matches(a)} vs ${matches(b)} matches).`;
    } else {
      const top = ranked.filter((x) => gap(v(ranked[0]), v(x)) < BRIEF.levelPoints);
      const values = `best-event OPR ${list(ranked.map((x) => `${n(x)} ${shown(v(x))} (${plural(matches(x), "match", "matches")})`))}`;
      if (top.length === ranked.length) text = `All ${ranked.length} are level, within ${plural(BRIEF.levelPoints, "point")}: ${values}.`;
      else {
        const next = ranked[top.length];
        const g = gap(v(ranked[top.length - 1]), v(next));
        text = top.length === 1
          ? `${n(top[0])} is highest, an estimated ${shown(g)} more ${p.what} per match than ${n(next)}: ${values}.`
          : `${list(top.map(n))} are level at the top, ${shown(g)} or more ${p.what} per match ahead of ${n(next)}: ${values}.`;
      }
    }
    out.push({ topic: p.topic, kind: "fact", text, sources });
  }

  // Consistency: how far each team's event OPR moved between its events.
  const spread = enough.map((x) => {
    const evs = rated(x);
    if (evs.length < BRIEF.minEvents) return { x, evs, lo: null, hi: null };
    const lo = evs.reduce((a, e) => (val(e.opr!) < val(a.opr!) ? e : a));
    const hi = evs.reduce((a, e) => (val(e.opr!) > val(a.opr!) ? e : a));
    return { x, evs, lo, hi };
  });
  const judged = spread.filter((s) => s.lo && s.hi);
  if (!judged.length) {
    out.push({ topic: "Consistency", kind: "missing", text: `Can't be judged yet: no team with ${BRIEF.minMatches} or more matches has ${BRIEF.minEvents} events with an OPR.`, sources: [] });
  } else {
    const parts = judged.map((s) => `${n(s.x)} ${shown(s.lo!.opr!)} to ${shown(s.hi!.opr!)} over ${plural(s.evs.length, "event")}`);
    const range = (s: (typeof judged)[number]) => gap(s.hi!.opr!, s.lo!.opr!);
    let text = `Event OPR ranged ${list(parts)}.`;
    if (judged.length >= 2) {
      const byRange = [...judged].sort((a, b) => range(a) - range(b));
      const steady = byRange.filter((s) => range(s) - range(byRange[0]) < BRIEF.levelPoints);
      text += steady.length === 1
        ? ` ${n(steady[0].x)} was the steadiest, with the narrowest range (${shown(range(steady[0]))} points).`
        : ` ${list(steady.map((s) => n(s.x)))} had ranges within ${plural(BRIEF.levelPoints, "point")} of each other.`;
    }
    const few = spread.filter((s) => !s.lo).map((s) => n(s.x));
    if (few.length) text += ` ${list(few)} ${few.length === 1 ? "has" : "have"} fewer than ${BRIEF.minEvents} events with an OPR, too few to judge.`;
    out.push({
      topic: "Consistency", kind: "fact", text,
      sources: judged.flatMap((s) => [s.lo!, s.hi!].filter((e, i, a) => a.indexOf(e) === i).map((e) => ({ label: `${n(s.x)} at ${e.name}`, href: eventHref(season, e.code) }))),
    });
  }

  // Recency: each team's latest event with results, and how its OPR moved since its first.
  const latest = t.map((x) => ({ x, evs: rated(x) })).filter((r) => r.evs.length);
  if (!latest.length) {
    out.push({ topic: "Recency", kind: "missing", text: `None of these teams has an event with results in ${label} yet.`, sources: [] });
  } else {
    const parts = latest.map(({ x, evs }) => {
      const last = evs[evs.length - 1];
      const when = last.start ? ` on ${shortDate(last.start)}` : "";
      // Below the sample threshold the event is named but its OPR isn't quoted.
      if (matches(x) < BRIEF.minMatches) return `${n(x)} at ${last.name}${when} (${plural(matches(x), "match", "matches")}, too few to quote its OPR)`;
      let s = `${n(x)} at ${last.name}${when} (event OPR ${shown(last.opr!)}`;
      if (evs.length >= BRIEF.minEvents) {
        const g = gap(last.opr!, evs[0].opr!);
        s += Math.abs(g) < BRIEF.levelPoints ? `, level with its first event` : `, ${g > 0 ? "up" : "down"} ${shown(Math.abs(g))} on its first event`;
      }
      return `${s})`;
    });
    out.push({
      topic: "Recency", kind: "fact", text: `Latest results: ${list(parts)}.`,
      // The latest event, and the first too when the sentence quotes the change since it.
      sources: latest.flatMap(({ x, evs }) => {
        const trend = matches(x) >= BRIEF.minMatches && evs.length >= BRIEF.minEvents;
        return (trend ? [evs[0], evs[evs.length - 1]] : [evs[evs.length - 1]]).map((e) => ({ label: `${n(x)} at ${e.name}`, href: eventHref(season, e.code) }));
      }),
    });
  }

  // Head to head: the meetings the page lists, all from the first team's side, counted from the lineups rather than
  // the server's one label per match: with three or four teams, one match can have a compared team as a partner and
  // another as an opponent, and it counts toward both. Only teams on the field count, so a listed no-show never
  // makes a meeting or a result.
  if (t.length > 1) {
    const first = t[0].team.number;
    const others = list(t.slice(1).map(n));
    const compared = new Set(t.slice(1).map((x) => x.team.number));
    const sides = (m: MatchView) => {
      const red = m.red.teams.some((x) => x.number === first && x.onField);
      const blue = m.blue.teams.some((x) => x.number === first && x.onField);
      if (!red && !blue) return { partner: false, opponent: false };
      const on = (a: MatchView["red"]) => a.teams.some((x) => x.onField && compared.has(x.number));
      return { partner: on(red ? m.red : m.blue), opponent: on(red ? m.blue : m.red) };
    };
    const met = d.meetings.filter((m) => m.played && (sides(m).partner || sides(m).opponent));
    if (!met.length) out.push({ topic: "Head to head", kind: "missing", text: `${first} hasn't played with or against ${others} in ${label}.`, sources: [] });
    else {
      const against = met.filter((m) => sides(m).opponent);
      const together = met.filter((m) => sides(m).partner).length;
      let w = 0, l = 0, tie = 0;
      for (const m of against) {
        const red = m.red.teams.some((x) => x.number === first);
        const us = red ? m.red.score?.total : m.blue.score?.total, them = red ? m.blue.score?.total : m.red.score?.total;
        if (us == null || them == null) continue;
        if (us > them) w++; else if (us < them) l++; else tie++;
      }
      // Only matches with a score count toward the record, and the sentence says how many that is.
      const scored = w + l + tie;
      const record = scored ? `; in the ${plural(scored, "scored match", "scored matches")} against, ${first}'s alliance went ${w}-${l}-${tie}` : "";
      out.push({
        topic: "Head to head", kind: "fact",
        text: `${first} met ${others} in ${plural(met.length, "played match", "played matches")} (opponents in ${against.length}, partners in ${together}${against.length + together > met.length ? "; a match can be both" : ""})${record}.`,
        sources: met.slice(0, BRIEF.maxMatchLinks).map((m) => ({ label: `${m.code} ${m.label}`, href: matchHref(m) })),
      });
    }
  }
  return out;
}

/** The brief as plain text for the clipboard: one line per sentence, its sources as full links under it. */
export function briefText(d: CompareView, sentences: BriefSentence[], origin: string, label = seasonLabel(d.season)): string {
  const head = `Comparison brief: ${list(d.teams.map((x) => String(x.team.number)))}, ${label}`;
  const lines = sentences.map((s) => [`${s.topic}: ${s.text}`, ...s.sources.map((x) => `  - ${x.label}: ${origin}${x.href}`)].join("\n"));
  return [head, ...lines, `From ${origin}/compare?teams=${d.teams.map((x) => x.team.number).join(",")}&season=${d.season}`].join("\n\n");
}
