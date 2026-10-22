// Control Scout's live prediction engine: the shared Forecaster
// (@control-scout/predict-engine), fed from this app's database.
//
// Same glue as Control Point's server/predict/engine.ts, so both apps give the
// same numbers for the same data: ratings replay the three seasons ending at
// an "anchor" season (Control Point: current−2 … current). Seasons inside the
// current window use the current anchor exactly like Control Point; an older
// season (browsing 2023) gets its own window ending at that season.
import {
  Forecaster, FITTED_MODEL, RatingBook, indexAwards, MODELLED_AWARDS, normType, explainMatch, type RecentRecord, bonusModelBefore, PartnershipBook, PartnershipTable, bonusSamples, seasonBonusModel,
  type AdvancementRecord, type BonusModelSource, type PartnershipData, type AwardRecord, type BonusFlags, type EventInput, type EventRecord, type Forecast, type MatchRecord, type PredictModel,
} from "@control-scout/predict-engine";
import { all, kvGet } from "../db.js";
import { CURRENT_SEASON, PREDICT_SEASONS } from "../data/seasons.js";
import { loadSeason, toEventRecord } from "../stats/load.js";
import { registerCache } from "../caches.js";
import { onPartnershipPrefixReady, partnershipPrefix } from "./partnerships.js";

const yieldLoop = () => new Promise<void>((r) => setImmediate(r));

/** Teams a season's call can be about: rated that season or the one before (keeps the pair tables small). */
const activeTeams = (books: Map<number, RatingBook>, season: number) =>
  new Set([...(books.get(season)?.ratings.keys() ?? []), ...(books.get(season - 1)?.ratings.keys() ?? [])]);

export class ScoutForecaster extends Forecaster {
  protected readonly model: PredictModel = FITTED_MODEL;
  protected awardHistory = new Map<number, AwardRecord[]>();
  private books = new Map<number, RatingBook>();
  private events = new Map<number, EventRecord[]>();
  /** Stored matches by `season|code|level:series:number`, for recorded bonus RPs. */
  private stored = new Map<string, MatchRecord>();
  private advancement = new Map<number, AdvancementRecord[]>();
  private regionByCode = new Map<string, string>();
  private regions = new Set<string>();
  builtAt: string | null = null;
  /** Pair history through the anchor season (engine 2.4), pruned as the offline pack ships it. */
  partnershipData: PartnershipData | null = null;
  private pairTable: PartnershipTable | null = null;
  /** The window's earlier seasons' pair tables, each as it stood at that season's end (like their ratings). */
  private pastPairTables = new Map<number, PartnershipTable>();
  /** False when the rebuild ran before the finished seasons' pair history was ready (window pairs only). */
  partnershipComplete = false;

  constructor(readonly anchor: number) { super(); }

  /** The window, minus legacy seasons (history only: never replayed into ratings). */
  get seasons(): number[] { return [this.anchor - 2, this.anchor - 1, this.anchor].filter((s) => PREDICT_SEASONS.includes(s)); }
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
    const pastTables = new Map<number, PartnershipTable>();
    // Seasons whose every event is fetched and final (sync freezes them): no result can still arrive.
    const closed = new Set((await all<{ season: number }>("SELECT season FROM seasons WHERE frozen = 1").catch(() => [])).map((r) => Number(r.season)));
    const books = new Map<number, RatingBook>(), events = new Map<number, EventRecord[]>(), advancement = new Map<number, AdvancementRecord[]>();
    // Pair history: the finished seasons before the window from kv (null while it builds), then the window as it replays.
    const prefix = await partnershipPrefix(this.seasons[0] ?? this.anchor);
    const pairs = prefix ?? new PartnershipBook(FITTED_MODEL.rating);
    for (const s of this.seasons) {
      const d = await seasonData(s);
      if (!d) continue;
      for (const [code, region] of d.regions) { this.regionByCode.set(code, region); this.regions.add(region); }
      events.set(s, d.events);
      advancement.set(s, d.advancement);
      for (const e of d.events) for (const a of e.awards) records.push({ season: s, team: a.team, time: e.startTime, type: a.type, placement: a.placement });
      book.startSeason(s);
      // Yield every few thousand matches so pages keep answering during a rebuild.
      let n = 0;
      for (const [code, name] of d.names) pairs.nameEvent(s, code, name);
      for (const m of d.matches) { pairs.observe(m); book.update(m); if (++n % 4000 === 0) await yieldLoop(); }
      books.set(s, book.clone());
      // An earlier season's calls read the pairs through its own end only, never a later season's matches.
      // The weak pairs only matter when an event's unsynced results fold in (PartnershipOverlay): a season
      // that can still receive results keeps them, a closed (frozen) one leaves them out (about 3.5x the rows).
      if (s < this.anchor && pairs.season === s) {
        const table = PartnershipTable.fromData({ ...pairs.toData({ teams: activeTeams(books, s), keepWeak: !closed.has(s) }), season: s });
        if (table) pastTables.set(s, table);
      }
      await yieldLoop();
    }
    this.books = books;
    this.events = events;
    this.stored = new Map([...events.values()].flat().flatMap((e) => e.matches.map((m) => [`${m.season}|${m.eventCode}|${m.level}:${m.series}:${m.number}`, m] as [string, MatchRecord])));
    this.advancement = advancement;
    this.awardHistory = indexAwards(records);
    // Valid for the anchor season, even before its first match (the history is all earlier seasons then).
    // Only pairs of teams active in the anchor season or the one before (the ones a call can be about): keeps the pack small.
    const active = activeTeams(books, this.anchor);
    // The server's table keeps the weak pairs too: an event's fresh results fold into it (PartnershipOverlay) and
    // must count a pair's one earlier match. The offline pack's copy (explanations only, no overlay) leaves them out.
    const ready = pairs.season != null && pairs.season <= this.anchor;
    this.partnershipData = ready ? { ...pairs.toData({ teams: active }), season: this.anchor } : null;
    this.pairTable = ready ? PartnershipTable.fromData({ ...pairs.toData({ teams: active, keepWeak: true }), season: this.anchor }) : null;
    this.pastPairTables = pastTables;
    this.partnershipComplete = !!prefix;
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

