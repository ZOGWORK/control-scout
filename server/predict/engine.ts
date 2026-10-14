// Control Scout's live prediction engine: the shared Forecaster
// (@control-scout/predict-engine), fed from this app's database.
//
// Same glue as Control Point's server/predict/engine.ts, so both apps give the
// same numbers for the same data: ratings replay the three seasons ending at
// an "anchor" season (Control Point: current−2 … current). Seasons inside the
// current window use the current anchor exactly like Control Point; an older
// season (browsing 2023) gets its own window ending at that season.
import {
  Forecaster, FITTED_MODEL, RatingBook, indexAwards, MODELLED_AWARDS, normType, explainMatch,
  type AdvancementRecord, type AwardRecord, type EventInput, type EventRecord, type Forecast, type PredictModel,
} from "@control-scout/predict-engine";
import { all, kvGet } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { loadSeason, toEventRecord } from "../stats/load.js";

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

export class ScoutForecaster extends Forecaster {
  protected readonly model: PredictModel = FITTED_MODEL;
  protected awardHistory = new Map<number, AwardRecord[]>();
  private books = new Map<number, RatingBook>();
  private events = new Map<number, EventRecord[]>();
  private advancement = new Map<number, AdvancementRecord[]>();
  private regionByCode = new Map<string, string>();
  private regions = new Set<string>();
  builtAt: string | null = null;

  constructor(readonly anchor: number) { super(); }

  get seasons(): number[] { return [this.anchor - 2, this.anchor - 1, this.anchor]; }
  protected hasRatings(): boolean { return this.books.size > 0; }
  protected advancementRecords(season: number): AdvancementRecord[] { return this.advancement.get(season) ?? []; }
  seasonEvents(season: number): EventRecord[] { return this.events.get(season) ?? []; }

  storedPlayedKeys(season: number, code: string): Set<string> {
    const ev = this.events.get(season)?.find((e) => e.code === code);
    return new Set((ev?.matches ?? []).map((m) => `${m.level}:${m.series}:${m.number}`));
  }

  /** Replay the window from the database (oldest season first). */
  async rebuild(): Promise<void> {
    const book = new RatingBook(FITTED_MODEL.rating);
    const records: AwardRecord[] = [];
    const books = new Map<number, RatingBook>(), events = new Map<number, EventRecord[]>(), advancement = new Map<number, AdvancementRecord[]>();
    for (const s of this.seasons) {
      const dbEvents = await loadSeason(s);
      if (!dbEvents.length) continue;
      for (const e of dbEvents) if (e.region) { this.regionByCode.set(e.code, e.region); this.regions.add(e.region); }
      const evs = dbEvents.map((e) => toEventRecord(e)).filter((x): x is EventRecord => !!x).sort((a, b) => a.startTime - b.startTime || a.code.localeCompare(b.code));
      events.set(s, evs);
      advancement.set(s, await loadAdvancement(s));
      for (const e of evs) for (const a of e.awards) records.push({ season: s, team: a.team, time: e.startTime, type: a.type, placement: a.placement });
      book.startSeason(s);
      for (const m of evs.flatMap((e) => e.matches).sort((x, y) => x.time - y.time)) book.update(m);
      books.set(s, book.clone());
      await yieldLoop();
    }
    this.books = books;
    this.events = events;
    this.advancement = advancement;
    this.awardHistory = indexAwards(records);
    this.builtAt = new Date().toISOString();
  }

  /** Ratings for a season with the clock at now (null when the window has none). */
  book(season: number): RatingBook | null {
    const b = this.books.get(season) ?? (season > Math.max(0, ...this.books.keys()) ? this.nextSeasonBook(season) : null);
    if (!b) return null;
    b.setTime(Date.now());
    return b;
  }

  private nextSeasonBook(season: number): RatingBook | null {
    if (!this.books.size) return null;
    const latest = this.books.get(Math.max(...this.books.keys()))!;
    const b = latest.clone();
    b.startSeason(season);
    this.books.set(season, b);
    return b;
  }

  protected regionOf(code: string): string | null {
    const known = this.regionByCode.get(code);
    if (known) return known;
    let best: string | null = null;
    for (const r of this.regions) if (code.startsWith(r) && (!best || r.length > best.length)) best = r;
    return best;
  }

  protected awardSlots(season: number, type: string | null): { type: string; placement: number }[] {
    return this.awardSlotsBefore(season, type, Infinity);
  }

