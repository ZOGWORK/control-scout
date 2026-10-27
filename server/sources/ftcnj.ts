// FTC New Jersey's own event page (newjerseyftc.com/upcoming-events.html): who is registered for each NJ
// event, weeks before FIRST publishes a team list, plus the details FIRST doesn't carry (hosts, check-in and
// end times, capacity, format, closed). A stopgap, never official: it's stored apart from FIRST's fields
// (event_provisional, migration 47) and the event page shows it, labelled, only while FIRST has no team
// list and no schedule for the event (api/events.ts). Matches, schedules and results only ever come from FIRST.

/** The page this source reads (also the link the event page shows). */
export const FTCNJ_URL = "https://www.newjerseyftc.com/upcoming-events.html";
export const FTCNJ_SOURCE = "ftcnj";

export interface NjTeam {
  team: number;
  /** The name as the NJ page spells it (null when the page gives none). */
  name: string | null;
  /** registered, or pending (the page's waitlist). */
  status: "registered" | "pending";
  /** AM/PM events list each session's teams apart; null otherwise. */
  session: "AM" | "PM" | null;
}

export interface NjEvent {
  date: string;           // YYYY-MM-DD
  title: string;
  /** The league the title names (Northern, Northeast, Central, Southern), null when it names none. */
  league: string | null;
  nickname: string | null;
  hosts: string | null;
  venue: string | null;
  address: string | null;
  capacity: string | null;
  /** Check-in, inspection, session and end times, as the page words them. */
  schedule: string[];
  /** Format notes: qualification matches offered, eliminations, judging, AM/PM sessions. */
  notes: string[];
  closed: boolean;
  teams: NjTeam[];
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: "-", mdash: "-" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** The page as trimmed text lines: block tags and <br> end a line. */
export function pageLines(html: string): string[] {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/?(p|div|li|ol|ul|h\d|tr|td|table)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .replace(/[​﻿]/g, "")
    .replace(/[ �]/g, " ")
    // A few lines run into the next item without a tag between them ("…NJ 08854Team Capacity = 24").
    .replace(/(\S)(Team Capacity|Team Check[- ]In|A Printed Roster)/g, "$1\n$2")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** The season the page is for ("Welcome to the 2026/2027 … Season"): its first year, or null. */
export function pageSeason(lines: string[]): number | null {
  for (const l of lines) {
    const m = /\b(20\d\d)\s*[/–-]\s*(20\d\d)\b.*season/i.exec(l);
    if (m && Number(m[2]) === Number(m[1]) + 1) return Number(m[1]);
  }
  return null;
}

const DATE_LINE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s*(\d{1,2}),\s*\d{4}\s*:\s*(.*)$/i;
const TEAM_LINE = /^(\d{1,5})\s*-{1,2}\s*(.*)$/;
const ROSTER_HEAD = /^(Registered|Pending)\s*(AM|PM)?\b\s*(.*)$/i;
const LEAGUE = /\b(Northern|Northeast|Central|Southern)\s+(?:League|Meet)\b/gi;
const HAS_LEAGUE = new RegExp(LEAGUE.source, "i"); // for .test(): a /g regex keeps state between calls

const isSchedule = (l: string) => /check[- ]?in|inspection|\bends?\b|session\s*:/i.test(l);
const isNote = (l: string) => /qualification match|elimination|judging|AM\/PM|AM or PM|printed roster/i.test(l);

/**
 * Every event on the page, in page order. `season` is the season's first year: the page drops the year's
 * meaning (it once wrote "Dec. 12, 2027" for 2026), so the month decides it (Aug–Dec: that year, Jan–Jul: the next).
 */
export function parseNjEvents(html: string, season: number): NjEvent[] {
  const lines = pageLines(html);
  const out: NjEvent[] = [];
  let ev: NjEvent | null = null;
  let roster: { status: NjTeam["status"]; session: NjTeam["session"] } | null = null;
  let afterHosts = false;
  const pre: string[] = []; // lines between the title and the address, to find the venue
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const d = DATE_LINE.exec(l);
    if (d) {
      const month = MONTHS[d[1].toLowerCase()];
      const year = month >= 8 ? season : season + 1;
      let title = d[3];
      // A tournament title runs onto a second line ("… Conference,\nNortheast League Tournament (Saturday)"),
      // sometimes without the comma ("FTCNJ Deep South Conference\nSouthern League Tournament (Sunday)").
      const next = lines[i + 1];
      if (next && !DATE_LINE.test(next) && (/,$/.test(title) || (!HAS_LEAGUE.test(title) && HAS_LEAGUE.test(next)))) title = `${title} ${lines[++i]}`;
      title = title.replace(/\s+/g, " ").trim();
      const leagues = [...title.matchAll(LEAGUE)];
      ev = {
        date: `${year}-${String(month).padStart(2, "0")}-${String(Number(d[2])).padStart(2, "0")}`, title,
        league: leagues.length ? cap(leagues[leagues.length - 1][1]) : null,
        nickname: null, hosts: null, venue: null, address: null, capacity: null, schedule: [], notes: [], closed: false, teams: [],
      };
      out.push(ev);
      roster = null; afterHosts = false; pre.length = 0;
      continue;
    }
    if (!ev) continue;
    const head = ROSTER_HEAD.exec(l);
    if (head && (head[1].toLowerCase() === "pending" || /^registered/i.test(l))) {
      roster = { status: head[1].toLowerCase() === "pending" ? "pending" : "registered", session: (head[2]?.toUpperCase() as "AM" | "PM") ?? null };
      if (head[3]) addTeam(ev, head[3], roster);
      continue;
    }
    if (roster) { addTeam(ev, l, roster); continue; }
    if (/this event is closed/i.test(l)) { ev.closed = true; continue; }
    const cap_ = /Team Capacity\s*=\s*(.+)$/i.exec(l);
    if (cap_) { ev.capacity = cap_[1].trim(); continue; }
    if (/^".*"$/.test(l) || /^“.*”$/.test(l)) { ev.nickname = l.slice(1, -1).trim(); continue; }
    if (/^(co-)?hosted by\b|^supported by\b/i.test(l)) {
      const h = l.replace(/^(co-)?hosted by\s*(the\s+)?/i, "").replace(/:$/, "").trim();
      ev.hosts = ev.hosts ? `${ev.hosts}; ${h}` : h;
      afterHosts = true;
      continue;
    }
    if (isNote(l)) { if (!/printed roster/i.test(l)) pushOnce(ev.notes, l); continue; }
    if (isSchedule(l)) { pushOnce(ev.schedule, l); continue; }
    if (!ev.address && /^\d+\s+\S/.test(l) && /\bNJ\b|New Jersey/i.test(l)) {
      ev.address = l.replace(/[\\,\s]+$/, "");
      // The venue is the line right above the address (host team lists can sit between "Hosted by" and it).
      const v = pre[pre.length - 1];
      if (v) ev.venue = v.replace(/,\s*$/, "");
      afterHosts = false;
      continue;
    }
    if (!ev.address) {
      // A co-host list continued on its own lines ("9848--GearView; 12441--C.V.T.D.; …").
      if (afterHosts && TEAM_LINE.test(l) && pre.length === 0) { ev.hosts = `${ev.hosts}${/teams$/i.test(ev.hosts ?? "") ? " " : "; "}${l}`; continue; }
      pre.push(l);
    }
  }
  return out;
}

function addTeam(ev: NjEvent, line: string, r: { status: NjTeam["status"]; session: NjTeam["session"] }) {
  const m = TEAM_LINE.exec(line);
  if (!m) return;
  const team = Number(m[1]);
  if (ev.teams.some((t) => t.team === team)) return; // the page sometimes lists a team twice
  const name = m[2].trim();
  ev.teams.push({ team, name: name || null, status: r.status, session: r.session });
}

const pushOnce = (a: string[], s: string) => { if (!a.includes(s)) a.push(s); };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1).toLowerCase();

