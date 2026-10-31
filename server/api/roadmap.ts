// The team page's season road map: the team's events in date order with their
// advancement state, and — only where server/data/roadmapRules.ts encodes the
// home region's rules for the season — the official points earned at each
// event and what the next stop takes. Anywhere else it's the neutral view:
// results so far and what's next, never a "needed" number.
import { all } from "../db.js";
import { allianceCount, qualPoints } from "@control-scout/predict-engine";
import type { TeamEventRow } from "../../src/shared/api.js";
import type { RoadAdvanceStatus, RoadNeed, RoadPoints, RoadRoute, RoadRuleset, RoadStop, TeamRoadMap } from "../../src/shared/roadmap.js";
import { pointsSystem, regionRuleset, REGION_RULESETS, type PastCutoff, type PointsSystem, type RegionRuleset } from "../data/roadmapRules.js";
import { teamEvents, teamInfo } from "./teams.js";
import { ROSTER } from "../data/registrations.js";

/** Event types on the road map (kickoffs, demos, volunteer sign-ups and off-season events aren't stops; scrimmages are, as results so far). */
const COMPETITION = new Set(["Scrimmage", "LeagueMeet", "Qualifier", "LeagueTournament", "SuperQualifier", "Championship", "Premier", "FIRSTChampionship"]);
/** Entry-level events (Competition Manual Section 4): a team can advance from its first few of these. */
const ENTRY = new Set(["Qualifier", "LeagueTournament"]);
const ADVANCING = new Set(["Qualifier", "LeagueTournament", "SuperQualifier", "Championship", "Premier"]);

/** What the loader gathers for one event, beyond the team's own row. */
export interface EventFacts {
  region: string | null;
  ranked: number;
  roster: number;
  advancement: { slots: number; advancesTo: string | null; rows: { team: number; status: string; declined: boolean }[] } | null;
  /** Official advancement points of every team there (empty when none are published). */
  points: Map<number, RoadPoints>;
}

export interface RoadMapInput {
  team: number;
  season: number;
  region: string | null;
  today: string;
  events: TeamEventRow[];
  facts: Map<string, EventFacts>;
  /** Event code → name, for "advances to". */
  names: Map<string, string>;
  /** Event code → start date, for a championship the team isn't registered for yet. */
  starts?: Map<string, string | null>;
  /** League regions: the league tournaments still to come in the team's league (from the season calendar). */
  leagueTournaments?: { code: string; name: string; start: string | null }[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const spread = (xs: number[]) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });

function statusOf(f: EventFacts | undefined, team: number, when: RoadStop["when"], type: string | null): RoadAdvanceStatus | null {
  const adv = f?.advancement;
  if (adv) {
    const r = adv.rows.find((x) => x.team === team);
    if (r?.status === "FIRST") return r.declined ? "declined" : "advanced";
    if (r?.status === "ALREADY_ADVANCING") return "already";
    if (r?.status === "ADVANCING_ABOVE") return "above";
    if (r?.status === "INELIGIBLE") return "ineligible";
    // A list with every slot filled and the team not on it.
    if (when === "done" && adv.rows.length > 0) return "missed";
    return when === "done" ? null : "pending";
  }
  return when !== "done" && type && ADVANCING.has(type) ? "pending" : null;
}

const levelOf = (rs: RegionRuleset | null, type: string | null) => (rs && type ? rs.levels.find((l) => l.types.includes(type)) ?? null : null);

/**
 * The fewest points each finish guarantees on its own, with the worst qualification rank (that rank's points at an
 * event of `n` teams), at an event of `n` teams.
 * The playoff rows are for an alliance's captain or pick (alliances are two teams, Competition Manual 13.7.1): a
 * backup robot earns no alliance points, so it's left out of them.
 */
export function routes(ps: PointsSystem, n: number, target: number | null): RoadRoute[] {
  const a = allianceCount(Math.max(4, n));
  // Alliance points: 21 − the alliance lead number or the draft acceptance number; the lowest a playoff team gets is the last alliance's.
  const lastAlliance = 21 - a, q = qualPoints(Math.max(1, n), Math.max(1, n));
  const list: [string, number][] = [
    ["Win (captain or pick)", ps.playoff.first + lastAlliance + q],
    ["Inspire 1st", ps.inspire[0] + q],
    ["Top seed + finalist", qualPoints(1, n) + 20 + ps.playoff.second],
    ["Finalist (captain or pick)", ps.playoff.second + lastAlliance + q],
    ["Inspire 2nd", ps.inspire[1] + q],
    ["Other judged award 1st", ps.otherAwards[0] + q],
  ];
  return list.map(([label, min]) => ({ label, min, clears: target != null && min >= target }));
}

