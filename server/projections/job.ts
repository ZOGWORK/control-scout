// The projections job: re-simulates an event when its results move, in the background.
//
// Never on request: pages only read stored runs (store.ts). The server process ticks every TICK_MS:
//   1. Scan (when the data version moved, or every SCAN_EVERY_MS): each live, upcoming or just
//      finished event of the current season that advances teams gets a cheap signature from SQL
//      (match count, results, lineups, ranks, alliances). A signature it hasn't seen marks the event
//      pending, due DEBOUNCE_MS later; another change before then pushes it back again, up to
//      MAX_WAIT_MS after the first, so a burst of results (a sync posting ten matches, the fast lane
//      then the full cycle) collapses into one run.
//   2. Run due events one at a time (the VM is small and shared). A run reads the event fresh,
//      reduces it to its exact results state (state.ts) and skips when the stored run already has that
//      state and engine version (a restart, or a signature change that doesn't touch the simulation).
//      Otherwise: the pre-event baseline when it's missing (or the schedule changed before any match
//      was played), then the current run, both PROJECTION_RUNS simulations, PROJECTION_FLOOR when the
//      event blows BUDGET_MS. Seeds come from (event, kind, state), so the same state gives the same
//      numbers. The simulation yields to the event loop every ~20 ms (core.ts).
//   3. Store, then tell open pages (bus.ts → the projections stream).
import { ADVANCING_TYPES, ENGINE_VERSION, normType } from "@control-scout/predict-engine";
import { all } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { eventDetail, toEventInput } from "../api/events.js";
import { dataVersion, forecasterFor } from "../predict/engine.js";
import { PROJECTION_FLOOR, PROJECTION_RUNS, type ProjectionKind } from "../../src/shared/projections.js";
import { simulateProjection, textSeed } from "./core.js";
import { projectionInput, type ProjectionInput } from "./input.js";
import { eventState } from "./state.js";
import { saveRuns, storedRuns, type StoredRun } from "./store.js";
import { publishProjections } from "./bus.js";

type Log = (m: string) => void;

export const TICK_MS = 5_000;
export const SCAN_EVERY_MS = 60_000;
export const DEBOUNCE_MS = 15_000;
export const MAX_WAIT_MS = 60_000;
/** Compute budget for one run of PROJECTION_RUNS; slower events drop to PROJECTION_FLOOR. */
export const BUDGET_MS = 10_000;

const today = (now: number, d = 0) => new Date(now + d * 864e5).toISOString().slice(0, 10);

export interface Candidate { season: number; code: string; signature: string }