  /** Pair history for a season's calls: the anchor's live table, or an earlier window season's table
   *  as it stood at that season's end (an older season's call mustn't read pairs from matches after it). */
  protected partnerships(season: number): PartnershipTable | null {
    if (this.pairTable && this.pairTable.season === season) return this.pairTable;
    return this.pastPairTables.get(season) ?? null;
  }

  /** Recorded bonus RPs of a synced match, for live payloads that omit them. */
  protected recordedBonus(season: number, code: string, key: string, side: "red" | "blue"): BonusFlags | null {
    return this.stored.get(`${season}|${code}|${key}`)?.[side].bonusRp ?? null;
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
    const view = this.preEventView(ev);
    return view ? view.f.forecast(view.ev, myTeam, runs) : null;
  }

  /**
   * The event as it stood the day before it started: a forecaster on ratings from earlier matches
   * only, and the event with its results, ranks and alliances stripped (preEventForecast's inputs;
   * the projections job simulates its pre-event baseline from the same). Null without a start date.
   */
  preEventView(ev: EventInput): { f: Forecaster; ev: EventInput; book: RatingBook } | null {
    if (!ev.start) return null;
    const startMs = Date.parse(`${ev.start}T00:00:00Z`);
    const prevSeason = this.books.get(ev.season - 1);
    const book = prevSeason ? prevSeason.clone() : new RatingBook(FITTED_MODEL.rating);
    book.startSeason(ev.season);
    for (const m of this.seasonEvents(ev.season).flatMap((e) => e.matches).filter((m) => m.time < startMs).sort((x, y) => x.time - y.time)) book.update(m);
    return this.frozenView(ev, book, startMs);
  }

  /**
   * preEventForecast for many events of one season at once (the records
   * table's advancement odds): the season is replayed once, in time order,
   * instead of once per event — same numbers as preEventForecast per event.
   * Yields [event code, forecast or null] in start order.
   */
  *preEventForecasts(season: number, evs: EventInput[], runs = 2000): Generator<[string, Forecast | null]> {
    const prevSeason = this.books.get(season - 1);
    const book = prevSeason ? prevSeason.clone() : new RatingBook(FITTED_MODEL.rating);
    book.startSeason(season);
    const matches = this.seasonEvents(season).flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
    let next = 0;
    const dated = evs.filter((e) => e.season === season && e.start).map((e) => ({ e, startMs: Date.parse(`${e.start}T00:00:00Z`) })).sort((a, b) => a.startMs - b.startMs);
    for (const { e, startMs } of dated) {
      while (next < matches.length && matches[next].time < startMs) book.update(matches[next++]);
      yield [e.code, this.forecastFrozen(e, null, runs, book.clone(), startMs)];
    }
  }