function rulesetView(rs: RegionRuleset, ps: PointsSystem): RoadRuleset {
  return {
    region: rs.regions[0], name: rs.name, season: rs.season, checked: rs.checked, sources: rs.sources,
    levels: rs.levels.map((l) => ({ kind: l.kind, label: l.label, next: l.next, note: l.note ?? null })),
    points: {
      source: ps.source, where: ps.where, playoff: [ps.playoff.first, ps.playoff.second, ps.playoff.third, ps.playoff.fourth],
      inspire: ps.inspire, otherAwards: ps.otherAwards, qual: { max: ps.qualMax, min: ps.qualMin }, entryEvents: ps.entryEvents,
    },
  };
}

function lastSeasonOf(cuts: PastCutoff[], season: number): RoadNeed["lastSeason"] {
  if (!cuts.length) return null;
  const f = cuts.filter((c) => c.fcmp != null && c.fcmpCutoff != null);
  return {
    season, events: cuts.length, codes: cuts.map((c) => c.code),
    slots: { min: Math.min(...cuts.map((c) => c.slots)), max: Math.max(...cuts.map((c) => c.slots)) },
    cutoff: spread(cuts.map((c) => c.cutoff)),
    fcmp: f.length ? { slots: { min: Math.min(...f.map((c) => c.fcmp!)), max: Math.max(...f.map((c) => c.fcmp!)) }, cutoff: spread(f.map((c) => c.fcmpCutoff!)) } : null,
  };
}

