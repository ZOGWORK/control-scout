// The thread: what the last question was about, so the next one can refer back to it. A follow-up ("and last season?",
// "who beat them?", "what about at Worlds?") names no team of its own, so read on its own it is a question with no
// subject. It is asked about the team the last answer was about instead.
//
// Only a team the answer was really about is kept (one team: its card's, its stat answer's, or the one team its results
// name). A question about many teams, a place or an event leaves nothing behind, so the next question stands alone
// rather than borrowing a team it never had. It lasts briefly, in this tab only.
//
// The question asked is the one on screen — the address, the heading — never a quiet rewrite of what was typed, so a
// visitor can always see what search was asked.
import type { SearchAnswer, SearchHit } from "../../shared/api";

/** How long a thread lasts: long enough to ask something after the last answer, short enough that an old question can
 *  never answer a new one. */
export const THREAD_MS = 30 * 60_000;

const KEY = "cs.search.thread";

export interface Turn {
  /** The question as asked (the box's, or the results page's). */
  q: string;
  /** The one team that answer was about; null: it named none, or many. */
  team: number | null;
  at: number;
}

/** Words that point back at the last answer's team. */
const BACK = /\b(them|they|their|that team|this team|those teams|these teams)\b/i;
/** Openings that say "the same subject, something else". Kept to the ones that only make sense as a follow-up: "so" and
 *  "then" open plenty of questions of their own, so they never carry. */
const OPENING = /^(?:and|also|what about|how about|same for|what if)\b[\s,:-]*/i;
/** A number of its own: a team asked for (\"4215\", \"team 4215\"), so the question names its own subject. */
const OWN_SUBJECT = /(^|[^\p{L}\d])#?\d{1,5}(?=[^\p{L}\d]|$)/u;
/** A whole follow-up that says only a season ("and 2025?", "what about 2024-25?"): when, never which team. */
const ONLY_SEASON = /^(?:in\s+|for\s+)?(\d{4}(?:-\d{2})?)[?.!]*$/i;
/** The seasons the data holds: in a follow-up a year there is a season, not a team asked for (a team is a number
 *  outside them: 4215, 6980, 18360). */
const isSeason = (year: number) => year >= 2007 && year <= 2030;

/** Whether these words read as a question about the last answer's team rather than one of their own. */
export function followUpText(q: string): boolean {
  const t = q.trim();
  return !!t && (BACK.test(t) || OPENING.test(t));
}

/** The query a follow-up really asks ("and last season?" about 6980 → "6980 last season"), or null when `q` stands on
 *  its own: no team to carry, the same team named again, or words that read as a new subject. */
export function resolveFollowUp(q: string, team: number | null): string | null {
  const t = q.trim().replace(/\s+/g, " ");
  if (team == null || !t) return null;
  // "Who beat them?" — the words point back, so the team goes where they were.
  if (BACK.test(t)) {
    const said = t.replace(BACK, String(team)).replace(/\s+/g, " ").trim();
    return said !== t ? said : null;
  }
  const m = OPENING.exec(t);
  const rest = m ? t.slice(m[0].length).trim() : "";
  // "And 2025?" — a season is when, not which team: the team goes in front of it ("6980 2025").
  if (rest) {
    const season = ONLY_SEASON.exec(rest);
    if (season && isSeason(Number(season[1].slice(0, 4)))) return `${team} ${season[1]}`;
  }
  // A team asked for by its number ("and 4215?"): the question names its own subject.
  if (OWN_SUBJECT.test(t)) return null;
  // "And last season?" — the team goes in front of what's left once the opening is gone.
  return rest ? `${team} ${rest}` : null;
}

/** The one team an answer was about: a question's card team, a stat answer's single team, or the one team its results
 *  name first. A set of teams (a place's teams, a leaderboard) carries nothing, nor does an answer that leads with a
 *  place or an event. */
export function teamOf(s: { answer?: SearchAnswer | null; hits?: readonly SearchHit[] }): number | null {
  const a = s.answer;
  const fromAnswer = a?.card?.team?.number ?? a?.stat?.team?.number ?? (a?.stat?.teams?.length === 1 ? a.stat.teams[0].number : null);
  if (fromAnswer != null) return fromAnswer;
  const hits = s.hits ?? [];
  const teams = hits.filter((h) => h.kind === "team");
  return teams.length === 1 && hits[0]?.kind === "team" ? Number(teams[0].ref) || null : null;
}

function read(now: number): Turn | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Turn;
    if (!t || typeof t.q !== "string" || typeof t.at !== "number" || now - t.at > THREAD_MS) return null;
    return { q: t.q, team: typeof t.team === "number" ? t.team : null, at: t.at };
  } catch {
    return null;
  }
}

/** The thread this tab is in the middle of: the last question answered, or null (nothing yet, too old, no storage). */
export function lastTurn(now = Date.now()): Turn | null {
  return read(now);
}

/** Keep an answer's question as the thread's latest. A follow-up that named no team (the box answering "and last
 *  season?" while it is typed) doesn't become the subject: the team it was asked about stays, so Enter still has it. */
export function rememberTurn(said: { q: string; answer?: SearchAnswer | null; hits?: readonly SearchHit[] }, now = Date.now()): void {
  const q = said.q.trim().replace(/\s+/g, " ");
  if (!q) return;
  const team = teamOf(said);
  if (team == null && followUpText(q)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ q, team, at: now } satisfies Turn));
  } catch {
    /* No storage (a private window's quota): the thread lasts as long as the page does, as before. */
  }
}

/** Leave the thread (a test's clean start, and nothing else: a new question is remembered over the old one). */
export function forgetTurn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}
