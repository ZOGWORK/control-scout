// Past seasons' official game manuals, for questions about a game we hold no quick reference for. FIRST keeps each
// season under ftc-resources' archive, by the year the season ends (INTO THE DEEP, 2024–25, is archive/2025).
// Checked 2026-11-02: from 2021–22 to 2023–24 the game rules are Game Manual Part 2 (gm2); from 2024–25 one
// Competition Manual; for 2019–20 and 2020–21 the archive keeps no manual, so the link is that season's archive page.

export interface PastManual {
  /** The manual (PDF), or the season's archive page when FIRST keeps none. */
  url: string;
  /** What the link opens. */
  what: string;
}

const ARCHIVE = "https://ftc-resources.firstinspires.org/ftc/archive";

export const PAST_MANUALS: Readonly<Record<number, PastManual>> = {
  2019: { url: `${ARCHIVE}/2020`, what: "FIRST's SKYSTONE season archive" },
  2020: { url: `${ARCHIVE}/2021`, what: "FIRST's ULTIMATE GOAL season archive" },
  2021: { url: `${ARCHIVE}/2022/game/gm2`, what: "Game Manual Part 2, the game rules (PDF)" },
  2022: { url: `${ARCHIVE}/2023/game/gm2`, what: "Game Manual Part 2, the game rules (PDF)" },
  2023: { url: `${ARCHIVE}/2024/game/gm2`, what: "Game Manual Part 2, the game rules (PDF)" },
  2024: { url: `${ARCHIVE}/2025/game/manual`, what: "Competition Manual (PDF)" },
  2025: { url: `${ARCHIVE}/2026/game/manual`, what: "Competition Manual (PDF)" },
};

/** FIRST's archive of every past season, for a season not in the list. */
export const PAST_SEASONS_ARCHIVE = ARCHIVE;

/** The official manual for a past season, or the archive. */
export const pastManual = (season: number): PastManual =>
  Object.hasOwn(PAST_MANUALS, season) ? PAST_MANUALS[season] : { url: PAST_SEASONS_ARCHIVE, what: "FIRST's past seasons archive" };