/** Pure: the road map from what the loader gathered (tested without a database). */
export function buildRoadMap(input: RoadMapInput): TeamRoadMap {
  const { team, season, region, today } = input;
  const rs = regionRuleset(season, region);
  const ps = rs ? pointsSystem(season) : null;
  const modelled = !!(rs && ps);
  const rows = input.events
    .filter((e) => e.type == null || COMPETITION.has(e.type))
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") || a.code.localeCompare(b.code));
  let entrySeen = 0;
  const stops: RoadStop[] = rows.map((e) => {
    const f = input.facts.get(e.code);
    const end = e.end ?? e.start;
    const when: RoadStop["when"] = end && end < today ? "done" : e.start && e.start <= today ? "live" : "upcoming";
    const home = !!region && f?.region === region;
    const status = statusOf(f, team, when, e.type);
    // The home ruleset names a destination only for home-region events: elsewhere the team can't advance anyway.
    const toCode = f?.advancement?.advancesTo ?? (home && rs && e.type && ENTRY.has(e.type) ? rs.feeds?.[e.code] ?? (rs.championships.length === 1 ? rs.championships[0].code : null) : null);
    let counts: boolean | null = null;
    if (modelled) {
      if (e.type && ENTRY.has(e.type)) { counts = home && entrySeen < ps!.entryEvents; if (home) entrySeen++; }
      else counts = home && !!e.type && ADVANCING.has(e.type);
    }
    const taken = f?.advancement?.rows.filter((r) => r.status === "FIRST" && !r.declined).map((r) => f.points.get(r.team)?.total).filter((x): x is number => x != null) ?? [];
    return {
      code: e.code, name: e.name, type: e.type, start: e.start, end: e.end, when, home,
      level: levelOf(rs, e.type)?.label ?? null,
      rank: e.rank, ranked: f?.ranked || null, roster: f?.roster ?? 0,
      record: e.wins != null && e.losses != null ? { wins: e.wins, losses: e.losses, ties: e.ties ?? 0 } : null,
      qualPlayed: e.qualPlayed, awards: e.awards, alliance: e.alliance,
      advancement: status ? { status, to: toCode ? input.names.get(toCode) ?? toCode : null, slots: f?.advancement?.slots ?? null } : null,
      points: modelled ? f?.points.get(team) ?? null : null,
      cutoff: modelled && taken.length ? Math.min(...taken) : null,
      counts,
    };
  });
  const next = stops.find((s) => s.when !== "done") ?? null;
  const encoded = REGION_RULESETS.filter((r) => r.season === season).map((r) => ({ region: r.regions[0], name: r.name }));
  if (!modelled) return { team, season, region, ruleset: null, stops, stage: null, next, need: null, encoded };

  // How far the team has got: a slot taken (or held from earlier) at an entry or super-qualifying event, or a
  // championship roster spot, means it's in the regional championship; a slot from that championship, or a FIRST
  // Championship / Premier roster spot, means it's past it.
  const advancedFrom = (types: string[]) => stops.some((s) => s.type && types.includes(s.type) && (s.advancement?.status === "advanced" || s.advancement?.status === "already" || s.advancement?.status === "above"));
  const beyond = advancedFrom(["Championship"]) || stops.some((s) => s.type === "FIRSTChampionship" || s.type === "Premier");
  const regional = beyond || advancedFrom(["Qualifier", "LeagueTournament", "SuperQualifier"]) || stops.some((s) => s.type === "Championship" && s.home);
  const stage: TeamRoadMap["stage"] = beyond ? "beyond" : regional ? "regional" : "entry";
  const view = rulesetView(rs!, ps!);
  if (stage === "beyond") return { team, season, region, ruleset: view, stops, stage, next, need: null, encoded };

  const best = stops.reduce<number | null>((m, s) => (s.points && (m == null || s.points.total > m) ? s.points.total : m), null);
  let need: RoadNeed;
  if (stage === "regional") {
    const lvl = rs!.levels.find((l) => l.kind === "regional")!;
    const ev = stops.find((s) => s.when !== "done" && s.type === "Championship" && s.home) ?? null;
    // Played its championship: FIRST's list says it took no slot (no qualifying stop left this season), or the list
    // isn't out yet (waiting on it, never read as a miss).
    const played = !ev ? stops.find((s) => s.when === "done" && s.type === "Championship" && s.home) : undefined;
    if (played) {
      const st = played.advancement?.status;
      const stage = st === "missed" || st === "ineligible" || st === "declined" ? "over" : "awaiting";
      return { team, season, region, ruleset: view, stops, stage, next, need: null, encoded };
    }
    // The championship the team's slot came from, else the region's only one.
    const from = stops.find((s) => s.type && ENTRY.has(s.type) && (s.advancement?.status === "advanced" || s.advancement?.status === "already"));
    const champCode = ev?.code ?? (from && rs!.feeds?.[from.code]) ?? (rs!.championships.length === 1 ? rs!.championships[0].code : null);
    const champ = champCode ? { code: champCode, name: input.names.get(champCode) ?? rs!.championships.find((c) => c.code === champCode)?.name ?? champCode, start: ev?.start ?? input.starts?.get(champCode) ?? null } : null;
    const last = lastSeasonOf(rs!.lastSeason.regional, rs!.lastSeason.season);
    const target = last?.fcmp?.cutoff.median ?? last?.cutoff.median ?? null;
    const n = ev && ev.roster >= 4 ? ev.roster : median(rs!.lastSeason.regional.map((c) => c.teams));
    need = {
      event: champ, level: lvl.label, fromCalendar: !ev && !!champ, options: [], leadsTo: lvl.next, slots: ev && input.facts.get(ev.code)?.advancement?.slots || null,
      lastSeason: last, target, teams: n, routes: routes(ps!, n, target), best, leagueMatches: null, overLimit: false,
    };
  } else {
    const lvl = rs!.levels.find((l) => l.kind === "entry")!;
    const upcomingEntry = stops.filter((s) => s.when !== "done" && s.type && ENTRY.has(s.type) && s.home);
    // Registered for one, else the league's tournament from the calendar (every league team plays its league's
    // tournament; a league with several, one per conference, lists them all).
    const listed = upcomingEntry.find((s) => s.counts) ?? null;
    const options = !listed && upcomingEntry.length === 0 && entrySeen < ps!.entryEvents ? input.leagueTournaments ?? [] : [];
    const ev = listed ?? (options.length === 1 ? { ...options[0], roster: 0, type: "LeagueTournament", advancement: null } : null);
    const last = lastSeasonOf(rs!.lastSeason.entry, rs!.lastSeason.season);
    const target = last?.cutoff.median ?? null;
    const n = ev && ev.roster >= 4 ? ev.roster : median(rs!.lastSeason.entry.map((c) => c.teams));
    // Meets under way today count too: their played matches are already stored.
    const meets = stops.filter((s) => s.type === "LeagueMeet" && s.when !== "upcoming");
    const played = meets.reduce((t, s) => t + (s.qualPlayed ?? 0), 0);
    const leagues = rs!.levels.some((l) => l.kind === "meet");
    const toLt = !ev || ev.type === "LeagueTournament";
    need = {
      event: ev ? { code: ev.code, name: ev.name, start: ev.start } : null, level: lvl.label, fromCalendar: !listed && !!ev, options: ev ? [] : options,
      leadsTo: (ev?.advancement?.to ?? lvl.next), slots: ev && input.facts.get(ev.code)?.advancement?.slots || null,
      lastSeason: last, target, teams: n, routes: routes(ps!, n, target), best,
      leagueMatches: leagues && toLt && (meets.length || stops.some((s) => s.type === "LeagueMeet")) ? { played, counted: Math.min(played, ps!.leagueMeetMatches), max: ps!.leagueMeetMatches } : null,
      overLimit: upcomingEntry.length > 0 && !listed,
    };
  }
  return { team, season, region, ruleset: view, stops, stage, next, need, encoded };
}