/** FIRST's league codes for New Jersey's leagues. */
const LEAGUE_CODE: Record<string, string> = { Northern: "NO", Northeast: "NE", Central: "CEN", Southern: "SO" };

export interface FirstNjEvent { code: string; name: string; type: string | null; league: string | null; start: string | null }

export interface NjMatch {
  code: string;
  event: NjEvent;
  /** This FIRST event's teams: one session's when the page splits them by session, else all of them. */
  teams: NjTeam[];
  /** FIRST splits the event into AM and PM sessions but the page doesn't say which teams are in which. */
  sessionUnknown: boolean;
}

/**
 * Each NJ page event's FIRST event(s): same date and league. An AM/PM event is two FIRST events
 * ("P1-5 AM …", "P1-5 PM …"); each gets its own session's teams when the page lists them by session.
 * Page events with no FIRST event (or a date that matches more than the AM/PM pair) are left out.
 */
export function matchNjEvents(nj: NjEvent[], first: FirstNjEvent[]): { matched: NjMatch[]; unmatched: NjEvent[] } {
  const matched: NjMatch[] = [], unmatched: NjEvent[] = [];
  for (const e of nj) {
    const league = e.league ? LEAGUE_CODE[e.league] : null;
    const cands = first.filter((f) => f.start === e.date && league != null && f.league === league && f.type !== "Kickoff" && f.type !== "Scrimmage");
    const sessionOf = (f: FirstNjEvent) => (/\bAM\b/.test(f.name) ? "AM" : /\bPM\b/.test(f.name) ? "PM" : null);
    if (cands.length === 1 && sessionOf(cands[0]) == null) {
      matched.push({ code: cands[0].code, event: e, teams: e.teams, sessionUnknown: false });
    } else if (cands.length >= 1 && cands.length <= 2 && cands.every((f) => sessionOf(f) != null)) {
      const split = e.teams.some((t) => t.session != null);
      for (const f of cands) {
        const s = sessionOf(f);
        // Pending teams haven't picked a session yet: they go with both.
        const teams = split ? e.teams.filter((t) => t.session === s || t.session == null) : e.teams;
        matched.push({ code: f.code, event: e, teams, sessionUnknown: !split });
      }
    } else unmatched.push(e);
  }
  return { matched, unmatched };
}

/** Fetch the page (the site is a small volunteer-run one: one request per sync, at most every few hours). */
export async function fetchNjPage(timeoutMs = 30000): Promise<string> {
  const res = await fetch(FTCNJ_URL, {
    headers: { "user-agent": "control-scout (+https://controlscout.org)", accept: "text/html" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`newjerseyftc.com HTTP ${res.status}`);
  return res.text();
}
