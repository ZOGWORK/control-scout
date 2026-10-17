// FTC Scout (api.ftcscout.org) — fallback / supplementary source.
//
// Normalises a raw `eventByCode` GraphQL response (the same query and layout
// the shared engine's parser reads, so cached responses from Control Point's
// research store import directly) into an EventBundle.
import { scoutEventQuery, SCOUT_EVENT_LIST_QUERY } from "@control-scout/predict-engine";
import type { EventBundle, MatchRow, MatchTeam } from "../data/bundle.js";
import { matchLabel } from "../data/bundle.js";
import { ownScorePenalties, type ScoreSplit } from "../data/seasons.js";

const ENDPOINT = "https://api.ftcscout.org/graphql";
const STATION: Record<string, number> = { One: 1, Two: 2, Three: 3, NotOnField: 0 };

/** POST a GraphQL query (sequential callers; FTC Scout is a community API — be gentle). */
export async function scoutQuery(query: string, variables: Record<string, unknown>, timeoutMs = 30000): Promise<any> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "control-scout (+https://github.com/Control-Point-FTC)" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`FTC Scout HTTP ${res.status}`);
  return res.json();
}

export const fetchScoutEvent = (season: number, code: string) => scoutQuery(scoutEventQuery(season), { season, code });
export const fetchScoutEventList = (season: number) => scoutQuery(SCOUT_EVENT_LIST_QUERY, { season });

/** FTC Scout's per-season endgame field (2024+: dcPoints include it; ≤2023 they don't). */
export function split(season: number, raw: any): ScoreSplit | null {
  if (!raw || typeof raw.totalPointsNp !== "number") return null;
  const auto = raw.autoPoints ?? 0;
  // BIOBUZZ (2026): park is the endgame; DECODE (2025): base.
  const endgame = season >= 2026 ? raw.dcParkPoints ?? 0 : season === 2025 ? raw.dcBasePoints ?? 0 : season === 2024 ? raw.dcParkPoints ?? 0 : raw.egPoints ?? 0;
  const teleop = Math.max(0, season >= 2024 ? (raw.dcPoints ?? 0) - endgame : raw.dcPoints ?? 0);
  if (ownScorePenalties(season)) {
    // 2020/2021: fouls come off the offender's own score; FTC Scout stores them negative
    // (and its 2020 totalPoints leaves them in), so the total is rebuilt as FIRST reports it.
    const pen = Math.abs(raw.penaltyPointsCommitted ?? 0);
    return { total: Math.max(0, raw.totalPointsNp - pen), np: raw.totalPointsNp, auto, teleop, endgame, pen };
  }
  const out: ScoreSplit = { total: raw.totalPoints ?? raw.totalPointsNp, np: raw.totalPointsNp, auto, teleop, endgame, pen: raw.penaltyPointsCommitted ?? 0 };
  if (season >= 2026 && "swarmRp" in raw) out.bonus = { movement: !!raw.swarmRp, goal: !!raw.pollinator1Rp, pattern: !!raw.pollinator2Rp };
  else if (season === 2025 && "movementRp" in raw) out.bonus = { movement: !!raw.movementRp, goal: !!raw.goalRp, pattern: !!raw.patternRp };
  if (season >= 2026 && typeof raw.tips === "number") out.tips = raw.tips;
  return out;
}

/**
 * Raw `eventByCode` response → bundle. Null when the response has no event.
 * Remote events are kept (they're real events) but carry no alliance play.
 */
export function bundleFromScout(resp: any, season: number): EventBundle | null {
  const ev = resp?.data?.eventByCode;
  if (!ev?.code) return null;
  const teams = (ev.teams ?? []).map((t: any) => ({
    number: t.teamNumber as number,
    name: t.team?.name ?? null, fullName: null, school: null, sponsors: null,
    city: t.team?.location?.city ?? null, state: t.team?.location?.state ?? null, country: null,
    rookieYear: null, website: null, homeRegion: null,
  }));
  const matches: MatchRow[] = [];
  // Remote: one team per "match", numbers reused across teams (keys collide).
  for (const m of ev.remote ? [] : ev.matches ?? []) {
    const level = String(m.tournamentLevel || "").toLowerCase().startsWith("qual") ? "qual" : "playoff";
    const side = (al: string): MatchTeam[] => (m.teams ?? []).filter((t: any) => t.alliance === al).map((t: any) => ({
      team: t.teamNumber, station: STATION[t.station] ?? null, surrogate: !!t.surrogate, dq: !!t.dq, onField: t.onField !== false,
    }));
    const red = split(season, m.scores?.red), blue = split(season, m.scores?.blue);
    matches.push({
      level, series: m.series ?? 0, number: m.matchNum,
      label: matchLabel(level, m.series ?? 0, m.matchNum),
      description: null,
      time: m.actualStartTime || m.scheduledStartTime || null,
      played: !!m.hasBeenPlayed && !!red && !!blue,
      red: side("Red"), blue: side("Blue"),
      redScore: m.hasBeenPlayed ? red : null, blueScore: m.hasBeenPlayed ? blue : null,
    });
  }
  return {
    event: {
      season, code: ev.code, name: ev.name ?? ev.code, type: ev.type ?? null, divisionCode: ev.divisionCode ?? null,
      region: ev.regionCode ?? null, league: null, venue: null, city: ev.location?.city ?? null,
      state: ev.location?.state ?? null, country: ev.location?.country ?? null,
      start: ev.start ?? null, end: ev.end ?? ev.start ?? null, timezone: ev.timezone ?? null,
      remote: !!ev.remote, hybrid: !!ev.hybrid, website: null, livestream: null, source: "ftc-scout", upstreamUpdated: ev.updatedAt ?? null,
    },
    teams: teams.filter((t: any) => t.name || t.city),
    detail: {
      entries: (ev.teams ?? []).map((t: any) => ({
        team: t.teamNumber, rank: t.stats?.rank ?? null, rp: t.stats?.rp ?? null, tbp: null,
        wins: t.stats?.wins ?? null, losses: t.stats?.losses ?? null, ties: t.stats?.ties ?? null, qualPlayed: t.stats?.qualMatchesPlayed ?? null, dq: null,
      })),
      matches,
      alliances: [],
      awards: (ev.awards ?? []).filter((a: any) => a.teamNumber).map((a: any) => ({ type: a.type, placement: a.placement ?? 1, team: a.teamNumber, name: null })),
      advancement: undefined,
    },
  };
}