/** Load and build one team's road map for a season. */
export async function teamRoadMap(season: number, team: number): Promise<TeamRoadMap> {
  const [info, rostered, registered] = await Promise.all([
    teamInfo(team), teamEvents(season, team),
    // FIRST's registrations for events still to come (data/registrations.ts): on the calendar before any roster exists.
    all<any>(`SELECT e.code, e.name, e.type, e.start, e.end, e.city, e.state, e.country FROM event_registrations r JOIN events e ON e.season = r.season AND e.code = r.code
              WHERE r.season = ? AND r.team = ? AND r.shared = 0
                AND NOT EXISTS (SELECT 1 FROM event_teams x WHERE x.season = r.season AND x.code = r.code)`, [season, team]),
  ]);
  const have = new Set(rostered.map((e) => e.code));
  const events = [...rostered, ...registered.filter((e) => !have.has(e.code)).map((e) => listedRow(season, e))];
  const codes = events.map((e) => e.code);
  const facts = new Map<string, EventFacts>();
  const names = new Map<string, string>();
  const starts = new Map<string, string | null>();
  if (codes.length) {
    const ph = codes.map(() => "?").join(",");
    const [evs, counts, advs, pts] = await Promise.all([
      all<any>(`SELECT code, region FROM events WHERE season = ? AND code IN (${ph})`, [season, ...codes]),
      all<any>(`SELECT code, COUNT(*) roster, COUNT(rank) ranked FROM ${ROSTER} x WHERE season = ? AND code IN (${ph}) GROUP BY code`, [season, ...codes]),
      all<any>(`SELECT code, slots, advances_to, rows FROM advancement WHERE season = ? AND code IN (${ph})`, [season, ...codes]),
      regionRuleset(season, info?.homeRegion)
        ? all<any>(`SELECT code, team, total, awards, playoffs, alliance, quals FROM advancement_points WHERE season = ? AND code IN (${ph})`, [season, ...codes])
        : Promise.resolve([]),
    ]);
    for (const e of evs) facts.set(e.code, { region: e.region ?? null, ranked: 0, roster: 0, advancement: null, points: new Map() });
    for (const c of counts) { const f = facts.get(c.code); if (f) { f.roster = Number(c.roster); f.ranked = Number(c.ranked); } }
    for (const a of advs) { const f = facts.get(a.code); if (f) f.advancement = { slots: Number(a.slots), advancesTo: a.advances_to ?? null, rows: JSON.parse(a.rows) }; }
    for (const p of pts) facts.get(p.code)?.points.set(Number(p.team), { total: Number(p.total), awards: Number(p.awards), playoffs: Number(p.playoffs), alliance: Number(p.alliance), quals: Number(p.quals) });
    // Names of the events teams advance to (and of the region's championships).
    const targets = [...new Set([...advs.map((a) => a.advances_to).filter(Boolean), ...REGION_RULESETS.filter((r) => r.season === season).flatMap((r) => r.championships.map((c) => c.code))])];
    if (targets.length) {
      for (const r of await all<any>(`SELECT code, name, start FROM events WHERE season = ? AND code IN (${targets.map(() => "?").join(",")})`, [season, ...targets])) {
        names.set(r.code, r.name);
        starts.set(r.code, r.start ?? null);
      }
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  // The team's league: the one its home-region league meets belong to.
  let leagueTournaments: RoadMapInput["leagueTournaments"];
  const region = info?.homeRegion ?? null;
  if (regionRuleset(season, region) && events.some((e) => e.type === "LeagueMeet")) {
    const lg = await all<any>(`SELECT e.league, COUNT(*) n FROM events e WHERE e.season = ? AND e.region = ? AND e.type = 'LeagueMeet' AND e.league IS NOT NULL
                               AND e.code IN (${codes.map(() => "?").join(",")}) GROUP BY e.league ORDER BY n DESC LIMIT 1`, [season, region, ...codes]);
    if (lg[0]) {
      leagueTournaments = (await all<any>("SELECT code, name, start FROM events WHERE season = ? AND region = ? AND league = ? AND type = 'LeagueTournament' AND COALESCE(end, start) >= ? ORDER BY start, code",
        [season, region, lg[0].league, today])).map((e) => ({ code: e.code, name: e.name, start: e.start ?? null }));
    }
  }
  return buildRoadMap({ team, season, region, today, events, facts, names, starts, leagueTournaments });
}

/** A registered event with nothing on the team's record yet, as a team-page event row. */
function listedRow(season: number, e: any): TeamEventRow {
  return {
    season, code: e.code, name: e.name, type: e.type ?? null, start: e.start ?? null, end: e.end ?? null, city: e.city ?? null, state: e.state ?? null, country: e.country ?? null,
    rank: null, rp: null, wins: null, losses: null, ties: null, played: null, qualPlayed: null, qual: null, onField: false,
    opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, avg: { score: null, np: null, pen: null }, awards: [], alliance: null,
  };
}