  /** Typical award line-up from events that started before `beforeMs` (pre-event forecasts). */
  awardSlotsBefore(season: number, type: string | null, beforeMs: number): { type: string; placement: number }[] {
    for (const s of [season, season - 1]) {
      const evs = (this.events.get(s) ?? []).filter((e) => normType(e.type) === normType(type) && e.awards.length && e.startTime < beforeMs);
      if (evs.length < 5) continue;
      const count = new Map<string, number>();
      for (const e of evs) for (const k of new Set(e.awards.filter((a) => MODELLED_AWARDS.has(a.type)).map((a) => `${a.type}:${a.placement}`))) count.set(k, (count.get(k) ?? 0) + 1);
      return [...count.entries()].filter(([, c]) => c >= evs.length / 2).map(([k]) => { const [t, p] = k.split(":"); return { type: t, placement: Number(p) }; });
    }
    return [{ type: "Inspire", placement: 1 }, { type: "Inspire", placement: 2 }];
  }

  /**
   * The forecast as it would have been made the day before the event: ratings
   * replayed only from matches before the event's start, and the event's own
   * schedule with every result, rank and alliance stripped (stage "pre").
   * Walk-forward, like the backtest ledger — no hindsight.
   */
  preEventForecast(ev: EventInput, myTeam: number | null, runs = 2000): Forecast | null {
    if (!ev.start) return null;
    const startMs = Date.parse(`${ev.start}T00:00:00Z`);
    const prevSeason = this.books.get(ev.season - 1);
    const book = prevSeason ? prevSeason.clone() : new RatingBook(FITTED_MODEL.rating);
    book.startSeason(ev.season);
    for (const m of this.seasonEvents(ev.season).flatMap((e) => e.matches).filter((m) => m.time < startMs).sort((x, y) => x.time - y.time)) book.update(m);
    book.setTime(startMs);
    const stripped: EventInput = {
      ...ev,
      field: ev.field.map((f) => ({ teamNumber: f.teamNumber, rank: null })),
      alliances: [],
      matches: ev.matches.filter((m) => m.level === "qual").map((m) => ({ ...m, played: false, red: { ...m.red, score: null }, blue: { ...m.blue, score: null } })),
    };
    const parent = this;
    // A one-off view of the same data, frozen at the event's start.
    class Before extends Forecaster {
      protected readonly model = FITTED_MODEL;
      protected readonly awardHistory = parent.awardHistory;
      protected book(season: number) { return season === ev.season ? book : null; }
      protected hasRatings() { return true; }
      storedPlayedKeys() { return new Set<string>(); }
      protected advancementRecords(season: number) {
        // Peers: only lists from events that had finished before this one
        // started (they drive the slot estimate and destination). This event's
        // own list: its slot count and who had already qualified elsewhere were
        // known beforehand; who advanced *from here* was not.
        return parent.advancementRecords(season)
          .filter((a) => a.code === ev.code || Date.parse(`${a.end}T23:59:59Z`) < startMs)
          .map((a) => a.code !== ev.code || !a.advancement ? a : {
            ...a, advancement: { ...a.advancement, rows: a.advancement.rows.filter((r) => r.status === "ALREADY_ADVANCING" || r.status === "INELIGIBLE") },
          });
      }
      protected regionOf(code: string) { return parent.regionOf(code); }
      protected awardSlots(season: number, type: string | null) { return parent.awardSlotsBefore(season, type, startMs); }
    }
    return new Before().forecast(stripped, myTeam, runs);
  }

  /** Match explanation (win %, scores, factors, confidence) from current ratings. */
  explain(season: number, red: number[], blue: number[]) {
    const b = this.book(season);
    if (!b) return null;
    return explainMatch(b, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration });
  }
}

async function loadAdvancement(season: number): Promise<AdvancementRecord[]> {
  const rows = await all<any>(
    "SELECT a.code, a.slots, a.advances_to, a.rows, e.type, e.region, e.end FROM advancement a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.season = ?",
    [season],
  );
  return rows.map((r) => ({
    code: r.code, type: r.type ?? "", region: r.region ?? null, end: r.end ?? "",
    advancement: { slots: Number(r.slots), advancesTo: r.advances_to ?? null, rows: JSON.parse(r.rows) },
  }));
}

// ---------------------------------------------------------------------------
// Registry: one forecaster per anchor, rebuilt when the data version moves.
// ---------------------------------------------------------------------------

const cache = new Map<number, { version: string; f: Promise<ScoutForecaster> }>();

/** The anchor that reproduces Control Point for seasons in its window. */
export const anchorFor = (season: number) => (season >= CURRENT_SEASON - 2 ? Math.max(CURRENT_SEASON, season) : season);

export async function dataVersion(): Promise<string> {
  return (await kvGet<string>("data:version")) ?? "0";
}

export async function forecasterFor(season: number): Promise<ScoutForecaster> {
  const anchor = anchorFor(season);
  const version = await dataVersion();
  const hit = cache.get(anchor);
  if (hit && hit.version === version) return hit.f;
  const f = (async () => { const x = new ScoutForecaster(anchor); await x.rebuild(); return x; })();
  cache.set(anchor, { version, f });
  f.catch(() => cache.delete(anchor));
  return f;
}

/** Drop cached forecasters (tests, or after a manual data change). */
export function resetForecasters(): void { cache.clear(); }
