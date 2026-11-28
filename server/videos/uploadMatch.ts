// Which match a per-match upload is (docs/official-videos.md, "Per-match uploads"): some channels post each match as a
// video of its own ("Qualification 8 - 2025 FTC North Scarborough Qualifier", "Frozen Frenzy II Qualifier - Playoff
// Match 6 - FTC 2024-2025") rather than a day's broadcast. Pure: the caller (./matchUploads.ts) gives the upload's
// facts, its channel's region rule, the competitions and their matches; this says add, review or ignore.
//
// Add only when the title names exactly one match, and exactly one event both ways: every distinctive word of the
// event's name is in the title, and every word of the title is the event's own (its name, city, venue, the channel's
// region words) or says nothing (FTC, Qualifier, the season's game). Then that match must have been played, and any
// team the title names must be on it. Anything short of that is set aside: for the owner when an event fits, ignored
// with why when none does. Never a guess.
import { GENERIC_WORDS, NOT_EVENTS, acronyms, daysBetween, designators, norm, notCompetition, parseRule, spelled, titleDatesOf, toks, type ChannelRule, type WatchEvent } from "./officialMatch.js";

/** The longest a per-match upload runs: a match is 2.5 minutes, an upload with its intro and the score up rarely 6. */
export const MAX_MATCH_UPLOAD_S = 15 * 60;
/** The shortest: under a minute isn't a whole match. */
export const MIN_MATCH_UPLOAD_S = 60;
/** How long after its event a match's upload may go up and still be dated by that: a channel posts its matches over
 *  the following weeks (every one the 2026-11 dry run added went up within 60 days). A title's year only narrows the
 *  season, never stretches this: "2025 Detroit City Championship" uploads went up a year after Detroit's FTC qualifier,
 *  and are FRC's. */
export const UPLOAD_LAG_DAYS = 60;

export interface UploadVideo {
  videoId: string; channelId: string; title: string;
  /** When it went up (its only date: a per-match upload was never broadcast). */
  published: string | null;
  /** liveStreamingDetails.actualStartTime: a broadcast isn't a per-match upload. */
  start?: string | null;
  durationS: number | null; privacy: string | null; embeddable: boolean; blockedIn: number;
}
export interface UploadMatchRow { level: string; series: number; number: number; label: string; description: string | null; played: boolean; teams: number[] }
export type UploadVerdict =
  | { kind: "add"; event: WatchEvent; match: UploadMatchRow; t: number; why: string }
  | { kind: "review"; why: string; event?: WatchEvent; match?: UploadMatchRow }
  | { kind: "ignore"; why: string };

/** A match as a title names it. qual Q12; semi: a semifinal's match (2019-2023 brackets, "Semifinal 1 Match 2"); final
 *  F2; playoff: a double-elimination match (2024 on, "Playoff Match 12", "Upper Bracket Round 1 Match 3"); bare:
 *  "Match 12", which can be either. frc: named the way FRC's tools name matches ("QM12", "SF1M2", "F1M2"). */
export type TitleMatch = ({ kind: "qual" | "final" | "playoff" | "bare"; n: number } | { kind: "semi"; s: number; m: number }) & { text: string; frc?: true };