  /**
   * The season's ratings at each of `times` (epoch ms): the book replayed from the season's rated
   * matches before each instant (same order and starting point as rebuild, so replaying past the last
   * match gives the stored ratings), its clock set to that instant. `at` is called in time order, and
   * may only read the book during the call (the replay goes on with the same book). The weekly
   * rankings snapshots (server/stats/rankings.ts) use it.
   */
  replayTo(season: number, times: number[], at: (ms: number, book: RatingBook) => void): void {
    const prevSeason = this.books.get(season - 1);
    const book = prevSeason ? prevSeason.clone() : new RatingBook(FITTED_MODEL.rating);
    book.startSeason(season);
    const matches = this.seasonEvents(season).flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
    let next = 0;
    for (const t of [...times].sort((a, b) => a - b)) {
      while (next < matches.length && matches[next].time < t) book.update(matches[next++]);
      book.setTime(t);
      at(t, book);
    }
  }

  /** Forecast an event from a book frozen at its start, with its results stripped. */
  private forecastFrozen(ev: EventInput, myTeam: number | null, runs: number, book: RatingBook, startMs: number): Forecast | null {
    const view = this.frozenView(ev, book, startMs);
    return view.f.forecast(view.ev, myTeam, runs);
  }

  /** A one-off forecaster on a book frozen at the event's start, and the event with its results stripped. */
  private frozenView(ev: EventInput, book: RatingBook, startMs: number): { f: Forecaster; ev: EventInput; book: RatingBook } {
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
      // Bonus odds as they stood at the start: fitted only to the season's results before it, never the
      // shipped fit or anything later (once per forecast; every upcoming match asks).
      private bonus: BonusModelSource | null | undefined;
      bonusModel(season: number): BonusModelSource | null {
        if (season !== ev.season) return null;
        if (this.bonus === undefined) this.bonus = bonusModelBefore(parent.seasonEvents(season).flatMap((e) => e.matches), startMs);
        return this.bonus;
      }
    }
    return { f: new Before(), ev: stripped, book };
  }

  /**
   * Match explanation (win %, scores, factors, confidence) from current
   * ratings. `level` and `event` feed the contextual win probability; generic
   * what-ifs with no known match default to a qualification match at no event.
   */
  explain(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual", event?: string, recent?: Map<number, RecentRecord>) {
    const b = this.book(season);
    if (!b) return null;
    const table = this.partnerships(season);
    const partnership = table ? { table, season } : undefined;
    // Bonus ranking points count in qualification matches only.
    const bonus = level === "qual" ? this.bonusModel(season) : null;
    return explainMatch(b, red, blue, {
      noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level, event }, shadow: FITTED_MODEL.contextual?.fallback, band: FITTED_MODEL.band, partnership,
      ...(recent ? { recent: (t: number) => recent.get(t) ?? null } : {}),
      ...(bonus ? { bonus: { season, model: bonus } } : {}),
    });
  }

  private bonusModels = new Map<number, BonusModelSource | null>();
  /** The season's bonus-RP model (the shipped fit, else one fitted to this season's recorded results), once per build. */
  bonusModel(season: number): BonusModelSource | null {
    if (!this.bonusModels.has(season)) {
      // Oldest first: the fit keeps the season's latest results (BONUS_WINDOW).
      const matches = () => this.seasonEvents(season).flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
      this.bonusModels.set(season, seasonBonusModel(FITTED_MODEL.bonus, season, () => bonusSamples(matches())));
    }
    return this.bonusModels.get(season)!;
  }

  /** Start time (ISO) of the latest stored result of a season the ratings have learned, or null. */
  ratingsThrough(season: number): string | null {
    let max = -Infinity;
    for (const e of this.events.get(season) ?? []) for (const m of e.matches) if (m.time > max) max = m.time;
    return Number.isFinite(max) ? new Date(max).toISOString() : null;
  }
}

// ---------------------------------------------------------------------------
// Season data, read once per frozen season. A finished season's rows never
// change once frozen (sync skips it), so a new data version (a sync of the
// current season, every 15 min on event days) only re-reads the current one:
// ~70 ms instead of ~6 s of reads for the finished seasons in the window.
// ---------------------------------------------------------------------------

interface SeasonData { events: EventRecord[]; matches: EventRecord["matches"]; advancement: AdvancementRecord[]; regions: [string, string][]; names: [string, string][] }
const seasonCache = new Map<number, { key: string; d: Promise<SeasonData | null> }>();

