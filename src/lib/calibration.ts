// "When we say X%, the favourite wins Y% of the time" — the track record,
// attached to every prediction so the moat is where the user already is.
import { useApi } from "./api";
import type { ReliabilityBin, TrackRecord } from "../shared/api";

export interface CalibrationNote { said: number; won: number; n: number; kind: "live" | "backtest"; seasonLabel: string }

/** The reliability bin a favourite's probability falls in (live if it has enough data, else the latest backtest). */
export function calibrationFor(t: TrackRecord | undefined, pFavourite: number): CalibrationNote | null {
  if (!t) return null;
  for (const s of t.seasons) {
    for (const kind of ["live", "backtest"] as const) {
      const b = s[kind];
      if (!b || (kind === "live" && b.n < t.liveThreshold)) continue;
      const bin: ReliabilityBin | undefined = b.reliability[Math.min(9, Math.floor(pFavourite * 10))];
      if (bin && bin.n >= 100) return { said: bin.predicted, won: bin.actual, n: bin.n, kind, seasonLabel: s.label.split(" ")[0] };
    }
  }
  return null;
}

export function useCalibration(pFavourite: number | null): CalibrationNote | null {
  const { data } = useApi<TrackRecord>("/api/predict/accuracy");
  return pFavourite == null ? null : calibrationFor(data, pFavourite);
}
