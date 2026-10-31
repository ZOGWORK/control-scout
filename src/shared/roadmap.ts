// The team page's season road map (server/api/roadmap.ts): the team's events in date order with their
// advancement state, and, where Scout has encoded the home region's rules for the season
// (server/data/roadmapRules.ts), what the next stop takes to keep going.

export interface RoadSource { label: string; url: string }

export interface RoadPoints { total: number; awards: number; playoffs: number; alliance: number; quals: number }

/**
 * The team's advancement at one event, from FIRST's published list:
 * advanced = took a slot; declined = offered one and turned it down; already = had advanced earlier;
 * above = advanced to a higher level elsewhere; ineligible = couldn't advance from here;
 * missed = the list is out and the team isn't on it; pending = an advancing event still to come.
 */
export type RoadAdvanceStatus = "advanced" | "declined" | "already" | "above" | "ineligible" | "missed" | "pending";

export interface RoadStop {
  code: string;
  name: string;
  type: string | null;
  start: string | null;
  end: string | null;
  /** done = over; live = on today; upcoming = still to come. */
  when: "done" | "live" | "upcoming";
  /** The level's name in the region's ruleset ("League tournament"); null without one. */
  level: string | null;
  /** In the team's home region (only home-region events advance a team). */
  home: boolean;
  rank: number | null;
  /** Teams ranked there. */
  ranked: number | null;
  /** Teams on the roster (registered), for an upcoming event's size. */
  roster: number;
  record: { wins: number; losses: number; ties: number } | null;
  qualPlayed: number | null;
  awards: { type: string; placement: number; name: string | null }[];
  alliance: { number: number; seat: "captain" | "pick1" | "pick2" | "backup" } | null;
  /** Null: the event doesn't advance anyone, or nothing is published for it. */
  advancement: { status: RoadAdvanceStatus; to: string | null; slots: number | null } | null;
  /** FIRST's official advancement points for the team (modelled regions only; null when none are published). */
  points: RoadPoints | null;
  /** Lowest official total among the teams that took a slot here (modelled regions only). */
  cutoff: number | null;
  /** Modelled regions: whether this event can advance the team (home region, and among its first entry-level events). Null elsewhere. */
  counts: boolean | null;
}

export interface RoadRoute {
  /** "Win the event (captain or pick)". */
  label: string;
  /** The fewest points that finish alone guarantees under the season's table (worst qualification rank). */
  min: number;
  /** min ≥ the target. */
  clears: boolean;
}

export interface RoadNeed {
  /** The next stop it applies to; null when the team isn't registered for one yet. */
  event: { code: string; name: string; start: string | null } | null;
  /** The event comes from the season calendar (the league's tournament, the region's championship), not a registration. */
  fromCalendar: boolean;
  /** No event yet: the league's tournaments still to come, one of which the team will play (one per conference). */
  options: { code: string; name: string; start: string | null }[];
  level: string;
  /** Where it leads ("New Jersey Championship"). */
  leadsTo: string;
  /** This season's slots, once FIRST publishes them. */
  slots: number | null;
  /** Last season under the same points system, from the region's advancing events at this level. */
  lastSeason: {
    season: number;
    events: number;
    slots: { min: number; max: number };
    /** The last team to take a slot: median and range of its official points. */
    cutoff: { median: number; min: number; max: number };
    /** Regional championships: the FIRST Championship share of the slots, and its cutoff. */
    fcmp: { slots: { min: number; max: number }; cutoff: { median: number; min: number; max: number } } | null;
    codes: string[];
  } | null;
  /** The number to aim for: last season's median cutoff (the FIRST Championship share's at a championship). */
  target: number | null;
  /** Teams the routes assume (the event's roster, else last season's typical size). */
  teams: number;
  routes: RoadRoute[];
  /** The team's best official total at an event this season. */
  best: number | null;
  /** League regions: meet matches played so far and how many count toward the league tournament ranking. */
  leagueMatches: { played: number; counted: number; max: number } | null;
  /** The next entry-level event is beyond the ones a team can advance from. */
  overLimit: boolean;
}

export interface RoadRuleset {
  region: string;
  name: string;
  season: number;
  levels: { kind: "meet" | "entry" | "super" | "regional" | "world"; label: string; next: string; note: string | null }[];
  sources: RoadSource[];
  checked: string;
  points: {
    source: RoadSource;
    where: string;
    playoff: number[];
    inspire: number[];
    otherAwards: number[];
    qual: { max: number; min: number };
    entryEvents: number;
  };
}

export interface TeamRoadMap {
  team: number;
  season: number;
  /** FIRST home region code (null when FIRST hasn't assigned one we hold). */
  region: string | null;
  /** The encoded ruleset, or null: the neutral road map (results so far + what's next). */
  ruleset: RoadRuleset | null;
  stops: RoadStop[];
  /** How far the team has got this season: entry = still to advance; regional = qualified for the state/regional
   *  championship; beyond = advanced from it; over = played the championship without advancing from it (no qualifying
   *  stop left). Modelled regions only (null elsewhere). */
  stage: "entry" | "regional" | "beyond" | "over" | null;
  /** The next event on the team's calendar (any kind), or null. */
  next: RoadStop | null;
  need: RoadNeed | null;
  /** Regions with an encoded ruleset this season (for the neutral view's note). */
  encoded: { region: string; name: string }[];
}
