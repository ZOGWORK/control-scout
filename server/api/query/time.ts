// Time words as a date range (docs/search-pipeline.md, "Time"): every phrase resolves relative to today, never to a
// fixed season. A range names the seasons it falls in (an FTC season runs September to August: a date in October 2026
// is 2026–27), so "this week" is a window inside the current season, "2025" is the 2025–26 season, and "in March" is
// the March of the season the question is about.
import { SEASONS } from "../../data/seasons.js";
import { timeWindow, type SearchTime } from "../../../src/shared/searchEventQuery.js";

export interface TimeSlot {
  /** What kind of time was said: a date window, one season, every season. */
  kind: "window" | "season" | "ever";
  /** The window's first and last day (YYYY-MM-DD, inclusive), for a window. */
  from?: string;
  to?: string;
  /** The season the time names (a window's season, or the season said). Null: every season. */
  season: number | null;
  /** How it was said, for the card ("this week", "in 2024–25", "on Mar 15, 2026"). */
  label: string;
  /** The words typed. */
  typed: string;
  /** "last season", "this season": relative to the default season, resolved by the executor. */
  relative?: "this" | "last";
  /** A calendar year typed: a bare one ("2025", read as its season), or a date's or a month's ("march 2026"). A window
   *  with its year typed is never relaxed to another season. */
  year?: number;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON = MONTHS.map((m) => m.slice(0, 3));
/** The FTC season a date falls in: September on starts the next season. */
export const seasonOfDate = (iso: string): number => { const [y, m] = iso.split("-").map(Number); return m >= 9 ? y : y - 1; };
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
/** A date that exists (month 0-based), else null: "February 30" or "2026-13-45" is never moved to another day. */
const realDay = (y: number, m: number, d: number): string | null => {
  const s = iso(y, m, d);
  return s === `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` ? s : null;
};
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const monthIndex = (w: string) => { const i = MON.indexOf(w.slice(0, 3)); return i >= 0 && (w.length <= 4 || MONTHS[i].startsWith(w.replace(/\.$/, ""))) ? i : -1; };
const label = (from: string, to: string) => {
  const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T00:00:00Z`);
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return from === to ? `on ${md(f)}, ${f.getUTCFullYear()}` : `${md(f)}–${md(t)}, ${t.getUTCFullYear()}`;
};

/** "This season": the words readTime reads as the current season. ("Last season" beside a season named is a second
 *  season, a comparison, so it isn't taken in.) */
const RELATIVE_SEASON = /\b(?:this|current|the\s+current)\s+(?:season|year)'?s?\b/;

/** The window phrases, longest first: each is a SearchTime (src/shared/searchEventQuery.ts timeWindow) or a past one. */
const WINDOWS: [RegExp, SearchTime | "last-week" | "last-weekend" | "last-month" | "yesterday", string][] = [
  [/\bthis\s+weekend\b/, "this-weekend", "this weekend"], [/\bnext\s+weekend\b/, "next-weekend", "next weekend"],
  [/\b(?:last|past|previous)\s+weekend\b/, "last-weekend", "last weekend"],
  [/\bthis\s+week\b/, "this-week", "this week"], [/\bnext\s+week\b/, "next-week", "next week"],
  [/\b(?:last|past|previous)\s+week\b/, "last-week", "last week"],
  [/\bthis\s+month\b/, "this-month", "this month"], [/\bnext\s+month\b/, "next-month", "next month"],
  [/\b(?:last|past|previous)\s+month\b/, "last-month", "last month"],
  [/\btoday\b|\btonight\b/, "today", "today"], [/\byesterday\b/, "yesterday", "yesterday"], [/\btomorrow\b/, "tomorrow", "tomorrow"],
];

/** The window a phrase names, from `today`. */
function windowOf(w: (typeof WINDOWS)[number][1], today: string): { from: string; to: string } {
  if (w === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (w === "last-week" || w === "last-weekend" || w === "last-month") {
    const base = timeWindow(w === "last-week" ? "this-week" : w === "last-weekend" ? "this-weekend" : "this-month", today);
    if (w === "last-month") { const d = new Date(`${base.from}T00:00:00Z`); return { from: iso(d.getUTCFullYear(), d.getUTCMonth() - 1, 1), to: iso(d.getUTCFullYear(), d.getUTCMonth(), 0) }; }
    // The weekend just gone: the Saturday and Sunday before this week's.
    return { from: addDays(base.from!, -7), to: addDays(base.to!, -7) };
  }
  const r = timeWindow(w, today);
  return { from: r.from ?? today, to: r.to ?? today };
}

/** `unread`: a date that doesn't exist ("february 30, 2026"), taken out of `rest` so no other reader takes its words,
 *  and left unexplained. */
export interface TimeRead { time: TimeSlot | null; rest: string; unread?: string }

/** The time `q` (lower case, words) names, and `q` without its words. `today` is YYYY-MM-DD. A bare four-digit year
 *  is read only when `yearOk` says so (a number could be a team's: the parser decides). */
export function readTime(q: string, today: string, yearOk: (y: number) => boolean = () => true): TimeRead {
  let rest = ` ${q} `;
  const cut = (m: RegExpExecArray) => { rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`; };
  // A season said outright stands over "this season" said beside it ("this season in 2025-26"):
  // the relative words only say it again, so they're taken in with it and the card states the season named.
  const out = (t: TimeSlot): TimeRead => {
    if (t.kind === "season" && t.season != null && !t.relative) {
      const again = RELATIVE_SEASON.exec(rest);
      if (again) cut(again);
    }
    return { time: t, rest: rest.replace(/\s+/g, " ").trim() };
  };
  const known = (s: number) => SEASONS.some((x) => x.season === s);

