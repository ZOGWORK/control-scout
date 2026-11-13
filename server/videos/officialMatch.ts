// Which Scout event an official channel's new video is (docs/official-videos.md, "How a video is matched"): the
// rules the checked list was built with, for one video at a time. Pure: the auto-watcher (./officialWatch.ts) reads
// the channel's rule, the events around the broadcast date and the video's facts, and this says add, review or ignore.
// Add only when every check passes and exactly one event fits; anything short of that is for the owner to decide.
import { localDate } from "./officialVideos.js";

/** A channel's patch: which events can be its (docs/official-videos.md). Clauses separated by ";", each key=values:
 *  country=Romania · state=VA,MD,DC · type=Premier,OffSeason · name=<regex on the event's name>. All must hold. */
export interface ChannelRule { region: string; /** Words of the region itself, too common in its titles to count as evidence. */ words?: string | null; /** A title naming this regex is about the region's own events (its championship). */ titlePattern?: string | null }
export interface WatchEvent {
  season: number; code: string; name: string; type: string; city: string | null; state: string | null; country: string | null;
  start: string; end: string | null; timezone: string | null; divisionCode: string | null; /** Other events name this one as their parent. */ parent: boolean;
}
export interface WatchVideo {
  videoId: string; title: string; /** liveStreamingDetails.actualStartTime: null for an upload. */ start: string | null;
  durationS: number | null; privacy: string; embeddable: boolean; /** Countries YouTube blocks it in. */ blockedIn: number;
}
export type Verdict =
  | { kind: "add"; event: WatchEvent; day: string; part: string | null; why: string }
  | { kind: "review"; why: string; event?: WatchEvent; day?: string; part?: string | null }
  | { kind: "ignore"; why: string };

const MIN_RECORDING_S = 45 * 60;

export function parseRule(region: string): ((e: WatchEvent) => boolean) | null {
  const clauses = region.split(";").map((c) => c.trim()).filter(Boolean);
  if (!clauses.length) return null;
  const tests: ((e: WatchEvent) => boolean)[] = [];
  for (const c of clauses) {
    const m = /^(country|state|type|name)\s*=\s*(.+)$/i.exec(c);
    if (!m) return null;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "name") {
      let re: RegExp;
      try { re = new RegExp(val, "i"); } catch { return null; }
      tests.push((e) => re.test(e.name));
      continue;
    }
    const set = new Set(val.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
    if (!set.size) return null;
    tests.push((e) => set.has(String((key === "country" ? e.country : key === "state" ? e.state : e.type) ?? "").toLowerCase()));
  }
  return (e) => tests.every((t) => t(e));
}

const US = "alabama arizona california colorado georgia hawaii iowa illinois indiana massachusetts maryland minnesota mississippi york oregon pennsylvania texas utah virginia vermont wisconsin hampshire connecticut maine rhode";
const STOP = new Set(("the a of and de la le at in on for by with from first tech challenge ftc robotics robotica league leagues tournament competitie regionala day days live stream streams qualifier qualifiers qualifying event events championship championships campionatul national nationala division divisions ro season matches match state x meet meets presented school high academy university college center centre "
  + "decode into deep centerstage biobuzz powerplay energize freight frenzy ultimate goal skystone rover ruckus game changers january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday "
  + "quals finals final playoffs full recording part city usa remote hybrid " + US).split(" "));
export const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const toks = (s: string, extra: Set<string>) => new Set(norm(s).split(" ").filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STOP.has(t) && !extra.has(t)));
/** The acronyms an event's name goes by: its all-capital words of 3 letters or more ("APOC"), lowercased, leaving out
 *  the common ones ("FTC") and the region's own words. */
