// Partnership memory (engine 2.4): the pair table behind "1234 and 5678 have
// played 6 matches together …", from every season we hold (2019–20 onward).
//
// The seasons before a forecaster's window (legacy ones included) are frozen,
// so their part of the table — the "prefix" — is built once and kept in kv
// (it holds the PartnershipBook's whole state, so the window's seasons carry
// on from it). The forecaster then observes its own window's matches while it
// replays them (server/predict/engine.ts), so the current season is always up
// to date. A missing prefix never makes a page wait: the rebuild goes ahead
// with the window's pairs only and builds the prefix in the background; the
// next rebuild picks it up. A failed build is retried on the next call.
import { ENGINE_VERSION, FITTED_MODEL, PartnershipBook, type EventRecord, type PartnershipState } from "@control-scout/predict-engine";
import { all, kvGet, kvSet } from "../db.js";
import { SEASON_NUMBERS } from "../data/seasons.js";
import { loadSeason, toEventRecord } from "../stats/load.js";

/** Bump when what goes into the table changes, so every host rebuilds its prefix. */
export const PARTNERSHIP_RULES = 1;

const kvKey = (before: number) => `partnership:prefix:${before}`;

/**
 * What a stored prefix must match: rules, engine and every season it covers as last synced.
 * A frozen season never changes; one that isn't (an old season with an event that failed to
 * fetch, retried by each sync) changes the key when a sync writes it, and the prefix is rebuilt.
 */
async function prefixKey(before: number): Promise<string> {
  const seasons = SEASON_NUMBERS.filter((s) => s < before);
  const rows = await all<{ season: number; frozen: number; last_sync: string | null; last_complete: string | null }>("SELECT season, frozen, last_sync, last_complete FROM seasons");
  const by = new Map(rows.map((r) => [Number(r.season), r]));
  const parts: string[] = [];
  for (const s of seasons) {
    const r = by.get(s);
    if (!r) continue; // a season never synced holds nothing
    parts.push(Number(r.frozen) === 1 ? `${s}:${r.last_complete ?? ""}` : `${s}:open:${r.last_sync ?? ""}`);
  }
  return `${PARTNERSHIP_RULES}|${ENGINE_VERSION}|${parts.join(",")}`;
}

/** Feed one season's rated matches (time order) into a pair book, naming its events. */
export function observeSeason(book: PartnershipBook, season: number, events: EventRecord[], names: Iterable<[string, string]>): void {
  for (const [code, name] of names) book.nameEvent(season, code, name);
  for (const m of events.flatMap((e) => e.matches).sort((a, b) => a.time - b.time)) book.observe(m);
}

async function buildPrefix(before: number, key: string): Promise<PartnershipBook> {
  const book = new PartnershipBook(FITTED_MODEL.rating);
  for (const s of SEASON_NUMBERS.filter((x) => x < before)) {
    const db = await loadSeason(s);
    const events = db.map((e) => toEventRecord(e)).filter((x): x is EventRecord => !!x);
    observeSeason(book, s, events, db.map((e) => [e.code, e.name] as [string, string]));
    await new Promise<void>((r) => setImmediate(r));
  }
  book.endSeason();
  await kvSet(kvKey(before), { key, state: book.toState() });
  return book;
}

const building = new Map<number, Promise<PartnershipBook | null>>();
const cached = new Map<number, { key: string; book: PartnershipBook }>();
const readyListeners: ((before: number) => void)[] = [];

/** Called when a prefix that wasn't ready finishes building (engine.ts rebuilds the forecasters that went without it). */
export function onPartnershipPrefixReady(fn: (before: number) => void): void { readyListeners.push(fn); }

/**
 * The pair book through the seasons before `before` (a copy, free to extend), or
 * null when it isn't built yet (it then builds in the background). `wait`: build
 * it now if missing (stats job, packs).
 */
export async function partnershipPrefix(before: number, opts: { wait?: boolean } = {}): Promise<PartnershipBook | null> {
  const key = await prefixKey(before);
  const hit = cached.get(before);
  if (hit?.key === key) return hit.book.clone();
  const stored = await kvGet<{ key: string; state: PartnershipState }>(kvKey(before));
  if (stored?.key === key) {
    const book = PartnershipBook.fromState(stored.state);
    cached.set(before, { key, book });
    return book.clone();
  }
  let job = building.get(before);
  if (!job) {
    job = buildPrefix(before, key).then((book) => { cached.set(before, { key, book }); return book; }, () => null).finally(() => building.delete(before));
    void job.then((book) => { if (book) for (const fn of readyListeners) fn(before); });
    building.set(before, job);
  }
  if (!opts.wait) return null;
  const book = await job;
  return book ? book.clone() : null;
}

/** Drop the in-memory prefixes (tests). */
export function resetPartnerships(): void { cached.clear(); }
