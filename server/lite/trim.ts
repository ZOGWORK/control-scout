// Light pages (docs/lite.md): the rich pages' own answers (the same functions the API answers with), trimmed to
// the fields a light page shows. Pure, so a test can hold the shape to what the page needs and no more.
import type { ConfidenceTier, EventDetail, MatchDetail, MatchView, TeamProfile, TeamSummary } from "../../src/shared/api.js";
import type { PickList } from "../../src/shared/picklist.js";

export interface LiteCall {
  /** P(red wins). */
  pRed: number;
  tier: ConfidenceTier;
  kind: "live" | "backtest" | "now";
  /** Predicted scores; null with no scoring basis yet (win odds only). */
  red: number | null;
  blue: number | null;
  redRange: [number, number] | null;
  blueRange: [number, number] | null;
}

export interface LiteMatchRow {
  key: string;
  label: string;
  time: string | null;
  played: boolean;
  red: number[];
  blue: number[];
  /** Listed but not on the field (a playoff alliance's sitting-out robot): shown apart, as the full pages mark them. */
  off: number[];
  score: { red: number; blue: number } | null;
  call: LiteCall | null;
}

export interface LiteEvent {
  season: number;
  code: string;
  name: string;
  typeLabel: string;
  start: string | null;
  end: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  status: EventDetail["event"]["status"];
  /** Event day: when results were last checked. */
  checkedAt: string | null;
  /** The team list is FIRST's pre-event registrations (no rankings yet). */
  registered: boolean;
  teams: { team: number; name: string | null; rank: number | null; rp: number | null; wins: number | null; losses: number | null; ties: number | null; opr: number | null }[];
  matches: LiteMatchRow[];
  alliances: { number: number; teams: number[] }[];
  awards: { type: string; placement: number; team: number }[];
}

export interface LiteTeam {
  number: number;
  name: string | null;
  school: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rookieYear: number | null;
  season: number;
  seasons: number[];
  stats: {
    opr: { np: number | null; npRank: number | null; of: number | null; auto: number | null; teleop: number | null; endgame: number | null };
    record: { wins: number; losses: number; ties: number; events: number };
    ratingRank: number | null;
  } | null;
  events: { code: string; name: string; start: string | null; end: string | null; rank: number | null; wins: number | null; losses: number | null; ties: number | null; opr: number | null; awards: { type: string; placement: number }[] }[];
  next: (LiteMatchRow & { code: string })[];
  recent: (LiteMatchRow & { code: string })[];
}

export interface LiteMatch {
  season: number;
  code: string;
  event: string;
  key: string;
  label: string;
  description: string | null;
  time: string | null;
  played: boolean;
  red: LiteSide;
  blue: LiteSide;
  call: LiteCall | null;
  /** Unplayed matches: the notable reasons behind the call. */
  reasons: string[];
  sheet: { label: string; depth: 0 | 1; count: boolean; red: number | null; blue: number | null }[] | null;
  prev: { key: string; label: string } | null;
  next: { key: string; label: string } | null;
}

export interface LiteSide {
  score: { total: number; auto: number; teleop: number; endgame: number; pen: number } | null;
  teams: { number: number; name: string | null; surrogate: boolean; dq: boolean; onField: boolean; rank: number | null; wins: number | null; losses: number | null; ties: number | null; opr: number | null; seasonOpr: number | null }[];
}

export interface LitePicks {
  season: number;
  version: number;
  picks: { rank: number; team: number; name: string | null; opr: number | null; oprRank: number | null; record: string | null; note: string; noteBy: string | null }[];
}

const call = (m: MatchView): LiteCall | null => {
  const p = m.prediction;
  if (!p) return null;
  const scored = !p.noScoreBasis;
  return {
    pRed: p.pRed, tier: p.tier, kind: p.kind,
    red: scored ? p.redMean : null, blue: scored ? p.blueMean : null,
    redRange: scored ? p.redRange ?? null : null, blueRange: scored ? p.blueRange ?? null : null,
  };
};

export function liteMatchRow(m: MatchView): LiteMatchRow {
  return {
    key: m.key, label: m.label, time: m.time, played: m.played,
    red: m.red.teams.map((t) => t.number), blue: m.blue.teams.map((t) => t.number),
    off: [...m.red.teams, ...m.blue.teams].filter((t) => !t.onField).map((t) => t.number),
    score: m.played && m.red.score && m.blue.score ? { red: m.red.score.total, blue: m.blue.score.total } : null,
    call: call(m),
  };
}

