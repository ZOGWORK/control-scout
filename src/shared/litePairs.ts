// The lite offline pack's pair history: a small cut of the server's pair table, pre-computed
// for the one season it is valid for. Phones download the lite pack at venues on bad
// connections, and the history is a reason only (it never moves a number), so the pack keeps
// the facts most worth showing and nothing else:
//   - same-alliance pairs only (no head-to-head records);
//   - who played together this season or last;
//   - at least LITE_MIN_MATCHES matches together.
// Each pair is pre-computed: record, best score and where, its shrunk effect and its ranking
// weight as of the pack's season, so the device words and ranks exactly like the server
// (effect to 0.01, weight to 0.1). Rows are sorted and delta-coded to gzip well.
// Shared: the server encodes (server/packs/build.ts), the device decodes (src/lib/offline).
import { PARTNERSHIP_PARAMS, shrunkEffect, type PartnershipData } from "@control-scout/predict-engine";

export const LITE_MIN_MATCHES = 3;
/** Seasons back from the pack's season that still ship (1 = this season and last). */
export const LITE_SEASONS_BACK = 1;

export interface LitePairs {
  v: 1;
  /** The season the facts are valid for (the server table's season). */
  season: number;
  /** [Δteam A, team B − A, matches, W, L, T, best, seasons ago of best, event index, effect × 100, weight × 10] */
  rows: number[][];
  /** [season, code, name] */
  events: [number, string, string][];
}

/** Server side: cut the table down to the lite pack's pairs. */
export function encodeLitePairs(d: PartnershipData): LitePairs | null {
  if (d.season == null) return null;
  const S = d.season, p = PARTNERSHIP_PARAMS;
  const keep = d.together
    .filter((r) => r[2] >= LITE_MIN_MATCHES && S - r[8] <= LITE_SEASONS_BACK)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const events: [number, string, string][] = [];
  const index = new Map<number, number>();
  let prevA = 0;
  const rows = keep.map((r) => {
    const [a, b, n, wins, losses, ties, w, z, season, best, bestSeason, ei] = r;
    let i = index.get(ei);
    if (i == null) { i = events.length; index.set(ei, i); events.push(d.events[ei]); }
    const effect = shrunkEffect({ n, w, z, season }, S, p);
    const weight = w * p.seasonDecay ** Math.max(0, S - season);
    const row = [a - prevA, b - a, n, wins, losses, ties, best, S - bestSeason, i, Math.round(effect * 100), Math.round(weight * 10)];
    prevA = a;
    return row;
  });
  return { v: 1, season: S, rows, events };
}

/**
 * Device side: back to the engine's table data, so explainMatch words and ranks the facts
 * with the same code as the server. Each pair is given decayed sums (w, z) that reproduce its
 * stored weight and effect at the pack's season.
 */
export function decodeLitePairs(l: LitePairs | null | undefined): PartnershipData | null {
  if (!l || l.v !== 1) return null;
  const k = PARTNERSHIP_PARAMS.k;
  let a = 0;
  const together = l.rows.map(([dA, dB, n, wins, losses, ties, best, ago, ei, e100, w10]) => {
    a += dA;
    const w = w10 / 10, effect = e100 / 100;
    return [a, a + dB, n, wins, losses, ties, w, effect * (w + k), l.season, best, l.season - ago, ei];
  });
  return { version: 1, season: l.season, together, against: [], events: l.events };
}