const N = "0*(\\d{1,3})(?![\\d.,:/]\\d)(?!\\d)";
const PATTERNS: [RegExp, (m: RegExpExecArray) => TitleMatch][] = [
  [/\b(?:Upper|Lower|Final)\s+Bracket\s+Round\s*\d{1,2}\s*[-,]?\s*Match\s*#?\s*0*(\d{1,2})\b/gi, (m) => ({ kind: "playoff", n: Number(m[1]), text: m[0] })],
  [/\bSF\s*0*(\d{1,2})\s*-?\s*M\s*0*(\d{1,2})\b/gi, (m) => ({ kind: "semi", s: Number(m[1]), m: Number(m[2]), text: m[0], frc: true })],
  [/\bF\s*0*(\d)\s*-?\s*M\s*0*(\d)\b/gi, (m) => ({ kind: "final", n: Number(m[2]), text: m[0], frc: true })],
  [/\bSemi-?\s?finals?\s*(?:#\s*)?0*(\d)\s*(?:[-,:]\s*)?(?:Match|M|Game)\s*#?\s*0*(\d)\b/gi, (m) => ({ kind: "semi", s: Number(m[1]), m: Number(m[2]), text: m[0] })],
  [new RegExp(`\\bQM\\s*#?\\s*${N}`, "gi"), (m) => ({ kind: "qual", n: Number(m[1]), text: m[0], frc: true })],
  [new RegExp(`\\b(?:Qualification|Qualifying|Quals?|Q)\\s*(?:Match\\s*)?#?\\s*${N}`, "gi"), (m) => ({ kind: "qual", n: Number(m[1]), text: m[0] })],
  [new RegExp(`\\b(?:Finals?\\s*(?:Match\\s*)?#?\\s*|F\\s*)${N}`, "gi"), (m) => ({ kind: "final", n: Number(m[1]), text: m[0] })],
  [new RegExp(`\\b(?:Playoffs?|Elimination|Elims?|Double[- ]Elim(?:ination)?)\\s*(?:Match\\s*)?#?\\s*${N}`, "gi"), (m) => ({ kind: "playoff", n: Number(m[1]), text: m[0] })],
];
const BARE = new RegExp(`\\b(?:Match|M)\\s*#?\\s*${N}`, "gi");
/** A stage with no match of Scout's to name: a quarterfinal (a Worlds division's), a tiebreaker. */
const UNNAMED = /\b(?:quarter-?\s?finals?|QF\s*\d|tie-?\s?breaker|octo-?finals?)\b/i;
/** FRC's own events, which a channel filming both programs posts the same way. */
const FRC_EVENT = /\bdistrict (?:championship|event|competition|champs)\b|\bDCMP\b|\bbehind the glass\b/i;
/** A title saying it's FTC, which a match named the FRC way ("QM12") needs. */
const SAYS_FTC = /\bFTC\b|\bFIRST Tech Challenge\b|\bTech Challenge\b/i;
/** Words that only describe the clip, never another event: a score ("458 pts"), a camera. */
const CLIP_WORDS = new Set(["pts", "points", "score", "scores", "record", "high", "highest", "world", "camera", "cam", "view", "angle", "full", "video", "replay", "edition", "upper", "lower", "bracket", "round", "playoff", "qualification", "semifinal", "semifinals", "final", "game", "elimination", "eliminations", "vs", "versus", "red", "blue", "alliance", "ftc", "ont", "official"]);

/**
 * Every match a title names, each once. "Qualification 2.11" (a Dutch league's meet 2, match 11) names none: the number
 * runs on. A bare "Match 12" counts only where no other way of naming a match was found.
 */
export function titleMatches(title: string): TitleMatch[] {
  const out: TitleMatch[] = [];
  let rest = title;
  for (const [re, of] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of rest.matchAll(re)) out.push(of(m as RegExpExecArray));
    rest = rest.replace(re, " ");
  }
  if (!out.length) for (const m of rest.matchAll(BARE)) out.push({ kind: "bare", n: Number(m[1]), text: m[0] });
  const key = (x: TitleMatch) => (x.kind === "semi" ? `semi ${x.s} ${x.m}` : `${x.kind} ${x.n}`);
  return [...new Map(out.map((x) => [key(x), x])).values()];
}

/** The team numbers a title names: 3 to 5 digits standing alone, never a year (1990-2039) nor a score ("458 pts"). */
export function titleTeams(title: string): number[] {
  return [...new Set([...title.matchAll(/(?<![\d.\/:#-])\b(\d{3,5})\b(?![\d.\/:-])(?!\s*(?:pts|points)\b)/gi)].map((m) => m[1]).filter((n) => !/^(199\d|20[0-3]\d)$/.test(n)).map(Number))];
}

/** The seasons a title's years can be: "2025" is the 2024-25 season's end or the 2025-26 season's start; "2023-2024"
 *  (or "2023-24") is the 2023 season alone. null when it names no year. */
export function titleSeasons(title: string): Set<number> | null {
  const range = /\b(20[1-3]\d)\s*[-–/]\s*(?:20)?([1-3]\d)\b/.exec(title);
  if (range && Number(range[2]) === (Number(range[1]) + 1) % 100) return new Set([Number(range[1])]);
  const ys = [...title.matchAll(/(?<![\d.\/-])\b(20[1-3]\d)\b(?![\d.\/-])/g)].map((m) => Number(m[1]));
  if (!ys.length) return null;
  return new Set(ys.flatMap((y) => [y, y - 1]));
}

/** Double elimination (2024 on): FIRST describes its playoffs as "Upper Bracket Round 1 Match 1". */
const doubleElim = (ms: UploadMatchRow[]) => ms.some((m) => m.level !== "qual" && /bracket/i.test(m.description ?? ""));

/** The event's match a title names, or why it can't be told. */
export function findMatch(t: TitleMatch, ms: UploadMatchRow[]): { match: UploadMatchRow } | { why: string } {
  const de = doubleElim(ms);
  const one = (f: (m: UploadMatchRow) => boolean, what: string) => {
    const hits = ms.filter(f);
    return hits.length === 1 ? { match: hits[0] } : { why: hits.length ? `${hits.length} of its matches are ${what}` : `it has no ${what}` };
  };
  switch (t.kind) {
    case "qual": return one((m) => m.level === "qual" && m.label === `Q${t.n}`, `Q${t.n}`);
    case "final": return one((m) => m.level !== "qual" && m.label === `F${t.n}`, `F${t.n}`);
    case "playoff":
      if (!de) return { why: `"${t.text.trim()}" names a playoff match by number, and its playoffs were a bracket (semifinals and finals), not numbered` };
      return one((m) => m.level !== "qual" && m.label === `M${t.n}`, `M${t.n}`);
    case "semi":
      // "SF13M1" is how FRC's tools name double-elimination match 13: an FTC event's numbered matches aren't told
      // apart from a semifinal's that way, so it's the owner's.
      if (de) return { why: `"${t.text.trim()}" names a semifinal, and its playoffs were double elimination (numbered matches)` };
      return one((m) => m.level !== "qual" && m.series === t.s && m.number === t.m && /semi/i.test(m.description ?? ""), `semifinal ${t.s} match ${t.m}`);
    case "bare": return { why: `"${t.text.trim()}" doesn't say whether it's a qualification or a playoff match` };
  }
}

/** A title naming a championship isn't a qualifier's, league meet's or scrimmage's; one naming a qualifier isn't a
 *  championship's or an off-season event's. (FIRST in Michigan's "Detroit City Championship" is FRC's, not Detroit's
 *  FTC Qualifier.) "Qualification" names a match, not the event. */
export function kindClash(title: string, type: string): boolean {
  if (/\bchamp(?:ionships?|s)?\b/i.test(title) && ["Qualifier", "SuperQualifier", "LeagueMeet", "Scrimmage"].includes(type)) return true;
  if (/\bqualif(?:ier|iers|ying)\b/i.test(title) && ["Championship", "FIRSTChampionship", "OffSeason", "Premier"].includes(type)) return true;
  return false;
}

/** Every word a title says that could name something (US state names too), less the ones that never do. */
const wordsOf = (s: string) => new Set(norm(s).split(" ").filter((t) => t.length > 2 && !/^\d+$/.test(t) && !GENERIC_WORDS.has(t) && !CLIP_WORDS.has(t)));

/**
 * Which match a per-match upload is. events: every competition (the channel's region rule and the dates are applied
 * here); matchesOf: an event's matches with their teams.
 */
export function matchUpload(v: UploadVideo, rule: ChannelRule, events: WatchEvent[], matchesOf: (e: WatchEvent) => UploadMatchRow[]): UploadVerdict {
  const d = v.durationS;
  if (v.start) return { kind: "ignore", why: "a broadcast, not a per-match upload" };
  if (d == null) return { kind: "ignore", why: "YouTube gave no length for it" };
  if (d > MAX_MATCH_UPLOAD_S || d < MIN_MATCH_UPLOAD_S) return { kind: "ignore", why: `${Math.round(d / 60)} minutes long: not one match's upload` };
  if (v.privacy !== "public" || !v.embeddable || v.blockedIn >= 50) return { kind: "ignore", why: `not a public video that plays here (${v.privacy ?? "privacy unknown"}${v.embeddable ? "" : ", not embeddable"}${v.blockedIn ? `, blocked in ${v.blockedIn} countries` : ""})` };
  const notComp = notCompetition(v.title);
  if (notComp) return { kind: "ignore", why: notComp };
  const frc = FRC_EVENT.exec(v.title);
  if (frc) return { kind: "ignore", why: `an FRC event's match: the title says "${frc[0]}"` };
  if (UNNAMED.test(v.title)) return { kind: "ignore", why: "names a stage Scout has no match for (a quarterfinal or a tiebreaker)" };
  const named = titleMatches(v.title);
  if (!named.length) return { kind: "ignore", why: "names no match" };
  if (named.length > 1) return { kind: "ignore", why: `names more than one match (${named.map((x) => x.text.trim()).join(", ")}): not one match's clip` };
  const tm = named[0];
  // "QM12", "SF1M2": FRC's way of naming a match. A channel filming both programs posts FRC's that way too, so the
  // title must say it's FTC.
  if (tm.frc && !SAYS_FTC.test(v.title)) return { kind: "ignore", why: `"${tm.text.trim()}" names a match the way FRC's tools do, and the title doesn't say FTC` };
  const inRegion = parseRule(rule.region);
  if (!inRegion) return { kind: "ignore", why: `the channel's region rule "${rule.region}" can't be read` };
  const pub = v.published && /^\d{4}-\d{2}-\d{2}/.test(v.published) ? v.published.slice(0, 10) : null;
  if (!pub) return { kind: "ignore", why: "YouTube gave no date it went up" };

  const extra = new Set(norm(rule.words).split(" ").filter(Boolean));
  // The title with the match's name taken out: "Qualification 8 - 2025 FTC North Scarborough Qualifier" names an
  // event by "North Scarborough", and the "8" isn't a meet's number.
  const rest = v.title.replace(tm.text, " ");
  const vt = toks(rest, extra);
  const out = spelled(rest);
  const said = (t: string) => vt.has(t) || out.has(t);
  const titleWords = wordsOf(rest);
  const td = designators(rest);
  const seasons = titleSeasons(rest);
  const dates = titleDatesOf(rest, pub);
  const lagOf = (e: WatchEvent) => daysBetween((e.end || e.start).slice(0, 10), pub);

  type Cand = { e: WatchEvent; words: Set<string> };
  const cands: Cand[] = [];
  for (const e of events) {
    if (NOT_EVENTS.has(e.type) || !inRegion(e) || e.remote) continue;
    const end = (e.end || e.start).slice(0, 10);
    // It went up after the event started, and within the lag after it ended.
    if (pub < e.start.slice(0, 10) || lagOf(e) > UPLOAD_LAG_DAYS) continue;
    // A title saying what kind of event it is says which it isn't: a championship's isn't a qualifier's.
    if (kindClash(rest, e.type)) continue;
    if (seasons && !seasons.has(e.season)) continue;
    if (dates && !dates.some((x) => x >= e.start.slice(0, 10) && x <= end)) continue;
    // Every distinctive word of its name said (or its acronym): a word of the region or a "Qualifier" alone names nothing.
    const words = toks(e.name, extra);
    const acr = acronyms(e.name, extra);
    if (!(words.size > 0 && [...words].every(said)) && !(acr.some((a) => vt.has(a)) && [...words].some(said))) continue;
    // And nothing in the title is another event's: every word it says is this one's (name, city, venue, region).
    const own = new Set([...wordsOf(`${e.name} ${e.city ?? ""} ${e.venue ?? ""}`), ...extra, ...acr]);
    if ([...titleWords].some((t) => !own.has(t) && !extra.has(t))) continue;
    const ed = designators(e.name);
    if ((["letter", "meet", "n", "uil", "stage", "ampm"] as const).some((k) => td[k] != null && ed[k] != null && td[k] !== ed[k])) continue;
    if ((["letter", "meet", "n", "stage", "ampm"] as const).some((k) => ed[k] != null && td[k] == null)) continue;
    // A parent event isn't a title that names a division; a division is (its name's words, all said, include it).
    if (!(e.divisionCode && e.divisionCode !== e.code) && e.parent && /\bdivi(?:sion|zia)\b/i.test(rest)) continue;
    cands.push({ e, words });
  }
  if (!cands.length) return { kind: "ignore", why: "its title names no Scout competition in the channel's region near when it went up, by every word of its name and no other" };
  // A name inside another's ("Frozen Frenzy" and "Frozen Frenzy II", whose "II" is too short a word to count): the
  // title must say the longer as it's written for that one; saying the shorter only is the owner's to tell.
  const phrase = norm(rest);
  const bare = (e: WatchEvent) => norm(e.name).replace(/\b(?:first tech challenge|ftc)\b/g, " ").replace(/\s+/g, " ").trim();
  const says = (c: Cand) => ` ${phrase} `.includes(` ${bare(c.e)} `);
  // Same season only: one season's "Mississauga Qualifier" and another's "FIRST Tech Challenge Mississauga Qualifier"
  // are the same event a year apart, told apart by the dates.
  const inside = (c: Cand, o: Cand) => o !== c && o.e.season === c.e.season && [...c.words].every((w) => o.words.has(w)) && bare(o.e).length > bare(c.e).length;
  let fit = cands.filter((c) => !cands.some((o) => inside(c, o) && says(o)));
  // A name inside another's, the shorter said only: neither named either (the owner rejects it, or adds it on the event page).
  if (fit.length === 1 && cands.some((o) => inside(fit[0], o))) return { kind: "review", why: `the title says ${fit[0].e.code}'s name, which ${cands.filter((o) => inside(fit[0], o)).map((o) => o.e.code).join(" and ")}'s name holds too` };
  // Two events fit: neither is named, so an Approve can never put it on the wrong one.
  if (fit.length > 1) return { kind: "review", why: `the title fits ${fit.map((c) => `${c.e.season} ${c.e.code}`).join(" and ")} (no event named: the owner rejects it, or adds it on the event page)` };
  const e = fit[0].e;
  const found = findMatch(tm, matchesOf(e));
  if ("why" in found) return { kind: "review", why: `${e.season} ${e.code}: ${found.why}`, event: e };
  const m = found.match;
  if (!m.played) return { kind: "review", why: `${e.season} ${e.code} ${m.label} wasn't played`, event: e, match: m };
  // A title cut off ("… Ontario Provincial ...") may have named a division or another event in what's missing.
  if (/(?:\.\.\.|…)\s*$/.test(v.title)) return { kind: "review", why: `the title is cut off: what it leaves out may name a division or another event`, event: e, match: m };
  const teams = titleTeams(rest);
  const stray = teams.filter((n) => !m.teams.includes(n));
  if (stray.length) return { kind: "review", why: `the title names team${stray.length === 1 ? "" : "s"} ${stray.join(", ")}, not in ${e.season} ${e.code} ${m.label} (${m.teams.join(", ")})`, event: e, match: m };
  return { kind: "add", event: e, match: m, t: 0, why: `${e.season} ${e.code} ${m.label}: the title names this match${teams.length ? ` and its team${teams.length === 1 ? "" : "s"} ${teams.join(", ")}` : ""}, and only this event (ran ${e.start.slice(0, 10)}${e.end && e.end.slice(0, 10) !== e.start.slice(0, 10) ? ` to ${e.end.slice(0, 10)}` : ""}, went up ${pub})` };
}

/**
 * The events an upload can be, found fast: a channel's region's competitions (by its rule), those under way or ended at
 * most UPLOAD_LAG_DAYS (60) before the day it went up, a day's slack for time zones. matchUpload checks each again; this only spares it every other event.
 */
export function nearEvents(events: WatchEvent[]): (rule: ChannelRule, published: string | null) => WatchEvent[] {
  const byRule = new Map<string, WatchEvent[]>();
  return (rule, published) => {
    const pub = published?.slice(0, 10);
    if (!pub || !/^\d{4}-\d{2}-\d{2}$/.test(pub)) return [];
    let list = byRule.get(rule.region);
    if (!list) {
      const inRegion = parseRule(rule.region);
      list = inRegion ? events.filter((e) => !NOT_EVENTS.has(e.type) && !e.remote && inRegion(e)).sort((a, b) => a.start.localeCompare(b.start)) : [];
      byRule.set(rule.region, list);
    }
    const from = new Date(Date.parse(`${pub}T00:00:00Z`) - (UPLOAD_LAG_DAYS + 1) * 864e5).toISOString().slice(0, 10);
    return list.filter((e) => e.start.slice(0, 10) <= pub && (e.end || e.start).slice(0, 10) >= from);
  };
}

export interface PlannedUpload { video: UploadVideo; channel: string; verdict: UploadVerdict }

/** Two uploads naming one match (a re-upload, or one mislabelled): neither is added, both are the owner's. Nor is one
 *  for a match an upload already plays (`already`: season|code|label). */
export function claimOnce(plan: PlannedUpload[], already: Iterable<string> = []): PlannedUpload[] {
  const key = (p: PlannedUpload) => (p.verdict.kind === "add" ? `${p.verdict.event.season}|${p.verdict.event.code}|${p.verdict.match.label}` : null);
  const n = new Map<string, number>();
  for (const p of plan) { const k = key(p); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
  const had = new Set(already);
  return plan.map((p) => {
    const k = key(p);
    if (!k || p.verdict.kind !== "add") return p;
    const { event, match } = p.verdict;
    if (had.has(k)) return { ...p, verdict: { kind: "review", why: `${event.season} ${event.code} ${match.label} already plays another upload`, event, match } };
    if (n.get(k)! > 1) return { ...p, verdict: { kind: "review", why: `${n.get(k)} uploads name ${event.season} ${event.code} ${match.label}`, event, match } };
    return p;
  });
}
