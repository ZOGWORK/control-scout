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
  /** Played remotely: each team on its own field, scored from its own videos (2020-21). */ remote?: boolean;
}
export interface WatchVideo {
  videoId: string; title: string; /** liveStreamingDetails.actualStartTime: null for an upload. */ start: string | null;
  /** When it went up on the channel (the uploads list's videoPublishedAt): an upload's only date. */ published?: string | null;
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
type Designators = { letter?: string; /** "1", or "1a" for a meet split in two ("NTX I-League Meet #1a"). */ meet?: string; n?: number; uil?: string; stage?: string; ampm?: string };
/** The parts of a name or title that tell like events apart: an NTX league letter, a meet or qualifier number, a UIL class, a stage, AM/PM. */
export function designators(s: string): Designators {
  const d: Designators = {};
  let m: RegExpExecArray | null;
  // A league pair's tournament ("C&N League Tournament", Scout's "TX-North C&N Tournament") is one designator, the pair.
  if ((m = /\b([A-Z])\s*&\s*([A-Z])(?:[- ]League\b|\s+(?:League\s+)?Tournament\b)/.exec(s))) d.letter = `${m[1]}&${m[2]}`;
  else if ((m = /\b([A-Z])[- ]League\b/.exec(s))) d.letter = m[1];
  if ((m = /\bmeet\s*#?\s*(\d+)([a-z])?\b/i.exec(s))) d.meet = `${Number(m[1])}${(m[2] ?? "").toLowerCase()}`;
  if ((m = /(?:qualifier|scrimmage|tournament|regional|qt)\s*#\s*(\d+)|#\s*(\d+)\s*(?:[-\w ]{0,20})?(?:qualifier|tournament|regional|turneu)/i.exec(s))) d.n = Number(m[1] ?? m[2]);
  else if ((m = /\b(\d|I{1,3}|IV)\s+(?:qualifier|scrimmage)\b|\b(?:qualifier|scrimmage)\s+(\d|I{1,3}|IV)\b/i.exec(s))) d.n = num(m[1] ?? m[2]);
  // SoCal's inter-league tournaments (its qualifiers): "SoCal FTC ILT #6" streams "SoCal FTC Qualifier 6", "SoCal ILT3".
  else if ((m = /\bILT\s*#?\s*(\d+)\b/i.exec(s))) d.n = Number(m[1]);
  if ((m = /\b(1A-4A|5A|6A)\b/i.exec(s))) d.uil = m[1].toUpperCase();
  if ((m = /\b(stage (?:left|right))\b/i.exec(s))) d.stage = m[1].toLowerCase();
  if ((m = /\b(AM|PM)\b/.exec(s))) d.ampm = m[1];
  return d;
}

const COMP = /(champs|championship|campionat|qualif|tournament|turneu|regional|league|\bmeets?(?![a-z])|invitational|premier|scrimmage|state cup|uil|division|\bday\s*\d{1,2}(?!\d)|super|showcase|\bcup\b|competi|ftc|tech challenge|rodeo|madness|roundup)/i;
const NOT = /(webinar|training|sesiune|workshop|kick ?off|q&a|interview|judg|referee|pregatire|informativ|\bfrc\b|first robotics competition|lego|\bfll\b|\bvex\b|banquet|town hall|info session|mentor|district event|\bweek \d|inspection status|opening ceremon|practice day|test stream|livestream test|pre-?show|first global|\bfgc\b|\bdrones?\b|\bdcl\b|simulator|\bursim\b|\bxrc\b|\b(?:rebuilt|reefscape|crescendo|charged up|rapid react|infinite recharge)\b|coach(?:es)?'? (?:call|corner)|program call|\bmeeting\b|legislature|committee|\bcouncil\b|keynote|\bnemc\b|sports day|robot in 30 hours|\bri30h\b|\bri3d\b|robot reveals?|\brecap\b|вебинар|\bfllc\b|gaming league|minecraft|valorant|rocket league|dungeons|\btop 25\b|predictions|board of education|meet the candidates|\bdiscuti[ae]\b|detalii tehnice)/i;
const PART = /(ceremon|award|premier[ei]|finala|finals?\b|alliance selection|playoff|elimination|\bmorning\b|\bafternoon\b|(?:before|after) lunch)/i;
const PART_NAME: [RegExp, string][] = [[/alliance selection/i, "Alliance selection & finals"], [/finala/i, "Finals & awards"], [/ceremon|award|premier[ei]/i, "Awards"], [/finals?\b/i, "Finals"], [/playoff/i, "Playoffs"], [/elimination/i, "Eliminations"], [/\bmorning\b/i, "Morning"], [/\bafternoon\b/i, "Afternoon"], [/before lunch/i, "Before lunch"], [/after lunch/i, "After lunch"]];
const FIELD = /(divizia|\bfield\s*\d|\bfield [ab]\b|teren)/i;
const DIVRE = /(?:-\s*|\b)([\p{L}\w' .]+?)\s+Div(?:ision|izia)?\b/iu;
const TYPEHINT: [RegExp, string[]][] = [[/championship|campionat/i, ["Championship", "FIRSTChampionship"]], [/qualif/i, ["Qualifier", "SuperQualifier"]], [/league tournament|turneu de liga|league championship/i, ["LeagueTournament"]], [/scrimmage/i, ["Scrimmage"]], [/league meet/i, ["LeagueMeet"]], [/invitational|premier/i, ["Premier", "OffSeason"]]];
/** Event types that are never a competition with a recording to link. */
export const NOT_EVENTS = new Set(["Kickoff", "VolunteerSignup", "Workshop", "PracticeDay", "DemoExhibition", "Other"]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
/** "November 14, 2026", "Nov 14 2026", "14 November 2026". */
const MONTHDATE = new RegExp(`\\b${MON}\\.? (\\d{1,2})(?:st|nd|rd|th)?,? (\\d{4})\\b|\\b(\\d{1,2}) ${MON},? (\\d{4})\\b`, "i");
const monthOf = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1 || null;
/**
 * The dates a title says, year included, each reading that is a real date: 2026-01-17 · 1/17/2026 · 1/17/26 ·
 * 17.01.26, 01.17.26 or 26.01.17 (any reading may fit) · November 14, 2026 · 14 Nov 2026. null when it says none.
 */
export function titleDatesOf(title: string, ref?: string | null): string[] | null {
  const dm = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b|(?<![\d.])(\d{2})[._](\d{2})[._](\d{2})(?![\d.])/.exec(title);
  const yr = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  // A reading that isn't a real date is no reading: "12.17.23" is only December 17 (month.day.year).
  const iso = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  const readings: (string | null)[] = !dm ? []
    : dm[1] ? [iso(Number(dm[1]), Number(dm[2]), Number(dm[3]))]
    : dm[4] ? [iso(yr(dm[6]), Number(dm[4]), Number(dm[5]))]
    : [iso(yr(dm[9]), Number(dm[8]), Number(dm[7])), iso(yr(dm[9]), Number(dm[7]), Number(dm[8])), iso(yr(dm[7]), Number(dm[8]), Number(dm[9]))];
  const named = MONTHDATE.exec(title);
  if (named) {
    const [, m1, d1, y1, d2, m2, y2] = named;
    const m = monthOf(m1 ?? m2);
    if (m) readings.push(iso(Number(y1 ?? y2), m, Number(d1 ?? d2)));
  }
  // "Tournament 12/13" (no year), read against the video's own date: the latest such day on or before it, within 60 days.
  const short = !dm && !named && ref ? /(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(title) : null;
  if (short) {
    const y = Number(ref!.slice(0, 4));
    const d = [iso(y, Number(short[1]), Number(short[2])), iso(y - 1, Number(short[1]), Number(short[2]))].find((x) => x && x <= ref!.slice(0, 10));
    if (d && daysBetween(d, ref!.slice(0, 10)) <= 60) readings.push(d);
  }
  const dates = [...new Set(readings.filter((r): r is string => r != null))];
  return dates.length ? dates : null;
}

/** How long after a one-day event an upload of it can go up and still be dated by when it went up. */
const UPLOAD_LAG_DAYS = 14;

/**
 * The days to find a video's events in: a day either side of its broadcast's date, else (an upload) of the one date
 * its title says, else the two weeks before it went up (an upload of a one-day event, dated by when it went up).
 */
export function videoWindow(v: Pick<WatchVideo, "title" | "start" | "published">): [string, string] | null {
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const titled = v.start ? null : titleDatesOf(v.title, v.published);
  const d = v.start ? v.start.slice(0, 10) : titled?.length === 1 ? titled[0] : null;
  if (d) return [shift(d, -1), shift(d, 1)];
  const pub = v.published?.slice(0, 10);
  return !titled && pub && /^\d{4}-\d{2}-\d{2}$/.test(pub) ? [shift(pub, -UPLOAD_LAG_DAYS - 1), pub] : null;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
function weekday(iso: string, tz: string | null): string {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "long" }).format(new Date(iso)).toLowerCase(); } catch { return ""; }
}
/** Why a title isn't a competition stream, naming what in it says so; null when it may be one. */
/** A team's own robot video: "Compact Differential Swerve Drive | 23334 Axiom | FTC BIOBUZZ Snapshot". */
const TEAM_SHOW = /\b(?:robot\s+)?(?:reveal|snapshot)\b|\brobot\s+showcase\b/i;
/** What names an event in a title: a team video names none. ("Showcase" alone can be an event: it counts only as "robot showcase".) */
const EVENT_WORD = /(champs|championship|campionat|qualif|tournament|turneu|regional|league|\bmeets?(?![a-z])|invitational|premier|scrimmage|state cup|\bday\s*\d{1,2}(?!\d)|\bcup\b|competi|rodeo|madness|roundup|\bfinals?\b|playoff|ceremon|award)/i;
/** A team number: 3 to 5 digits standing alone (not a sponsor's "66" or an episode's "12"), never a year (1990–2039). */
const teamNumber = (title: string) => [...title.matchAll(/(?<![\d.\/-])\b(\d{3,5})\b(?![\d.\/-])/g)].some((m) => !/^(199\d|20[0-3]\d)$/.test(m[1]));

export function notCompetition(title: string): string | null {
  const not = NOT.exec(title);
  if (not) return `not a competition stream: the title says "${not[0].trim()}"`;
  // A team's robot reveal, snapshot or showcase, naming no event: the team's own video, not an event's recording.
  const show = TEAM_SHOW.exec(title);
  if (show && teamNumber(title) && !EVENT_WORD.test(title)) return `a team's robot video, not an event recording: the title says "${show[0].trim()}" beside a team number and names no event`;
  if (!COMP.test(title)) return "not a competition stream: the title names no competition (no qualifier, meet, league, tournament, championship or FTC)";
  return null;
}

export function partOf(title: string): string | null {
  const r = /matches\s*(\d+)\s*[-–]\s*(\d+)/i.exec(title);
  if (r) return `Matches ${r[1]}–${r[2]}`;
  if (!PART.test(title)) return null;
  // "Qualification & Playoff matches": the day's matches, all of them, not its playoffs alone.
  if (/qualification|\bquals?\b/i.test(title) && /playoff|elimination|finals?\b/i.test(title) && !/ceremon|award/i.test(title)) return null;
  return PART_NAME.find(([re]) => re.test(title))?.[1] ?? null;
}

/**
 * Which event a video is, by the checked list's rules. events: the events whose dates are near the broadcast (the
 * rule's region is applied here). An added video is still checked against the event's own videos by the caller.
 */
export function matchVideo(v: WatchVideo, rule: ChannelRule, events: WatchEvent[]): Verdict {
  const notComp = notCompetition(v.title);
  if (notComp) return { kind: "ignore", why: notComp };
  const inRegion = parseRule(rule.region);
  if (!inRegion) return { kind: "review", why: `the channel's region rule "${rule.region}" can't be read` };
  const short = v.durationS != null && v.durationS < MIN_RECORDING_S;
  const mins = Math.round((v.durationS ?? 0) / 60);
  // A short upload can't be a day's recording and has no broadcast date to tie it to an event: set aside with why (the
  // owner can still add it as a highlight from the set-aside list). A full-length upload might be a re-uploaded day.
  if (!v.start && short) return { kind: "ignore", why: `a ${mins}-minute upload, not a broadcast: too short for a day's recording (set aside; add it as a highlight if it is one)` };
  if (v.durationS == null) return { kind: "review", why: "YouTube gave no length for it, so it can't be told from a clip" };
  // Not a public video that plays here (private, unlisted, embedding off, blocked in most countries): nothing to link,
  // whichever event it is. Set aside with why; a later change of its settings is read by the next audit.
  if (v.privacy !== "public" || !v.embeddable || v.blockedIn >= 50) return { kind: "ignore", why: `not a public video that plays here (${v.privacy}${v.embeddable ? "" : ", not embeddable"}${v.blockedIn ? `, blocked in ${v.blockedIn} countries` : ""})` };
  const extra = new Set(norm(rule.words).split(" ").filter(Boolean));
  const vt = toks(v.title, extra);
  const td = designators(v.title);
  const spelledOut = spelled(v.title);
  const dn = /\bday\s*(\d{1,2})(?!\d)/i.exec(v.title)?.[1] ?? null;
  const dw = /\bday (one|two|three|four)\b/i.exec(v.title)?.[1]?.toLowerCase();
  const titleDay = dn ? Number(dn) : dw ? ({ one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[dw] : null;
  const wd = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(v.title)?.[1]?.toLowerCase() ?? null;
  const titleDates = titleDatesOf(v.title, v.start ?? v.published);
  const upload = !v.start;
  const UPLOAD = "an upload, not a live broadcast: no broadcast date confirms its day";
  // An upload no date ties to a day, set aside when what it is shows it isn't a day's matches: a ceremony alone (under
  // 90 minutes, its title naming no matches), or one division's stream of the several played at once. Else the owner's.
  const undated = (): Verdict => {
    if (/ceremon|\bawards?\b|premier[ei]/i.test(v.title) && !/match|qualification|\bquals?\b|playoff|elimination|finals?\b|\bday\s*\d/i.test(v.title) && (v.durationS ?? 0) < 90 * 60)
      return { kind: "ignore", why: `an upload of a ceremony alone (${mins} minutes, no matches named), with no date: not a day's matches` };
    if (DIVRE.test(v.title) && !/inter-?division/i.test(v.title))
      return { kind: "ignore", why: "an upload of one division's stream, with no date: its clips would open on whichever division played then" };
    return { kind: "review", why: UPLOAD };
  };
  // An upload has no broadcast date: its day is the title's date when the title reads as exactly one date. With no
  // date in its title, an upload that went up within two weeks of a one-day event is dated by that: the event's one
  // day. (Not a day a title numbers: "Day 4" of an event whose dates include set-up days isn't its fourth date.)
  if (upload && titleDates && titleDates.length !== 1) return undated();
  const uploadDay = upload && titleDates ? titleDates[0] : null;
  const pubDay = v.published && /^\d{4}-\d{2}-\d{2}/.test(v.published) ? v.published.slice(0, 10) : null;
  const lagDay = (e: WatchEvent): string | null => {
    const end = e.end || e.start;
    if (!pubDay || pubDay < end || daysBetween(end, pubDay) > UPLOAD_LAG_DAYS) return null;
    return e.start === end ? e.start : null;
  };
  const lagged = upload && !uploadDay;
  const dayOf = (e: WatchEvent) => (v.start ? localDate(v.start, e.timezone) : uploadDay ?? lagDay(e));
  const weekdayOf = (e: WatchEvent, d: string) => (upload ? weekday(`${d}T12:00:00Z`, "UTC") : weekday(v.start!, e.timezone));
  // A title naming two meets or qualifiers ("Meet #3 / Meet #4"): two events in one video, for the owner.
  const numbered = new Set([...v.title.matchAll(/\b(?:meet|qualifier|qual)\s*#?\s*(\d{1,2})\b/gi)].map((m) => Number(m[1])));
  const saysAll = (name: string) => { const w = [...toks(name, extra)]; return w.length > 0 && w.every((t) => vt.has(t) || spelledOut.has(t)); };
  const idHit = (() => { if (!rule.titlePattern) return false; try { return new RegExp(rule.titlePattern, "i").test(v.title); } catch { return false; } })();
  /** strong: evidence of its own (a designator, a word of its name or city, its acronym), not only the region's name. */
  type Cand = { e: WatchEvent; d: string; score: number; real: boolean; strong: boolean; /** Its name's distinctive words. */ words: Set<string>; why: string[] };
  const cands: Cand[] = [];
  for (const e of events) {
    if (NOT_EVENTS.has(e.type) || !inRegion(e)) continue;
    const d = dayOf(e);
    if (!d) continue;
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
    const strong = real;
    if (!real && idHit && score > 0) real = true;
    cands.push({ e, d, score, real, strong, words: toks(e.name, extra), why });
  }
  if (!cands.length && lagged) {
    // Went up within two weeks of a multi-day event its title names in full: which of its days it is can't be told
    // from the title ("Day 4" of an event whose dates include set-up days isn't its fourth date). Set aside.
    const multi = events.filter((e) => !NOT_EVENTS.has(e.type) && inRegion(e) && e.end && e.end !== e.start && pubDay && pubDay >= e.end
      && daysBetween(e.end, pubDay) <= UPLOAD_LAG_DAYS && saysAll(e.name));
    if (multi.length) return { kind: "ignore", why: `an upload of ${multi.map((e) => e.code).join(" or ")} (${multi[0].start} to ${multi[0].end}) with no date: which of its days it is can't be told` };
    return undated();
  }
  if (!cands.length) return short
    ? { kind: "ignore", why: `${mins} minutes long, and no Scout event in the channel's region on the broadcast date: not a day's recording` }
    : events.some((e) => !NOT_EVENTS.has(e.type) && inRegion(e) && daysBetween(dayOf(e)!, e.start) <= 1 && daysBetween(e.end || e.start, dayOf(e)!) <= 1)
      ? { kind: "review", why: `no Scout event in the channel's region on the ${uploadDay ? "title's date" : "broadcast date"}, but one a day either side` }
      : { kind: "ignore", why: `no Scout event in the channel's region on the ${uploadDay ? "title's date" : "broadcast date"} or a day either side: nothing to put it on` };
  // "FTC Events" for a date: that day's several events in one video, whichever one its title's words also fit.
  if (/\b(?:FTC|FIRST Tech Challenge)\s+events\b/i.test(v.title)) return { kind: "ignore", why: "the title says FTC Events: more than one event in one video" };
  const fits = cands.filter((c) => !c.why.length && c.score > 0 && c.real);
  // One meet over two same-day events told apart only by a suffix or AM/PM ("U-League Meet #1" over Scout's "Meet 1a"
  // and "Meet 1b", or its AM and PM meets), the title saying neither: two events in one video. Set aside.
  if (!td.ampm && !/\bmeet\s*#?\s*\d+[a-z]\b/i.test(v.title)) {
    const base = (n: string) => norm(n.replace(/\b(meet\s*#?\s*\d+)[a-z]\b/i, "$1").replace(/\b(?:AM|PM)\b/g, " "));
    const suffixOnly = (c: Cand) => c.real && c.why.every((w) => w === "meet")
      && (!c.why.length || (td.meet != null && new RegExp(`^${td.meet}[a-z]$`).test(String(designators(c.e.name).meet ?? ""))));
    const groups = new Map<string, Cand[]>();
    // Twins share a day, a name but for the suffix, and a city: meets in two cities are told apart by where.
    for (const c of cands.filter(suffixOnly)) { const k = `${c.d} ${base(c.e.name)} ${norm(c.e.city ?? "")}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
    // Every one a variant: beside a plain "Meet #1", the title's "Meet #1" is that one.
    const twins = [...groups.values()].find((g) => g.length > 1 && g.every((c) => designators(c.e.name).ampm || /\bmeet\s*#?\s*\d+[a-z]\b/i.test(c.e.name)));
    if (twins) return { kind: "ignore", why: `the title fits ${twins.map((c) => c.e.code).join(" and ")}, same-day meets told apart only by ${twins.some((c) => designators(c.e.name).ampm) ? "AM and PM" : "a letter"}: two events in one video` };
  }
  // A title naming the region itself ("FTC Iowa …") makes every one of its events that day plausible, but an event the
  // title names by its own word ("Iris", "Waterloo") or designator is the one it's about: region-name-only fits drop out.
  const own = fits.some((c) => c.strong) ? fits.filter((c) => c.strong) : fits;
  // Two events sharing a word ("CTX GEMS Diamond League Meet 2" and "… Emerald …", "Austin Semi-Regional" and "San
  // Antonio Semi-Regional"): one is contradicted when the title says a word of the other's name that it lacks
  // ("Diamond") and its own name has a word the title doesn't say ("Emerald"), and the title says no word of its own
  // name that other lacks. Named that way both ways (a joint meet: "Hill Country & North SA") nothing drops out, and
  // it drops out only when what's left outscores it: otherwise every fit stays and the owner decides.
  const said = (t: string) => vt.has(t) || spelledOut.has(t);
  const namedOver = (c: Cand, o: Cand) => [...c.words].some((t) => said(t) && !o.words.has(t));
  const contradicted = (c: Cand) => [...c.words].some((t) => !said(t))
    && own.some((o) => o !== c && namedOver(o, c) && !namedOver(c, o));
  const keep = own.filter((c) => !contradicted(c));
  const top = Math.max(0, ...keep.map((c) => c.score));
  const ok = (keep.length && own.every((c) => keep.includes(c) || c.score < top) ? keep : own).sort((a, b) => b.score - a.score);
  const [a, b] = ok;
  if (!a) {
    const best = [...cands].sort((x, y) => y.score - x.score)[0];
    if (short) return { kind: "ignore", why: `${mins} minutes long, and its title fits no event that day: not a day's recording` };
    // Every event that day played remotely (teams on their own fields, scored from their own videos): a stream that
    // names none of them is a ceremony or a show, not one's day of matches.
    if (cands.every((c) => c.e.remote)) return { kind: "ignore", why: `the only Scout events then are remote ones (${cands.slice(0, 3).map((c) => c.e.code).join(", ")}${cands.length > 3 ? ", …" : ""}), and the title names none of them: no matches played together to link` };
    if (lagged) return undated();
    return { kind: "review", why: `no event on that date fits the title${best ? ` (closest: ${best.e.code}${best.why.length ? `, differs on ${best.why.join(", ")}` : ""})` : ""}`, ...(best ? { event: best.e, day: best.d } : {}) };
  }
  const at = { event: a.e, day: a.d, part: partOf(v.title) };
  if (short) return { kind: "ignore", why: `${mins} minutes long: a clip or highlight of ${a.e.code}, not a day's recording (set aside; add it as a highlight if it is one)` };
  if (numbered.size > 1) return { kind: "review", why: `the title names ${numbered.size} meets or qualifiers (${[...numbered].join(", ")}): two events in one video`, ...at };
  // Two events that both fit, whatever their scores, are for the owner to tell apart.
  if (b) return { kind: "review", why: `the title fits both ${a.e.code} and ${b.e.code}`, ...at };
  // A broadcast's own date is YouTube's record; a title's is typed. The title's date is a slip ("2/3/24" streamed on
  // 3/3) when the event the title names by its own words or number doesn't run on it at all: that event that day.
  // An event that runs on the title's date too (a re-stream of an earlier day), or one named by less, is the owner's.
  // Named by its own words means it has some, every one said: a name of region words and stop words names nothing.
  const ownName = a.strong && ((a.words.size > 0 && [...a.words].every(said)) || (["meet", "n", "letter"] as const).some((k) => td[k] != null && td[k] === designators(a.e.name)[k]));
  // A slip is a day or a month off ("2/3/24" for 3/3), never a year: last season's date is another video's.
  const slip = !upload && ownName && !!titleDates && titleDates.every((t) => (t < a.e.start || t > (a.e.end || a.e.start)) && Math.abs(daysBetween(t, a.d)) <= 31);
  if (titleDates && !titleDates.includes(a.d) && !slip) return { kind: "review", why: `the title's date ${titleDates[0]} isn't the broadcast's (${a.d})`, ...at };
  if (wd && wd !== weekdayOf(a.e, a.d)) return { kind: "review", why: `the title says ${wd}, the ${uploadDay ? "title's date" : "broadcast"} was on ${weekdayOf(a.e, a.d)}`, ...at };
  // An upload dated only by its title needs the title to name the event itself (a word of its name, a designator),
  // not only the region's: the date is the uploader's word, so the rest must be the event's own.
  if (uploadDay && !a.strong) return { kind: "review", why: `an upload dated ${uploadDay} by its title, which names ${a.e.code} only by its region`, ...at };
  // An upload dated only by when it went up: two weeks hold more events than a day, so the title must say every
  // distinctive word of the event's name, and name one thing ("Meet 1 & Tournament Qualifications" is two).
  if (lagged && ![...a.words].every(said)) return { kind: "review", why: `an upload with no date, whose title doesn't say all of ${a.e.code}'s name`, ...at };
  if (lagged && /\s(?:&|and|\+)\s/i.test(v.title)) return { kind: "review", why: `an upload with no date, whose title joins two names`, ...at };
  // One video at a time can't check the days line up across the event (the list could), so a title's day must be the event's own.
  const eventDay = daysBetween(a.e.start, a.d) + 1;
  if (titleDay != null && titleDay !== eventDay) return { kind: "review", why: `the title says day ${titleDay}, the broadcast was the event's day ${eventDay}`, ...at };
  // A named division's stream ("Flowers Division") of an event Scout keeps whole: its divisions played at once.
  const ownDiv = !!(a.e.divisionCode && a.e.divisionCode !== a.e.code);
  if (!ownDiv && !a.e.parent && DIVRE.test(v.title) && !/inter-?division/i.test(v.title)) return { kind: "ignore", why: `one division's stream of ${a.e.code}, which Scout has as one event: its clips would open on whichever division played at that time` };
  if (FIELD.test(v.title) && !ownDiv) return { kind: "ignore", why: `one field's stream of ${a.e.code}, which Scout has as one event: its clips would open on whichever field played at that time` };
  const dated = uploadDay ? "the title's date (an upload)" : lagged ? `when it went up (an upload on ${pubDay}, within ${UPLOAD_LAG_DAYS} days of the event's one day)` : "broadcast date";
  // A remote event (2020-21: teams on their own fields) has no matches played together; a stream naming one is its
  // show or ceremony, or a day FIRST did link: which, the owner decides.
  if (a.e.remote) return { kind: "review", why: `${a.e.code} was played remotely: whether this stream is a day of it to link is for the owner`, ...at };
  return { kind: "add", ...at, why: `${a.e.code}, ${a.d}: title and ${dated} fit only this event` };
}

/** The event a video most likely is, when its verdict names none: for the owner's review and the channel audit, never
 *  for an add. Among the competitions in the channel's region from 21 days before the video's date (its broadcast, or
 *  for an upload the day it was published: an upload follows its event) to the day after, the one whose name, city
 *  and designators share most with the title, nearest the date on a tie; with what that guess rests on. */
export function bestGuess(v: Pick<WatchVideo, "title" | "start"> & { published?: string | null }, rule: ChannelRule, events: WatchEvent[]): { event: WatchEvent; day: string; why: string } | { event?: undefined; day?: undefined; why: string } {
  const anchor = (v.start ?? v.published ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return { why: "no best guess: YouTube gave no date for it" };
  const inRegion = parseRule(rule.region);
  if (!inRegion) return { why: `no best guess: the channel's region rule "${rule.region}" can't be read` };
  const extra = new Set(norm(rule.words).split(" ").filter(Boolean));
  const vt = toks(v.title, extra);
  const td = designators(v.title);
  const lo = new Date(Date.parse(anchor) - 21 * 864e5).toISOString().slice(0, 10), hi = new Date(Date.parse(anchor) + 864e5).toISOString().slice(0, 10);
  let best: { e: WatchEvent; score: number; gap: number; said: string[] } | null = null;
  for (const e of events) {
    if (NOT_EVENTS.has(e.type) || !inRegion(e)) continue;
    const end = e.end || e.start;
    if (e.start > hi || end < lo) continue;
    const ed = designators(e.name);
    if ((["letter", "meet", "n", "uil", "stage", "ampm"] as const).some((k) => td[k] != null && ed[k] != null && td[k] !== ed[k])) continue;
    const said = [...toks(`${e.name} ${e.city ?? ""}`, extra)].filter((t) => vt.has(t));
    for (const k of ["letter", "meet", "n", "uil", "stage", "ampm"] as const) if (td[k] != null && td[k] === ed[k]) said.push(`${k === "n" ? "number" : k} ${td[k]}`);
    const gap = Math.abs(daysBetween(end < anchor ? end : e.start > anchor ? e.start : anchor, anchor));
    const score = said.length;
    if (!best || score > best.score || (score === best.score && gap < best.gap)) best = { e, score, gap, said };
  }
  const when = v.start ? "broadcast" : "published";
  if (!best) return { why: `no best guess: no Scout competition in the channel's region from 21 days before it was ${when} (${anchor}) to the day after` };
  const day = best.e.start <= anchor && anchor <= (best.e.end || best.e.start) ? anchor : best.e.end && best.e.end < anchor ? best.e.end : best.e.start;
  const basis = best.said.length ? `the title shares ${best.said.map((t) => `"${t}"`).join(", ")} with it` : "nothing in the title names it: only the nearest event by date";
  return { event: best.e, day, why: `best guess ${best.e.code} (${best.e.name}), ${best.gap ? `${best.gap} day${best.gap === 1 ? "" : "s"} from` : "on"} the day it was ${when}: ${basis}` };
}