/** Events worth projecting now, each with a signature of everything that moves with its results. */
export async function candidates(now = Date.now(), season = CURRENT_SEASON): Promise<Candidate[]> {
  const rows = await all<any>(
    `SELECT e.season, e.code, e.type,
       (SELECT COUNT(*) || ':' || COALESCE(SUM(m.played), 0) || ':' || COALESCE(SUM(COALESCE(m.red_total, -1) * 1009 + COALESCE(m.blue_total, -1)), 0) || ':' || COALESCE(SUM(COALESCE(m.red_np, 0) * 7 + COALESCE(m.blue_np, 0) * 13 + COALESCE(m.red_auto, 0) * 3 + COALESCE(m.blue_auto, 0) * 5), 0) || ':' || COALESCE(SUM(LENGTH(COALESCE(m.red_bonus, '')) + LENGTH(COALESCE(m.blue_bonus, '')) * 3), 0)
          FROM matches m WHERE m.season = e.season AND m.code = e.code) ms,
       (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.level = 'qual') quals,
       (SELECT COUNT(*) || ':' || COALESCE(SUM(mt.team * (mt.number + 7 * mt.series + 1) * (CASE mt.alliance WHEN 'red' THEN 1 ELSE 2 END) + COALESCE(mt.dq, 0) * 17 + COALESCE(mt.surrogate, 0) * 31), 0)
          FROM match_teams mt WHERE mt.season = e.season AND mt.code = e.code) mt,
       (SELECT COUNT(*) || ':' || COALESCE(SUM(t.team * (COALESCE(t.rank, 0) + 1)), 0) FROM event_teams t WHERE t.season = e.season AND t.code = e.code) ts,
       (SELECT COUNT(*) || ':' || COALESCE(SUM(COALESCE(a.captain, 0) + COALESCE(a.pick1, 0) * 3 + COALESCE(a.pick2, 0) * 7), 0) FROM alliances a WHERE a.season = e.season AND a.code = e.code) al
     FROM events e WHERE e.season = ? AND e.start <= ? AND COALESCE(e.end, e.start) >= ?`,
    [season, today(now, 3), today(now, -2)],
  );
  return rows
    .filter((r) => ADVANCING_TYPES.has(normType(r.type)) && Number(r.quals) > 0)
    .map((r) => ({ season: Number(r.season), code: String(r.code), signature: [r.ms, r.mt, r.ts, r.al].join("|") }));
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

interface Pending { firstAt: number; dueAt: number }

export class Debouncer {
  private seen = new Map<string, string>();
  private pending = new Map<string, Pending>();
  constructor(private readonly delayMs = DEBOUNCE_MS, private readonly maxWaitMs = MAX_WAIT_MS) {}

  /** Report an event's signature; a new one (re)arms its timer. */
  note(key: string, signature: string, now: number): void {
    if (this.seen.get(key) === signature) return;
    this.seen.set(key, signature);
    const p = this.pending.get(key);
    const firstAt = p?.firstAt ?? now;
    this.pending.set(key, { firstAt, dueAt: Math.min(now + this.delayMs, firstAt + this.maxWaitMs) });
  }

  /** Events whose timer has run out, oldest first; they leave the pending list. */
  take(now: number): string[] {
    const due = [...this.pending.entries()].filter(([, p]) => p.dueAt <= now).sort((a, b) => a[1].firstAt - b[1].firstAt).map(([k]) => k);
    for (const k of due) this.pending.delete(k);
    return due;
  }

  /** Forget a signature (a failed run is retried on the next scan). */
  forget(key: string): void { this.seen.delete(key); }
  get size(): number { return this.pending.size; }
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------

export interface RunOptions { budgetMs?: number; runs?: number; floor?: number; log?: Log; now?: () => number }
export type RunOutcome = { status: "ran"; runs: StoredRun[] } | { status: "unchanged" } | { status: "skipped"; reason: string };

async function simulateKind(kind: ProjectionKind, season: number, code: string, stateKey: string, pi: ProjectionInput, st: { played: number; scheduled: number; through: string | null }, o: RunOptions): Promise<StoredRun> {
  const seed = textSeed(`${season}|${code}|${kind}|${stateKey}`);
  const target = o.runs ?? PROJECTION_RUNS;
  const r = await simulateProjection(pi.input, { runs: target, floor: Math.min(target, o.floor ?? PROJECTION_FLOOR), budgetMs: o.budgetMs ?? BUDGET_MS, seed });
  return {
    kind, stateKey, seed, runs: r.runs, target, stage: pi.stage, played: st.played, scheduled: st.scheduled, through: st.through,
    slots: pi.slots, slotsSource: pi.slotsSource, engineVersion: ENGINE_VERSION, ms: r.wallMs, computedAt: new Date((o.now ?? Date.now)()).toISOString(), teams: r.teams,
  };
}

/** Simulate one event from its stored data, store the runs and tell open pages. */
export async function projectEvent(season: number, code: string, o: RunOptions = {}): Promise<RunOutcome> {
  const d = await eventDetail(season, code);
  if (!d) return { status: "skipped", reason: "no such event" };
  if (d.forecastUnsupported) return { status: "skipped", reason: d.forecastUnsupported };
  const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
  const st = eventState(ev);
  if (!st.scheduled) return { status: "skipped", reason: "no qualification schedule yet" };
  const stored = await storedRuns(season, code);
  const cur = stored.get("current"), base = stored.get("baseline");
  const fresh = (r: StoredRun | undefined, key: string) => !!r && r.stateKey === key && r.engineVersion === ENGINE_VERSION;
  if (fresh(cur, st.key) && fresh(base, st.scheduleKey)) return { status: "unchanged" };
  const f = await forecasterFor(season);
  const out: StoredRun[] = [];
  // Pre-event baseline: ratings frozen at the event's start, results stripped (what the event looked like before it began).
  let baseline = base;
  if (!fresh(base, st.scheduleKey) && (!base || st.played === 0 || base.engineVersion !== ENGINE_VERSION)) {
    const view = f.preEventView(ev);
    const pi = view && projectionInput(view.f, view.ev);
    if (pi) { baseline = await simulateKind("baseline", season, code, st.scheduleKey, pi, { played: 0, scheduled: st.scheduled, through: null }, o); out.push(baseline); }
  }
  if (!fresh(cur, st.key)) {
    const pi = projectionInput(f, ev);
    if (!pi) return { status: "skipped", reason: "no ratings for this season yet" };
    // Nothing played or ranked yet: the current projection is the baseline.
    const current: StoredRun = pi.stage === "pre" && baseline && baseline.stateKey === st.scheduleKey
      ? { ...baseline, kind: "current", stateKey: st.key }
      : await simulateKind("current", season, code, st.key, pi, st, o);
    out.push(current);
    // While quals are still open, this is also what a finished event will be judged against.
    if (st.played < st.scheduled) out.push({ ...current, kind: "last_open" });
  }
  if (!out.length) return { status: "unchanged" };
  await saveRuns(season, code, out);
  const latest = out.find((r) => r.kind === "current") ?? out[0];
  publishProjections({ season, code, computedAt: latest.computedAt, runs: latest.runs, through: latest.through });
  o.log?.(`projections: ${code} ${out.map((r) => `${r.kind} ${r.runs} sims ${Math.round(r.ms)} ms`).join(", ")}${st.through ? ` (after ${st.through})` : ""}`);
  return { status: "ran", runs: out };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export interface JobState { debouncer: Debouncer; lastScan: number; lastVersion: string | null; running: boolean }
export const newJobState = (): JobState => ({ debouncer: new Debouncer(), lastScan: -Infinity, lastVersion: null, running: false });
const state = newJobState();

/** Test seam: what a due event runs. */
export const jobIo = { run: (season: number, code: string, log: Log) => projectEvent(season, code, { log }) };

/** One tick: scan when due, then run what's due, one event at a time. Returns the events run. */
export async function projectionTick(now = Date.now(), log: Log = () => {}, s: JobState = state): Promise<string[]> {
  if (s.running) return [];
  s.running = true;
  try {
    const version = await dataVersion();
    if (version !== s.lastVersion || now - s.lastScan >= SCAN_EVERY_MS) {
      s.lastVersion = version; s.lastScan = now;
      for (const c of await candidates(now)) s.debouncer.note(`${c.season}|${c.code}`, c.signature, now);
    }
    const ran: string[] = [];
    for (const key of s.debouncer.take(now)) {
      const [season, code] = key.split("|");
      try {
        const r = await jobIo.run(Number(season), code, log);
        if (r.status === "ran") ran.push(key);
      } catch (e) {
        s.debouncer.forget(key); // try again on the next scan
        log(`projections: ${code} failed: ${(e as Error).message}`);
      }
    }
    return ran;
  } finally {
    s.running = false;
  }
}

/** Start the job in the server process (off with CS_NO_SCHEDULER or PROJECTIONS=off). */
export function startProjections(log: Log): void {
  if (process.env.CS_NO_SCHEDULER || process.env.PROJECTIONS === "off") return;
  log(`projections: checking every ${TICK_MS / 1000} s, ${PROJECTION_RUNS.toLocaleString("en-US")} simulations per run`);
  setInterval(() => { projectionTick(Date.now(), log).catch((e) => log(`projections: ${(e as Error).message}`)); }, TICK_MS).unref();
}
