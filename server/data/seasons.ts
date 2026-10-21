// Season descriptors: one place that knows how each game's score breakdown
// maps onto the engine's season-generic components (auto, TeleOp without
// endgame, endgame, penalties committed). Everything else is season-blind.
//
// Field names verified against live FIRST Events API responses (2026-10-12)
// and cross-checked with FTC Scout's normalised fields for the same matches.

export { bonusLabels, eventTypeLabel } from "../../src/shared/labels.js";

export interface SeasonInfo {
  season: number;
  /** Game name (FIRST's season `gameName`). */
  game: string;
  /** "2025–26" */
  label: string;
}

export const SEASONS: SeasonInfo[] = [
  // Legacy seasons: stored and shown (team history), never rated or predicted.
  { season: 2019, game: "SKYSTONE", label: "2019–20" },
  { season: 2020, game: "ULTIMATE GOAL", label: "2020–21" },
  { season: 2021, game: "FREIGHT FRENZY", label: "2021–22" },
  { season: 2022, game: "POWERPLAY", label: "2022–23" },
  { season: 2023, game: "CENTERSTAGE", label: "2023–24" },
  { season: 2024, game: "INTO THE DEEP", label: "2024–25" },
  { season: 2025, game: "DECODE", label: "2025–26" },
  { season: 2026, game: "BIOBUZZ", label: "2026–27" },
];

export const SEASON_NUMBERS = SEASONS.map((s) => s.season);
export const CURRENT_SEASON = Math.max(...SEASON_NUMBERS);
/** Seasons the engine rates, predicts and backtests. Older ones are history only:
 *  replaying them would change every rating from 2023 on. */
export const FIRST_PREDICT_SEASON = 2023;
export const PREDICT_SEASONS = SEASON_NUMBERS.filter((s) => s >= FIRST_PREDICT_SEASON);
export const isLegacy = (s: number) => s < FIRST_PREDICT_SEASON;
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
  /** BIOBUZZ (2026): HIVE TIPs, auto + TeleOp (a qualification sort criterion). */
  tips?: number;
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/**
 * One alliance's FIRST `/scores` breakdown → engine components.
 * TeleOp excludes the endgame in every season (the engine's convention).
 */
export function splitFirstScore(season: number, a: Record<string, unknown>, opp?: Record<string, unknown>): ScoreSplit {
  if (season <= 2022) return splitLegacy(season, a, opp);
  const auto = n(a.autoPoints);
  let teleop: number, endgame: number, pen: number;
  let bonus: ScoreSplit["bonus"];
  let tips: number | undefined;
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
    if ("autoHiveTips" in a || "teleopHiveTips" in a) tips = n(a.autoHiveTips) + n(a.teleopHiveTips);
  } else {
    // Unknown game: no endgame split until a descriptor is added.
    teleop = n(a.teleopPoints ?? a.dcPoints);
    endgame = 0;
    pen = n(a.foulPointsCommitted ?? a.penaltyPointsCommitted);
  }
  teleop = Math.max(0, teleop);
  const np = auto + teleop + endgame;
  return { total: n(a.totalPoints), np, auto, teleop, endgame, pen, ...(bonus ? { bonus } : {}), ...(tips != null ? { tips } : {}) };
}

/**
 * 2019–2022. Penalties: SKYSTONE and POWERPLAY credit fouls to the opponent;
 * ULTIMATE GOAL and FREIGHT FRENZY deduct them from the offender's own score.
 * In SKYSTONE `penaltyPoints` is what this alliance received (the opponent's
 * fouls) and `endGamePoints` is unreliable, so the endgame is what's left of
 * the non-penalty total. All four report TeleOp without the endgame.
 */
function splitLegacy(season: number, a: Record<string, unknown>, opp?: Record<string, unknown>): ScoreSplit {
  const total = n(a.totalPoints);
  if (season === 2019) {
    const auto = n(a.autonomousPoints), teleop = n(a.driverControlledPoints), np = Math.max(0, total - n(a.penaltyPoints));
    return { total, np, auto, teleop, endgame: Math.max(0, np - auto - teleop), pen: n(opp?.penaltyPoints) };
  }
  if (season === 2022) {
    const auto = n(a.autoPoints), teleop = n(a.dcPoints), endgame = n(a.endgamePoints);
    return { total, np: auto + teleop + endgame, auto, teleop, endgame, pen: n(a.penaltyPointsCommitted) };
  }
  // 2020, 2021: total = np − own penalties (FIRST floors it at 0).
  const auto = n(a.autoPoints), teleop = n(season === 2020 ? a.dcPoints : a.driverControlledPoints), endgame = n(a.endgamePoints);
  return { total, np: auto + teleop + endgame, auto, teleop, endgame, pen: n(a.penaltyPoints) };
}

/** Penalties a season deducts from the offender's own score (vs crediting the opponent). */
export const ownScorePenalties = (season: number) => season === 2020 || season === 2021;

/**
 * TeleOp as FIRST (and FTC Scout) report it, for display and OPR. The engine
 * always splits the endgame out of TeleOp (splitFirstScore); from INTO THE DEEP
 * (2024) on, FIRST's teleopPoints includes the endgame (park/ascent, base,
 * park), so the reported TeleOp adds it back. CENTERSTAGE (2023) reported
 * them separately.
 */
export function teleopAsReported(season: number, s: { teleop: number; endgame: number }): number {
  return reportedTeleopIncludesEndgame(season) ? s.teleop + s.endgame : s.teleop;
}

/**
 * Names for the stored score components of a season, for the result-change
 * timeline (server/data/resultChanges.ts): the engine's season-blind slots
 * (endgame, the three bonus RPs, tips) in the game's own words. The stored
 * TeleOp never includes the endgame (splitFirstScore).
 */
export function resultFieldLabels(season: number): Record<string, string> {
  const endgame = season === 2024 ? "Ascent and park" : season === 2025 ? "Base" : season === 2026 ? "Park" : "Endgame";
  const out: Record<string, string> = {
    total: "Total", np: "Non-penalty points", auto: "Auto",
    teleop: reportedTeleopIncludesEndgame(season) ? `TeleOp (without ${endgame.toLowerCase()})` : "TeleOp",
    endgame, pen: ownScorePenalties(season) ? "Own penalties" : "Penalty points given away",
    dq: "Disqualified teams", result: "Result",
    time: "Scheduled time", field: "Field", red: "Red alliance", blue: "Blue alliance",
  };
  if (season === 2025) Object.assign(out, { "bonus.movement": "Movement RP", "bonus.goal": "Goal RP", "bonus.pattern": "Pattern RP" });
  if (season === 2026) Object.assign(out, { "bonus.movement": "Swarm RP", "bonus.goal": "Pollinator 1 RP", "bonus.pattern": "Pollinator 2 RP", tips: "HIVE TIPs" });
  return out;
}

/** Whether FIRST's reported TeleOp includes the endgame (see teleopAsReported). */
export function reportedTeleopIncludesEndgame(season: number): boolean {
  return season >= 2024;
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
