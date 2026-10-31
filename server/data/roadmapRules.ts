// Season road map rulesets: how each region's teams advance, curated once per
// season from the region's own published pages and FIRST's Competition Manual.
// A region that isn't listed here for a season gets the neutral road map
// (results so far + what's next) and never a "what's needed" figure.
//
// Updating for a new season: copy the newest season's block, re-read every
// source (the manual's Section 4 and each region's season page), change what
// changed, refresh `lastSeason` from FTC Events (the last team to take a slot
// at each advancing event, from /advancement/{code} and /advancement/{code}/points),
// and set `checked`. docs/season-road-map.md lists what's encoded and from where.

export interface RuleSource { label: string; url: string }

/** One advancing event of last season: its slots and the official points of the last team to take one. */
export interface PastCutoff {
  code: string;
  /** Teams in FIRST's points list (everyone who competed). */
  teams: number;
  slots: number;
  /** Lowest official total among the teams that took a slot ("FIRST" status, not declined). */
  cutoff: number;
  /** Regional championships: slots reserved for FIRST Championship (the rest go to Premier events) and the
   *  points of the last team inside that reserved share. */
  fcmp?: number;
  fcmpCutoff?: number;
}

/** The advancement points system in force for a season (FIRST's, the same in every region that uses it). */
export interface PointsSystem {
  season: number;
  source: RuleSource;
  /** Where the source says it: section / table numbers. */
  where: string;
  playoff: { first: number; second: number; third: number; fourth: number };
  inspire: [number, number, number];
  otherAwards: [number, number, number];
  /** Qualification points run from `qualMax` (top seed) down to `qualMin`; alliance points are 21 − lead / draft number. */
  qualMax: number;
  qualMin: number;
  /** Teams can advance from their first this-many entry-level events (qualifiers and league tournaments). */
  entryEvents: number;
  /** League tournament rankings add each team's best this-many league meet matches. */
  leagueMeetMatches: number;
}

const MANUAL_2026: RuleSource = { label: "FIRST Tech Challenge 2026–27 Competition Manual (version TU07)", url: "https://ftc-resources.firstinspires.org/ftc/game/manual" };
const FTC_EVENTS: RuleSource = { label: "FTC Events: each event's advancement list and advancement points", url: "https://ftc-events.firstinspires.org" };

export const POINTS_SYSTEMS: PointsSystem[] = [
  {
    season: 2026, source: MANUAL_2026,
    where: "Section 4 Advancement (4.1, Tables 4-1 to 4-3), Section 14 League Play Tournaments",
    playoff: { first: 40, second: 20, third: 10, fourth: 5 }, inspire: [60, 30, 15], otherAwards: [12, 6, 3],
    qualMax: 16, qualMin: 2, entryEvents: 3, leagueMeetMatches: 10,
  },
];

export type LevelKind = "meet" | "entry" | "super" | "regional" | "world";

export interface Level {
  kind: LevelKind;
  label: string;
  /** FIRST event types at this level (events.type). */
  types: string[];
  /** What the level leads to, in words. */
  next: string;
  note?: string;
}

export interface RegionRuleset {
  season: number;
  /** FIRST home region code(s) (teams.home_region, events.region). */
  regions: string[];
  name: string;
  levels: Level[];
  /** Regional championship event codes; with several, `feeds` says which one each event advances to. */
  championships: { code: string; name: string }[];
  /** Entry-level event → the championship it advances to (as configured on FTC Events). */
  feeds?: Record<string, string>;
  sources: RuleSource[];
  /** Date the sources were last read (YYYY-MM-DD). */
  checked: string;
  /** Last season under the same points system: the reference for "what's needed". */
  lastSeason: { season: number; source: RuleSource; entry: PastCutoff[]; regional: PastCutoff[] };
}

const LEAGUE_MEET: Level = {
  kind: "meet", label: "League meet", types: ["LeagueMeet"], next: "League tournament",
  note: "No awards or advancement at a meet. Each team's best 10 meet matches count toward its league tournament ranking.",
};