async function seasonData(season: number): Promise<SeasonData | null> {
  const row = await all<{ frozen: number; last_complete: string | null }>("SELECT frozen, last_complete FROM seasons WHERE season = ?", [season]);
  const key = Number(row[0]?.frozen) === 1 ? `frozen:${row[0].last_complete ?? ""}` : null;
  const hit = seasonCache.get(season);
  if (key && hit?.key === key) return hit.d;
  const d = (async (): Promise<SeasonData | null> => {
    const dbEvents = await loadSeason(season);
    if (!dbEvents.length) return null;
    const events = dbEvents.map((e) => toEventRecord(e)).filter((x): x is EventRecord => !!x).sort((a, b) => a.startTime - b.startTime || a.code.localeCompare(b.code));
    return {
      events, matches: events.flatMap((e) => e.matches).sort((x, y) => x.time - y.time),
      advancement: await loadAdvancement(season),
      regions: dbEvents.filter((e) => e.region).map((e) => [e.code, e.region!] as [string, string]),
      names: dbEvents.map((e) => [e.code, e.name] as [string, string]),
    };
  })();
  if (key) { seasonCache.set(season, { key, d }); d.catch(() => seasonCache.delete(season)); } else seasonCache.delete(season);
  return d;
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

/** The forecaster for exactly the current data (jobs and packs need the newest ratings). */
export async function forecasterFor(season: number): Promise<ScoutForecaster> {
  const anchor = anchorFor(season);
  const version = await dataVersion();
  const hit = cache.get(anchor);
  if (hit && hit.version === version) return hit.f;
  const f = (async () => { const x = new ScoutForecaster(anchor); await x.rebuild(); return x; })();
  cache.set(anchor, { version, f });
  f.then(() => { if (cache.get(anchor)?.f === f) built.set(anchor, { version, f }); }, () => { if (cache.get(anchor)?.f === f) cache.delete(anchor); });
  return f;
}

/** The last fully built forecaster per anchor: what pages answer with while a newer one builds. */
const built = new Map<number, { version: string; f: Promise<ScoutForecaster> }>();

/**
 * For pages: the ratings as of the last finished build, at once. When the data
 * has moved on (a sync just finished), the new build starts in the background
 * and takes over when it's done, so no visitor waits for a rebuild. Only the
 * very first build (server start) is waited for.
 */
export async function liveForecaster(season: number): Promise<ScoutForecaster> {
  const anchor = anchorFor(season);
  const fresh = forecasterFor(season);
  const prev = built.get(anchor);
  if (!prev) return fresh;
  fresh.catch(() => {}); // a failed rebuild keeps the previous ratings
  return prev.f;
}

/** The data version of the ratings pages are answering with (for caches of results computed from them). */
export async function liveVersion(season: number): Promise<string> {
  return built.get(anchorFor(season))?.version ?? dataVersion();
}

/** Rebuild, in the background, every forecaster in use whose data moved on (polled after syncs). */
export async function refreshForecasters(): Promise<void> {
  const version = await dataVersion();
  for (const [anchor, hit] of [...cache]) if (hit.version !== version) await forecasterFor(anchor).catch(() => {});
}

/** Drop cached forecasters and season data (tests, or after a manual data change). Not for syncs: a new data version already rebuilds, without making pages wait. */
export function resetForecasters(): void { cache.clear(); built.clear(); seasonCache.clear(); }
registerCache("Prediction ratings", resetForecasters);

// A forecaster built while the finished seasons' pair history was still building went ahead with its
// window's pairs only. Once that history is ready, rebuild it in the background (pages keep answering
// with it meanwhile, through `built`), so its facts don't stay incomplete until the next data version.
onPartnershipPrefixReady((before) => {
  for (const [anchor, hit] of [...cache]) {
    hit.f.then((f) => {
      if (f.partnershipComplete || (f.seasons[0] ?? f.anchor) !== before || cache.get(anchor) !== hit) return;
      cache.delete(anchor);
      forecasterFor(anchor).catch(() => {});
    }, () => {});
  }
});

/**
 * Teams' recent records (latest RECENT qualification matches) from the stored reliability index, for the
 * explanation's reasons. Public match data only. Words only: no probability depends on it.
 */
export async function recentRecords(season: number, teams: number[]): Promise<Map<number, RecentRecord>> {
  const ts = [...new Set(teams)].filter((t) => t > 0);
  if (!ts.length) return new Map();
  const rows = await all<any>(`SELECT team, recent_matches, recent_no_shows, recent_near_zero FROM team_reliability WHERE season = ? AND code = '' AND team IN (${ts.map(() => "?").join(",")})`, [season, ...ts]).catch(() => []);
  return new Map(rows.map((r) => [Number(r.team), { matches: Number(r.recent_matches), noShows: Number(r.recent_no_shows), nearZero: Number(r.recent_near_zero) }]));
}