  // A date: "on mar 15 2026", "march 15, 2026", "3/15/2026", "2026-03-15".
  let m = /\b(?:on\s+)?([a-z]{3,9}\.?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(20\d\d)\b/.exec(rest);
  const said = m && monthIndex(m[1]) >= 0 ? realDay(Number(m[3]), monthIndex(m[1]), Number(m[2])) : null;
  if (m && monthIndex(m[1]) >= 0 && !said) { cut(m); return { time: null, rest: rest.replace(/\s+/g, " ").trim(), unread: m[0].trim() }; }
  if (m && said) {
    const day = said;
    cut(m); return out({ kind: "window", from: day, to: day, season: seasonOfDate(day), label: label(day, day), typed: m[0].trim(), year: Number(m[3]) });
  }
  m = /\b(?:on\s+)?(20\d\d)-(\d\d)-(\d\d)\b|\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/.exec(rest);
  const numeric = m ? (m[1] ? realDay(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : realDay(Number(m[6]), Number(m[4]) - 1, Number(m[5]))) : null;
  if (m && !numeric) { cut(m); return { time: null, rest: rest.replace(/\s+/g, " ").trim(), unread: m[0].trim() }; }
  if (m && numeric) {
    const day = numeric;
    cut(m); return out({ kind: "window", from: day, to: day, season: seasonOfDate(day), label: label(day, day), typed: m[0].trim(), year: Number(day.slice(0, 4)) });
  }
  // A window relative to today.
  for (const [re, w, said] of WINDOWS) {
    const x = re.exec(rest);
    if (!x) continue;
    const r = windowOf(w, today);
    cut(x); return out({ kind: "window", ...r, season: seasonOfDate(r.from), label: said, typed: x[0].trim() });
  }
  // A season written as one: "2024-25", "2024–2025".
  m = /\b(?:in\s+|during\s+|for\s+)?(?:the\s+)?(20\d\d)\s*[-–/]\s*(\d\d(?:\d\d)?)(?:\s+season)?\b/.exec(rest);
  if (m && (m[2].length === 2 ? (Number(m[1]) + 1) % 100 : Number(m[1]) + 1) === Number(m[2])) {
    cut(m); return out({ kind: "season", season: Number(m[1]), label: `in ${m[1]}–${String((Number(m[1]) + 1) % 100).padStart(2, "0")}`, typed: m[0].trim() });
  }
  // A game's name ("into the deep", "decode"): its season.
  for (const s of SEASONS) {
    const g = new RegExp(`\\b(?:in\\s+|during\\s+)?${[...s.game.replace(/\s+/g, "").toLowerCase()].join("[\\s-]?")}\\b`).exec(rest);
    if (g) { cut(g); return out({ kind: "season", season: s.season, label: `in ${s.label}`, typed: g[0].trim() }); }
  }
  // A month, with or without its year: "in march", "march 2026". With no year, the month of the season asked about
  // (the executor fills the season in): read here as the month of the season `today` is in.
  // "May" is a word too: a month only after "in" or "during", or with its year.
  m = /\b(?:in\s+|during\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?(?:\s+(20\d\d))?\b/.exec(rest);
  if (m && monthIndex(m[1]) >= 0 && (m[2] || /\b(?:in|during)\s/.test(m[0]) || (m[1].length > 3 && m[1] !== "may"))) {
    const mi = monthIndex(m[1]);
    const season = m[2] ? (mi >= 8 ? Number(m[2]) : Number(m[2]) - 1) : seasonOfDate(today);
    const year = mi >= 8 ? season : season + 1;
    const from = iso(year, mi, 1), to = iso(year, mi + 1, 0);
    cut(m); return out({ kind: "window", from, to, season, label: `in ${MONTHS[mi][0].toUpperCase()}${MONTHS[mi].slice(1)} ${year}`, typed: m[0].trim(), ...(m[2] ? { year } : {}) });
  }
  // This season, last season (relative: the executor reads them against the default season).
  m = /\b(?:this|current|the\s+current)\s+(?:season|year)'?s?\b|\bthis\s+year'?s?\b/.exec(rest);
  if (m) { cut(m); return out({ kind: "season", season: null, relative: "this", label: "this season", typed: m[0].trim() }); }
  m = /\b(?:last|previous|past|prior)\s+(?:season|year)'?s?\b/.exec(rest);
  if (m) { cut(m); return out({ kind: "season", season: null, relative: "last", label: "last season", typed: m[0].trim() }); }
  // Every season.
  m = /\b(?:ever|all[\s-]*time|of\s+all[\s-]*time|in\s+history|all\s+seasons|every\s+season|career|overall)\b/.exec(rest);
  if (m) { cut(m); return out({ kind: "ever", season: null, label: "all seasons", typed: m[0].trim() }); }
  // A bare year: its season ("2025": 2025–26), a future year included (the executor says when it has no events yet).
  // One after "in" or "during" first; a number after "team" is always the team ("team 2024 record in 2025").
  m = /\b(?:in|during|for|from|of)\s+(?:the\s+)?(20[1-3]\d)(?:\s+season)?\b/.exec(rest) ?? /(?<!\bteam\s)\b(20[1-3]\d)(?:\s+season)?\b/.exec(rest);
  if (m && yearOk(Number(m[1]))) {
    const y = Number(m[1]);
    cut(m); return out({ kind: "season", season: y, year: y, label: known(y) ? `in ${SEASONS.find((s) => s.season === y)!.label}` : `in ${y}–${String((y + 1) % 100).padStart(2, "0")}`, typed: m[0].trim() });
  }
  return { time: null, rest: rest.replace(/\s+/g, " ").trim() };
}
