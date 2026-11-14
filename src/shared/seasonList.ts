// The FTC seasons Control Scout holds, by their years and their game: data only, shared by the server
// (server/data/seasons.ts, where every season-specific rule lives) and search's parser on the device with no signal
// (src/shared/query/time.ts).

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