export const REGION_RULESETS: RegionRuleset[] = [
  {
    season: 2026, regions: ["USNJ"], name: "New Jersey",
    levels: [
      LEAGUE_MEET,
      { kind: "entry", label: "League tournament", types: ["LeagueTournament"], next: "New Jersey Championship", note: "Every league team plays its league's tournament; slots go by advancement points earned there." },
      { kind: "regional", label: "State championship", types: ["Championship"], next: "FIRST Championship or a Premier event" },
      { kind: "world", label: "FIRST Championship", types: ["FIRSTChampionship"], next: "" },
    ],
    championships: [{ code: "USNJCMP", name: "New Jersey Championship" }],
    sources: [
      { label: "FTC New Jersey: important season dates (2026–27)", url: "https://newjerseyftc.com/important-season-dates.html" },
      { label: "FTC New Jersey: 2026/2027 competition season events", url: "https://newjerseyftc.com/upcoming-events.html" },
      MANUAL_2026, FTC_EVENTS,
    ],
    checked: "2026-10-30",
    lastSeason: {
      season: 2025, source: FTC_EVENTS,
      entry: [
        { code: "USNJNOLT", teams: 22, slots: 6, cutoff: 53 }, { code: "USNJSOLT", teams: 24, slots: 6, cutoff: 54 },
        { code: "USNJUCLT", teams: 23, slots: 6, cutoff: 51 }, { code: "USNJNEELT", teams: 21, slots: 6, cutoff: 54 },
        { code: "USNJSOLT2", teams: 31, slots: 8, cutoff: 37 }, { code: "USNJNEELT2", teams: 17, slots: 5, cutoff: 63 },
        { code: "USNJUCLT2", teams: 23, slots: 6, cutoff: 55 }, { code: "USNJNOLT2", teams: 21, slots: 5, cutoff: 48 },
      ],
      regional: [{ code: "USNJCMP", teams: 48, slots: 19, cutoff: 30, fcmp: 8, fcmpCutoff: 46 }],
    },
  },
  {
    season: 2026, regions: ["USMI"], name: "Michigan",
    levels: [
      LEAGUE_MEET,
      { kind: "entry", label: "Qualifier or league tournament", types: ["Qualifier", "LeagueTournament"], next: "a Michigan state championship (NW or SE)", note: "Each qualifier and league tournament feeds one of the two state championships." },
      { kind: "regional", label: "State championship", types: ["Championship"], next: "FIRST Championship or a Premier event" },
      { kind: "world", label: "FIRST Championship", types: ["FIRSTChampionship"], next: "" },
    ],
    championships: [{ code: "USMINWCMP", name: "Michigan Championship NW" }, { code: "USMISECMP", name: "Michigan Championship SE" }],
    // FTC Events advancement configuration, read 2026-10-30.
    feeds: {
      USMIBEQ: "USMINWCMP", USMICOQ: "USMINWCMP", USMIMIQ1: "USMINWCMP", USMIKEQ: "USMINWCMP", USMIBCQ: "USMINWCMP", USMIFRQ2: "USMINWCMP",
      USMIHOQ2: "USMINWCMP", USMIMIQ2: "USMINWCMP", USMIFLQ: "USMINWCMP", USMIPEQ: "USMINWCMP", USMICPLT: "USMINWCMP", USMISCLT: "USMINWCMP", USMIWMLT: "USMINWCMP",
      USMIHOQ: "USMISECMP", USMIROQ: "USMISECMP", USMISOQ: "USMISECMP", USMICHQ: "USMISECMP", USMIOTQ: "USMISECMP", USMIRHQ: "USMISECMP", USMIMHQ: "USMISECMP",
      USMINOQ: "USMISECMP", USMITEQ: "USMISECMP", USMIAAQ: "USMISECMP", USMIDEQ: "USMISECMP", USMIWAQ: "USMISECMP", USMIGWQ: "USMISECMP", USMIMDLT: "USMISECMP", USMIOCLT: "USMISECMP",
    },
    sources: [{ label: "FIRST in Michigan: 2026–2027 FTC season events", url: "https://firstinmichigan.us/FTC/events/" }, MANUAL_2026, FTC_EVENTS],
    checked: "2026-10-30",
    lastSeason: {
      season: 2025, source: FTC_EVENTS,
      entry: [
        { code: "USMICHQ", teams: 35, slots: 6, cutoff: 56 }, { code: "USMIKEQ", teams: 35, slots: 6, cutoff: 51 }, { code: "USMICOQ", teams: 26, slots: 5, cutoff: 45 },
        { code: "USMIGRQ", teams: 37, slots: 5, cutoff: 42 }, { code: "USMIHOQ2", teams: 35, slots: 6, cutoff: 45 }, { code: "USMIMIQ1", teams: 34, slots: 5, cutoff: 68 },
        { code: "USMIROQ", teams: 35, slots: 6, cutoff: 43 }, { code: "USMITEQ", teams: 36, slots: 6, cutoff: 47 }, { code: "USMIBCQ", teams: 36, slots: 5, cutoff: 45 },
        { code: "USMIFLQ", teams: 36, slots: 5, cutoff: 48 }, { code: "USMIMHQ", teams: 24, slots: 4, cutoff: 51 }, { code: "USMIOTQ", teams: 36, slots: 5, cutoff: 66 },
        { code: "USMIAVLT", teams: 21, slots: 5, cutoff: 46 }, { code: "USMIAAQ", teams: 34, slots: 5, cutoff: 45 }, { code: "USMIFRQ", teams: 37, slots: 5, cutoff: 39 },
        { code: "USMIHOQ", teams: 23, slots: 4, cutoff: 50 }, { code: "USMINOQ", teams: 36, slots: 5, cutoff: 44 }, { code: "USMIRHQ", teams: 35, slots: 5, cutoff: 39 },
        { code: "USMIMIQ2", teams: 36, slots: 6, cutoff: 37 }, { code: "USMICPLT", teams: 32, slots: 5, cutoff: 52 }, { code: "USMIMDLT", teams: 18, slots: 4, cutoff: 46 },
        { code: "USMIOCLT", teams: 32, slots: 5, cutoff: 38 }, { code: "USMISCLT", teams: 31, slots: 5, cutoff: 32 }, { code: "USMIBRQ", teams: 33, slots: 5, cutoff: 40 },
        { code: "USMIDEQ", teams: 35, slots: 7, cutoff: 50 }, { code: "USMIGOQ", teams: 36, slots: 5, cutoff: 33 }, { code: "USMIPEQ", teams: 35, slots: 5, cutoff: 58 },
        { code: "USMIGWQ", teams: 25, slots: 4, cutoff: 50 },
      ],
      regional: [
        { code: "USMICMP2", teams: 72, slots: 23, cutoff: 28, fcmp: 9, fcmpCutoff: 41 },
        { code: "USMICMP", teams: 72, slots: 23, cutoff: 27, fcmp: 9, fcmpCutoff: 43 },
      ],
    },
  },
  {
    season: 2026, regions: ["USIA"], name: "Iowa",
    levels: [
      { ...LEAGUE_MEET, note: "Teams play 3–5 meets; each team's best 10 meet matches count toward its league tournament ranking." },
      { kind: "entry", label: "League tournament", types: ["LeagueTournament"], next: "Iowa Championship", note: "Open only to the league's own teams; slots go by advancement points earned there." },
      { kind: "regional", label: "State championship", types: ["Championship"], next: "FIRST Championship or a Premier event" },
      { kind: "world", label: "FIRST Championship", types: ["FIRSTChampionship"], next: "" },
    ],
    championships: [{ code: "USIACMP", name: "Iowa Championship" }],
    sources: [{ label: "University of Iowa: FIRST Tech Challenge season events and deadlines (2026–27)", url: "https://engineering.uiowa.edu/first-tech-challenge-season-events-deadlines" }, MANUAL_2026, FTC_EVENTS],
    checked: "2026-10-30",
    lastSeason: {
      season: 2025, source: FTC_EVENTS,
      entry: [
        { code: "USIAGIZALT", teams: 19, slots: 8, cutoff: 39 }, { code: "USIASTNGLT", teams: 28, slots: 13, cutoff: 32 },
        { code: "USIAPOMPLT", teams: 27, slots: 12, cutoff: 29 }, { code: "USIAACPSLT", teams: 24, slots: 12, cutoff: 25 },
        { code: "USIAWESTLT", teams: 29, slots: 13, cutoff: 23 }, { code: "USIAMPLT", teams: 34, slots: 14, cutoff: 21 },
      ],
      regional: [{ code: "USIACMP", teams: 72, slots: 15, cutoff: 32, fcmp: 6, fcmpCutoff: 56 }],
    },
  },
];

export const pointsSystem = (season: number) => POINTS_SYSTEMS.find((p) => p.season === season) ?? null;

/** The encoded ruleset for a team's home region in a season, or null (neutral road map). */
export function regionRuleset(season: number, region: string | null | undefined): RegionRuleset | null {
  if (!region || !pointsSystem(season)) return null;
  return REGION_RULESETS.find((r) => r.season === season && r.regions.includes(region)) ?? null;
}
