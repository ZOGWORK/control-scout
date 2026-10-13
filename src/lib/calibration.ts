// "When we say X%, the favourite wins Y% of the time" — the track record,
// attached to every prediction so the moat is where the user already is.
//
// The ledger's reliability bins are in red's terms (P(red wins) vs red won).
// A favourite can be either colour, so a favourite-side bin combines red's
// bin with the mirrored bin read from blue's side (1 − p, 1 − won).
import { useApi } from "./api";
import type { AccuracyBlock, TrackRecord } from "../shared/api";

export interface CalibrationNote { said: number; won: number; n: number; kind: "live" | "backtest"; seasonLabel: string }

/** Favourite-side bin for a favourite probability (≥ 0.5) from red-side bins. */
export function favouriteBin(b: AccuracyBlock, pFavourite: number): { said: number; won: number; n: number } | null {
  const i = Math.min(9, Math.floor(pFavourite * 10)); // 5..9 for a favourite
  const red = b.reliability[i], blue = b.reliability[9 - i];
  const n = (red?.n ?? 0) + (i === 9 - i ? 0 : blue?.n ?? 0);
  if (!n) return null;
  const said = ((red?.n ?? 0) * (red?.predicted ?? 0) + (i === 9 - i ? 0 : (blue?.n ?? 0) * (1 - (blue?.predicted ?? 0)))) / n;
  const won = ((red?.n ?? 0) * (red?.actual ?? 0) + (i === 9 - i ? 0 : (blue?.n ?? 0) * (1 - (blue?.actual ?? 0)))) / n;
  return { said, won, n };
}

/** Calibration for a prediction (live if it has enough data, else the latest backtest). */
export function calibrationFor(t: TrackRecord | undefined, pRed: number): CalibrationNote | null {
  if (!t) return null;
  const fav = Math.max(pRed, 1 - pRed);
  for (const s of t.seasons) {
    for (const kind of ["live", "backtest"] as const) {
      const b = s[kind];
      if (!b || (kind === "live" && b.n < t.liveThreshold)) continue;
      const bin = favouriteBin(b, fav);
      if (bin && bin.n >= 100) return { ...bin, kind, seasonLabel: s.label.split(" ")[0] };
    }
  }
  return null;
}

export function useCalibration(pRed: number | null): CalibrationNote | null {
  const { data } = useApi<TrackRecord>("/api/predict/accuracy");
  return pRed == null ? null : calibrationFor(data, pRed);
}
