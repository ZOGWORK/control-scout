// The Download page's list of seasons: each published season pack with what this device holds of it,
// in a useful order, and what "Download all" and "Update all" would fetch. Pure, unit tested.
import type { PackFile } from "../packs";
import type { SavedSeason } from "./seasons";

export type SeasonState = "update" | "saved" | "available";

export interface SeasonRow {
  file: PackFile;
  season: number;
  saved: SavedSeason | null;
  /** update: saved, and a newer release is out; saved: up to date; available: not on this device. */
  state: SeasonState;
}

export interface SeasonPlan {
  rows: SeasonRow[];
  /** Not saved yet: what "Download all" fetches. */
  toDownload: SeasonRow[];
  /** Saved, with a newer release: what "Update all" fetches. */
  toUpdate: SeasonRow[];
  savedCount: number;
}

const ORDER: Record<SeasonState, number> = { update: 0, saved: 1, available: 2 };

/** Single-season packs only (the only kind a device can save), updates first, then saved, then the rest; newest season first in each. */
export function planSeasons(full: PackFile[], saved: SavedSeason[]): SeasonPlan {
  const rows = full.filter((f) => f.kind === "full" && f.seasons.length === 1).map((file): SeasonRow => {
    const season = file.seasons[0];
    const s = saved.find((x) => x.season === season) ?? null;
    return { file, season, saved: s, state: !s ? "available" : s.sha256 !== file.sha256 ? "update" : "saved" };
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.season - a.season);
  return {
    rows,
    toDownload: rows.filter((r) => r.state === "available"),
    toUpdate: rows.filter((r) => r.state === "update"),
    savedCount: rows.filter((r) => r.saved).length,
  };
}

/** Total bytes of some rows' files. */
export const bytesOf = (rows: SeasonRow[]) => rows.reduce((n, r) => n + r.file.bytes, 0);
