// The shared engine's Forecaster, fed from the offline packs on this device instead of the server's
// database, so the local estimate builds its simulation input with the engine's own steps
// (src/shared/projectionInput.ts), exactly as the server's projections job does.
//
// What the server's ScoutForecaster reads from its database, and where it comes from here:
//   ratings                  → the lite pack's rating book for the season (built from the same forecaster)
//   matches already learned  → the saved season pack's played matches (same build as the lite pack); a
//                              result newer than the pack is folded in fresh, as on the server
//   recorded bonus RPs       → the season pack's match rows
//   advancement facts        → the season pack's advancement lists (+ the season before, when saved)
//   event regions            → the season pack's events
// Award history isn't needed: projections leave award points out (the advancement label says so).
import { FITTED_MODEL, Forecaster, type AdvancementRecord, type AwardRecord, type BonusFlags, type PredictModel, type RatingBook } from "@control-scout/predict-engine";
import type { Db } from "../offline/readers";

/** Everything the forecaster needs from saved season packs, as plain data. */
export interface PackFacts {
  /** Season → its events' advancement lists (the server's loadAdvancement). */
  advancement: Map<number, AdvancementRecord[]>;
  /** Event code → region. */
  regions: Map<string, string>;
  /** Match keys (`level:series:number`) of the projected event that the ratings already learned. */
  storedKeys: Set<string>;
  /** `key|side` → recorded bonus RPs of the projected event's stored matches (2025+). */
  recordedBonus: Map<string, BonusFlags>;
}

export class PackForecaster extends Forecaster {
  protected readonly model: PredictModel = FITTED_MODEL;
  protected readonly awardHistory = new Map<number, AwardRecord[]>();
  constructor(private readonly season: number, private readonly seasonBook: RatingBook, private readonly facts: PackFacts, private readonly now = Date.now()) { super(); }

  protected book(season: number): RatingBook | null {
    if (season !== this.season) return null;
    this.seasonBook.setTime(this.now);
    return this.seasonBook;
  }
  protected hasRatings(): boolean { return true; }
  storedPlayedKeys(season: number): Set<string> { return season === this.season ? this.facts.storedKeys : new Set(); }
  protected advancementRecords(season: number): AdvancementRecord[] { return this.facts.advancement.get(season) ?? []; }
  protected regionOf(code: string): string | null {
    const known = this.facts.regions.get(code);
    if (known) return known;
    // The server's fallback: the longest known region code that starts the event code.
    let best: string | null = null;
    for (const r of new Set(this.facts.regions.values())) if (code.startsWith(r) && (!best || r.length > best.length)) best = r;
    return best;
  }
  protected awardSlots(): { type: string; placement: number }[] { return []; }
  protected recordedBonus(season: number, _code: string, key: string, side: "red" | "blue"): BonusFlags | null {
    return season === this.season ? this.facts.recordedBonus.get(`${key}|${side}`) ?? null : null;
  }
}

/** A season pack's advancement lists, as the server's loadAdvancement reads them. */
export function readAdvancement(db: Db, season: number): AdvancementRecord[] {
  const has = db.all("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'advancement'").length > 0;
  if (!has) return [];
  return db.all<any>(
    "SELECT a.code, a.slots, a.advances_to, a.rows, e.type, e.region, e.end FROM advancement a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.season = ?",
    [season],
  ).map((r) => ({
    code: r.code, type: r.type ?? "", region: r.region ?? null, end: r.end ?? "",
    advancement: { slots: Number(r.slots), advancesTo: r.advances_to ?? null, rows: JSON.parse(r.rows) },
  }));
}

/**
 * The projected event's facts from its season's pack (the caller adds the season before's advancement
 * lists when that season is saved). Stored matches follow the server's rules (server/stats/load.ts
 * toEventRecord): played, both scores present, robots on the field on both sides; bonus RPs are recorded
 * from 2025 on.
 */
export function readPackFacts(db: Db, season: number, code: string): PackFacts {
  const advancement = new Map<number, AdvancementRecord[]>([[season, readAdvancement(db, season)]]);
  const regions = new Map<string, string>();
  for (const r of db.all<any>("SELECT code, region FROM events WHERE season = ? AND region IS NOT NULL", [season])) regions.set(String(r.code), String(r.region));
  const onField = new Map<string, { red: number; blue: number }>();
  for (const t of db.all<any>("SELECT level, series, number, alliance, COUNT(*) n FROM match_teams WHERE season = ? AND code = ? AND on_field = 1 GROUP BY level, series, number, alliance", [season, code])) {
    const k = `${t.level}:${t.series}:${t.number}`;
    const o = onField.get(k) ?? { red: 0, blue: 0 };
    o[t.alliance === "red" ? "red" : "blue"] = Number(t.n);
    onField.set(k, o);
  }
  const storedKeys = new Set<string>();
  const recordedBonus = new Map<string, BonusFlags>();
  for (const m of db.all<any>("SELECT level, series, number, red_bonus, blue_bonus FROM matches WHERE season = ? AND code = ? AND played = 1 AND red_np IS NOT NULL AND blue_np IS NOT NULL", [season, code])) {
    const k = `${m.level}:${m.series}:${m.number}`;
    const o = onField.get(k);
    if (!o?.red || !o.blue) continue;
    storedKeys.add(k);
    if (season < 2025) continue;
    for (const side of ["red", "blue"] as const) {
      const raw = m[`${side}_bonus`];
      if (!raw) continue;
      try { recordedBonus.set(`${k}|${side}`, JSON.parse(raw) as BonusFlags); } catch { /* unreadable: sampled instead, like an unreported one */ }
    }
  }
  return { advancement, regions, storedKeys, recordedBonus };
}