const acronyms = (name: string, extra: Set<string>) => (name.match(/\b[A-Z]{3,}\b/g) ?? []).map((w) => w.toLowerCase()).filter((a) => !STOP.has(a) && !extra.has(a));
/** Every acronym a title spells out with 3 to 6 words in a row ("Asia Pacific Open Championship" → "apoc"). */
function spelled(title: string): Set<string> {
  const w = norm(title).split(" ").filter((t) => /^[a-z]/.test(t));
  const out = new Set<string>();
  for (let i = 0; i < w.length; i++) for (let n = 3; n <= 6 && i + n <= w.length; n++) out.add(w.slice(i, i + n).map((t) => t[0]).join(""));
  return out;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
const num = (s: string) => ROMAN[s.toLowerCase()] ?? Number(s);
type Designators = { letter?: string; meet?: number; n?: number; uil?: string; stage?: string; ampm?: string };
/** The parts of a name or title that tell like events apart: an NTX league letter, a meet or qualifier number, a UIL class, a stage, AM/PM. */
export function designators(s: string): Designators {
  const d: Designators = {};
  let m: RegExpExecArray | null;
  if ((m = /\b([A-Z])[- ]League\b/.exec(s))) d.letter = m[1];
  if ((m = /\bmeet\s*#?\s*(\d+)/i.exec(s))) d.meet = Number(m[1]);
  if ((m = /(?:qualifier|scrimmage|tournament|regional|qt)\s*#\s*(\d+)|#\s*(\d+)\s*(?:[-\w ]{0,20})?(?:qualifier|tournament|regional|turneu)/i.exec(s))) d.n = Number(m[1] ?? m[2]);
  else if ((m = /\b(\d|I{1,3}|IV)\s+(?:qualifier|scrimmage)\b|\b(?:qualifier|scrimmage)\s+(\d|I{1,3}|IV)\b/i.exec(s))) d.n = num(m[1] ?? m[2]);
  if ((m = /\b(1A-4A|5A|6A)\b/i.exec(s))) d.uil = m[1].toUpperCase();
  if ((m = /\b(stage (?:left|right))\b/i.exec(s))) d.stage = m[1].toLowerCase();
  if ((m = /\b(AM|PM)\b/.exec(s))) d.ampm = m[1];
  return d;
}

const COMP = /(champs|championship|campionat|qualif|tournament|turneu|regional|league|meet|invitational|premier|scrimmage|state cup|uil|division|\bday\s*\d|super|showcase|\bcup\b|competi|ftc|tech challenge|rodeo|madness|roundup)/i;
const NOT = /(webinar|training|sesiune|workshop|kick ?off|q&a|interview|judg|referee|pregatire|informativ|\bfrc\b|first robotics competition|lego|\bfll\b|\bvex\b|banquet|town hall|info session|mentor|district event|\bweek \d|inspection status|opening ceremon|practice day|test stream|livestream test|pre-?show)/i;
const PART = /(ceremon|award|premier[ei]|finala|finals?\b|alliance selection|playoff|elimination)/i;
const PART_NAME: [RegExp, string][] = [[/alliance selection/i, "Alliance selection & finals"], [/finala/i, "Finals & awards"], [/ceremon|award|premier[ei]/i, "Awards"], [/finals?\b/i, "Finals"], [/playoff/i, "Playoffs"], [/elimination/i, "Eliminations"]];
const FIELD = /(divizia|\bfield\s*\d|\bfield [ab]\b|teren)/i;
const DIVRE = /(?:-\s*|\b)([\p{L}\w' .]+?)\s+Div(?:ision|izia)?\b/iu;
const TYPEHINT: [RegExp, string[]][] = [[/championship|campionat/i, ["Championship", "FIRSTChampionship"]], [/qualif/i, ["Qualifier", "SuperQualifier"]], [/league tournament|turneu de liga|league championship/i, ["LeagueTournament"]], [/scrimmage/i, ["Scrimmage"]], [/league meet/i, ["LeagueMeet"]], [/invitational|premier/i, ["Premier", "OffSeason"]]];
/** Event types that are never a competition with a recording to link. */
export const NOT_EVENTS = new Set(["Kickoff", "VolunteerSignup", "Workshop", "PracticeDay", "DemoExhibition", "Other"]);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function weekday(iso: string, tz: string | null): string {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "long" }).format(new Date(iso)).toLowerCase(); } catch { return ""; }
}
export function partOf(title: string): string | null {
  const r = /matches\s*(\d+)\s*[-–]\s*(\d+)/i.exec(title);
  if (r) return `Matches ${r[1]}–${r[2]}`;
  if (!PART.test(title)) return null;
  return PART_NAME.find(([re]) => re.test(title))?.[1] ?? null;
}

/**
 * Which event a video is, by the checked list's rules. events: the events whose dates are near the broadcast (the
 * rule's region is applied here). An added video is still checked against the event's own videos by the caller.
 */
export function matchVideo(v: WatchVideo, rule: ChannelRule, events: WatchEvent[]): Verdict {
  if (!COMP.test(v.title) || NOT.test(v.title)) return { kind: "ignore", why: "not a competition stream (title)" };
  const inRegion = parseRule(rule.region);
  if (!inRegion) return { kind: "review", why: `the channel's region rule "${rule.region}" can't be read` };
  if (!v.start) return { kind: "review", why: "an upload, not a live broadcast: no broadcast date confirms its day" };
  if (v.durationS == null) return { kind: "review", why: "YouTube gave no length for it, so it can't be told from a clip" };
  if (v.durationS < MIN_RECORDING_S) return { kind: "review", why: `${Math.round(v.durationS / 60)} minutes long: a clip or highlight, not a day's recording` };
  const extra = new Set(norm(rule.words).split(" ").filter(Boolean));
  const vt = toks(v.title, extra);
  const td = designators(v.title);
  const spelledOut = spelled(v.title);
  const dn = /\bday\s*(\d)\b/i.exec(v.title)?.[1] ?? null;
  const dw = /\bday (one|two|three|four)\b/i.exec(v.title)?.[1]?.toLowerCase();
  const titleDay = dn ? Number(dn) : dw ? ({ one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[dw] : null;
  const wd = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(v.title)?.[1]?.toLowerCase() ?? null;
  // A date in the title, year included: 2026-01-17 · 1/17/2026 · 1/17/26 · 17.01.26 or 26.01.17 (either reading may fit).
  const dm = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b|\b(\d{2})\.(\d{2})\.(\d{2})\b/.exec(v.title);
  const yr = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const titleDates = !dm ? null
    : dm[1] ? [iso(Number(dm[1]), Number(dm[2]), Number(dm[3]))]
    : dm[4] ? [iso(yr(dm[6]), Number(dm[4]), Number(dm[5]))]
    : [iso(yr(dm[9]), Number(dm[8]), Number(dm[7])), iso(yr(dm[7]), Number(dm[8]), Number(dm[9]))];
  const idHit = (() => { if (!rule.titlePattern) return false; try { return new RegExp(rule.titlePattern, "i").test(v.title); } catch { return false; } })();
  type Cand = { e: WatchEvent; d: string; score: number; real: boolean; why: string[] };
  const cands: Cand[] = [];
  for (const e of events) {
    if (NOT_EVENTS.has(e.type) || !inRegion(e)) continue;
    const d = localDate(v.start, e.timezone);
    if (d < e.start || d > (e.end || e.start)) continue;
    const ed = designators(e.name);
    const why: string[] = [];
    for (const k of ["letter", "meet", "n", "uil", "stage", "ampm"] as const) if (td[k] != null && ed[k] != null && td[k] !== ed[k]) why.push(k);
    if (td.letter && !ed.letter) why.push("letter");
    if (ed.letter && !td.letter) why.push("letter-missing");
    if (td.uil && !ed.uil) why.push("uil");
    if (ed.stage && !td.stage) why.push("stage-missing");
    const isDiv = !!(e.divisionCode && e.divisionCode !== e.code);
    const divName = isDiv ? norm(DIVRE.exec(e.name)?.[1] ?? "").split(" ").pop() : null;
    if (isDiv && divName && !norm(v.title).split(" ").includes(divName)) why.push("division");
    if (!isDiv && e.parent && /\bdivi(?:sion|zia|sione|sie)\b/i.test(v.title)) why.push("parent-but-division");
    const et = toks(`${e.name} ${e.city ?? ""}`, extra);
    // Evidence beyond the event type: a designator or a distinctive word of its name or city that agree; or, for a
    // title naming the region itself (its championship), the type alone.
    let score = 0, real = false;
    for (const [re, ty] of TYPEHINT) if (re.test(v.title) && ty.includes(e.type)) score++;
    for (const k of ["letter", "uil", "stage", "n", "meet"] as const) if (td[k] != null && td[k] === ed[k]) { score++; real = true; }
    for (const t of vt) if (et.has(t)) { score++; real = true; }
    // An event named by its acronym, and a title spelling it out: "APOC" and "Asia Pacific Open Championship".
    for (const a of acronyms(e.name, extra)) if (!vt.has(a) && spelledOut.has(a)) { score++; real = true; }
    if (!real && idHit && score > 0) real = true;
    cands.push({ e, d, score, real, why });
  }
  if (!cands.length) return { kind: "review", why: "no Scout event in the channel's region on the broadcast date" };
  const ok = cands.filter((c) => !c.why.length && c.score > 0 && c.real).sort((a, b) => b.score - a.score);
  const [a, b] = ok;
  if (!a) {
    const best = [...cands].sort((x, y) => y.score - x.score)[0];
    return { kind: "review", why: `no event on that date fits the title${best ? ` (closest: ${best.e.code}${best.why.length ? `, differs on ${best.why.join(", ")}` : ""})` : ""}`, ...(best ? { event: best.e, day: best.d } : {}) };
  }
  const at = { event: a.e, day: a.d, part: partOf(v.title) };
  // Two events that both fit, whatever their scores, are for the owner to tell apart.
  if (b) return { kind: "review", why: `the title fits both ${a.e.code} and ${b.e.code}`, ...at };
  if (titleDates && !titleDates.includes(a.d)) return { kind: "review", why: `the title's date ${titleDates[0]} isn't the broadcast's (${a.d})`, ...at };
  if (wd && wd !== weekday(v.start, a.e.timezone)) return { kind: "review", why: `the title says ${wd}, the broadcast was on ${weekday(v.start, a.e.timezone)}`, ...at };
  if (v.privacy !== "public" || !v.embeddable || v.blockedIn >= 50) return { kind: "review", why: `not a public video that plays here (${v.privacy}${v.embeddable ? "" : ", not embeddable"}${v.blockedIn ? `, blocked in ${v.blockedIn} countries` : ""})`, ...at };
  // One video at a time can't check the days line up across the event (the list could), so a title's day must be the event's own.
  const eventDay = daysBetween(a.e.start, a.d) + 1;
  if (titleDay != null && titleDay !== eventDay) return { kind: "review", why: `the title says day ${titleDay}, the broadcast was the event's day ${eventDay}`, ...at };
  if (FIELD.test(v.title) && !(a.e.divisionCode && a.e.divisionCode !== a.e.code)) return { kind: "review", why: "one field's stream of a one-event meet", ...at };
  return { kind: "add", ...at, why: `${a.e.code}, ${a.d}: title and broadcast date fit only this event` };
}
