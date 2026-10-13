// Season descriptors: one place that knows how each game's score breakdown
// maps onto the engine's season-generic components (auto, TeleOp without
// endgame, endgame, penalties committed). Everything else is season-blind.
//
// Field names verified against live FIRST Events API responses (2026-10-12)
// and cross-checked with FTC Scout's normalised fields for the same matches.

export interface SeasonInfo {
  season: number;
  /** Game name (FIRST's season `gameName`). */
  game: string;
  /** "2025–26" */
  label: string;
}

export const SEASONS: SeasonInfo[] = [
  { season: 2023, game: "CENTERSTAGE", label: "2023–24" },
  { season: 2024, game: "INTO THE DEEP", label: "2024–25" },
  { season: 2025, game: "DECODE", label: "2025–26" },
  { season: 2026, game: "BIOBUZZ", label: "2026–27" },
];

export const SEASON_NUMBERS = SEASONS.map((s) => s.season);
export const CURRENT_SEASON = Math.max(...SEASON_NUMBERS);
export const seasonInfo = (s: number) => SEASONS.find((x) => x.season === s) ?? { season: s, game: `${s}–${String((s + 1) % 100).padStart(2, "0")}`, label: `${s}–${String((s + 1) % 100).padStart(2, "0")}` };

/** The FTC season a date falls in (seasons kick off in September). */
export function seasonForDate(d: Date): number {
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

export interface ScoreSplit {
  total: number;
  np: number;
  auto: number;
  teleop: number;
  endgame: number;
  /** Penalty points this alliance gave away (credited to the opponent). */
  pen: number;
  /** Bonus ranking points, mapped onto the engine's three bonus slots (2025+). */
  bonus?: { movement: boolean; goal: boolean; pattern: boolean };
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/**
 * One alliance's FIRST `/scores` breakdown → engine components.
 * TeleOp excludes the endgame in every season (the engine's convention).
 */
export function splitFirstScore(season: number, a: Record<string, unknown>): ScoreSplit {
  const auto = n(a.autoPoints);
  let teleop: number, endgame: number, pen: number;
  let bonus: ScoreSplit["bonus"];
  if (season === 2023) {
    // CENTERSTAGE: dcPoints already excludes the endgame.
    teleop = n(a.dcPoints);
    endgame = n(a.endgamePoints);
    pen = n(a.penaltyPointsCommitted);
  } else if (season === 2024) {
    // INTO THE DEEP: teleopPoints includes park + ascent.
    endgame = n(a.teleopParkPoints) + n(a.teleopAscentPoints);
    teleop = n(a.teleopPoints) - endgame;
    pen = n(a.foulPointsCommitted);
  } else if (season === 2025) {
    // DECODE: teleopPoints includes the base (endgame) points.
    endgame = n(a.teleopBasePoints);
    teleop = n(a.teleopPoints) - endgame;
    pen = n(a.foulPointsCommitted);
    bonus = { movement: !!a.movementRP, goal: !!a.goalRP, pattern: !!a.patternRP };
  } else if (season === 2026) {
    // BIOBUZZ: teleopPoints includes the end-of-match park. Its three bonus
    // RPs (swarm, pollinator 1, pollinator 2) use the engine's three slots.
    endgame = n(a.teleopParkPoints);
    teleop = n(a.teleopPoints) - endgame;
    pen = n(a.foulPointsCommitted);
    bonus = { movement: !!a.swarmRP, goal: !!a.pollinator1RP, pattern: !!a.pollinator2RP };
  } else {
    // Unknown game: no endgame split until a descriptor is added.
    teleop = n(a.teleopPoints ?? a.dcPoints);
    endgame = 0;
    pen = n(a.foulPointsCommitted ?? a.penaltyPointsCommitted);
  }
  teleop = Math.max(0, teleop);
  const np = auto + teleop + endgame;
  return { total: n(a.totalPoints), np, auto, teleop, endgame, pen, ...(bonus ? { bonus } : {}) };
}

/** FIRST event type names → the compact form the engine uses (FTC Scout style). */
export function normalizeEventType(typeName: string | null | undefined): string | null {
  if (!typeName) return null;
  const map: Record<string, string> = {
    "League Meet": "LeagueMeet",
    "League Tournament": "LeagueTournament",
    "Qualifier": "Qualifier",
    "Super Qualifier": "SuperQualifier",
    "Championship": "Championship",
    "FIRST Championship": "FIRSTChampionship",
    "Premier": "Premier",
    "Premier Event": "Premier",
    "Off-Season": "OffSeason",
    "Kickoff": "Kickoff",
    "Workshop": "Workshop",
    "Demo / Exhibition": "DemoExhibition",
    "Volunteer Signup": "VolunteerSignup",
    "Practice Day": "PracticeDay",
    "Scrimmage": "Scrimmage",
    "Non-Advancement": "Scrimmage",
    "Innovation Challenge": "InnovationChallenge",
  };
  return map[typeName] ?? typeName.replace(/[^A-Za-z]/g, "");
}

/** Human label for a compact event type. */
export function eventTypeLabel(type: string | null | undefined): string {
  const map: Record<string, string> = {
    LeagueMeet: "League Meet", LeagueTournament: "League Tournament", Qualifier: "Qualifier", SuperQualifier: "Super Qualifier",
    Championship: "Championship", FIRSTChampionship: "FIRST Championship", Premier: "Premier Event", OffSeason: "Off-season",
    Kickoff: "Kickoff", Workshop: "Workshop", DemoExhibition: "Demo / Exhibition", Scrimmage: "Scrimmage",
    VolunteerSignup: "Volunteer Signup", PracticeDay: "Practice Day", InnovationChallenge: "Innovation Challenge",
  };
  return (type && map[type]) ?? type ?? "Event";
}

/** FIRST award names → engine award types. Placement comes from `series`. */
export function normalizeAwardName(name: string): string | null {
  const s = name.toLowerCase();
  if (s.includes("dean")) return "DeansList";
  if (s.includes("inspire")) return "Inspire";
  if (s.includes("think")) return "Think";
  if (s.includes("connect")) return "Connect";
  if (s.includes("innovate")) return "Innovate";
  if (s.includes("control")) return "Control";
  if (s.includes("motivate")) return "Motivate";
  if (s.includes("design")) return "Design";
  if (s.includes("reach")) return "Reach";
  if (s.includes("sustain")) return "Sustain";
  if (s.includes("judge")) return "JudgesChoice";
  if (s.includes("compass")) return "Compass";
  if (s.includes("finalist")) return "Finalist";
  if (s.includes("winner") || s.includes("winning")) return "Winner";
  if (s.includes("volunteer")) return "Volunteer";
  return null;
}