export function liteEvent(d: EventDetail): LiteEvent {
  const e = d.event;
  return {
    season: e.season, code: e.code, name: e.name, typeLabel: e.typeLabel, start: e.start, end: e.end,
    city: e.city, state: e.state, country: e.country, status: e.status, checkedAt: d.live?.checkedAt ?? null,
    registered: !!d.registered,
    // Ranked teams in rank order, then the rest by number (as the rankings table sorts them).
    teams: [...d.field]
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.team - b.team)
      .map((r) => ({ team: r.team, name: r.name, rank: r.rank, rp: r.rp, wins: r.wins, losses: r.losses, ties: r.ties, opr: r.opr.np })),
    matches: d.matches.map(liteMatchRow),
    alliances: d.alliances.map((a) => ({ number: a.number, teams: [a.captain, a.pick1, a.pick2, a.backup].filter((t): t is number => t != null) })),
    awards: d.awards.map((a) => ({ type: a.type, placement: a.placement, team: a.team })),
  };
}

/** How many of a team's matches the light team page lists: the next ones, and the latest results. */
export const TEAM_NEXT = 8;
export const TEAM_RECENT = 10;

/** A team's matches still to play: at events that haven't ended (a match left unscored at a finished event isn't
 *  coming), soonest first, an unscheduled one (a playoff not yet timed) after every timed one. `today`: YYYY-MM-DD. */
export function nextMatches(matches: MatchView[], ends: Map<string, string | null>, today: string): MatchView[] {
  // A day's grace: an event ends on its own local date, which can still be today somewhere behind UTC.
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  return matches
    .filter((m) => !m.played && (ends.get(m.code) ?? cutoff) >= cutoff)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.time == null ? 1 : 0) - (b.m.time == null ? 1 : 0) || (a.m.time ?? "").localeCompare(b.m.time ?? "") || a.i - b.i)
    .map(({ m }) => m);
}

export function liteTeam(p: TeamProfile, matches: MatchView[], today = new Date().toISOString().slice(0, 10)): LiteTeam {
  const s = p.stats;
  const withCode = (m: MatchView) => ({ ...liteMatchRow(m), code: m.code });
  return {
    number: p.team.number, name: p.team.name, school: p.team.school, city: p.team.city, state: p.team.state, country: p.team.country,
    rookieYear: p.team.rookieYear, season: p.season, seasons: p.seasons,
    stats: s ? {
      opr: { np: s.opr.np.value, npRank: s.opr.np.rank, of: s.opr.np.of, auto: s.opr.auto.value, teleop: s.opr.teleop.value, endgame: s.opr.endgame.value },
      record: { wins: s.record.wins, losses: s.record.losses, ties: s.record.ties, events: s.record.events },
      ratingRank: s.rating?.rank ?? null,
    } : null,
    events: p.events.map((e) => ({
      code: e.code, name: e.name, start: e.start, end: e.end, rank: e.rank, wins: e.wins, losses: e.losses, ties: e.ties, opr: e.opr.np,
      awards: e.awards.map((a) => ({ type: a.type, placement: a.placement })),
    })),
    // matchViews answers in time order (untimed first): the latest results last.
    next: nextMatches(matches, new Map(p.events.map((e) => [e.code, e.end ?? e.start])), today).slice(0, TEAM_NEXT).map(withCode),
    recent: matches.filter((m) => m.played).slice(-TEAM_RECENT).reverse().map(withCode),
  };
}

export function liteMatch(d: MatchDetail): LiteMatch {
  const m = d.match;
  const side = (a: MatchView["red"]): LiteSide => ({
    score: m.played && a.score ? { total: a.score.total, auto: a.score.auto, teleop: a.score.teleop, endgame: a.score.endgame, pen: a.score.pen } : null,
    teams: a.teams.map((t) => {
      const x = d.teams[t.number];
      return {
        number: t.number, name: x?.name ?? t.name ?? null, surrogate: t.surrogate, dq: t.dq, onField: t.onField,
        rank: x?.event?.rank ?? null, wins: x?.event?.wins ?? null, losses: x?.event?.losses ?? null, ties: x?.event?.ties ?? null,
        opr: x?.event?.opr.np ?? null, seasonOpr: x?.season?.opr ?? null,
      };
    }),
  });
  return {
    season: d.event.season, code: d.event.code, event: d.event.name, key: m.key, label: m.label, description: d.description,
    time: m.time, played: m.played, red: side(m.red), blue: side(m.blue), call: call(m),
    reasons: !m.played ? m.prediction?.reasons ?? [] : [],
    sheet: d.sheet?.map((r) => ({ label: r.label, depth: r.depth, count: !!r.count, red: r.red, blue: r.blue })) ?? null,
    prev: d.prev, next: d.next,
  };
}

export function litePicks(list: PickList, summaries: TeamSummary[]): LitePicks {
  const by = new Map(summaries.map((s) => [s.team, s]));
  return {
    season: list.season, version: list.version,
    picks: list.picks.map((p) => {
      const s = by.get(p.team);
      return { rank: p.rank, team: p.team, name: s?.name ?? null, opr: s?.opr ?? null, oprRank: s?.oprRank ?? null, record: s?.record ?? null, note: p.note, noteBy: p.note ? p.noteBy?.name || null : null };
    }),
  };
}
