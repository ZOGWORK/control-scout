// The clip autopilot's choices (scripts/clip-autopilot.ts), kept apart so they're tested: which queued events a run
// reads, and when an event that gave nothing new is tried again.
import { playableStarts } from "../../server/data/frameTimings.js";
import { rowKey, type Row } from "./autopilotRows.js";
export { nothingRead } from "../../server/data/frameRowRules.js";

/** What the runner remembers of each event between runs (by "season/code"): how often it read it with nothing new to
 *  ship, and when it last tried. */
export interface EventMemory { tries: number; last: string; result: string; waits?: number; timeouts?: number; video?: string }
export type Memory = Record<string, EventMemory>;

/** After a read that gave nothing new, an event waits this long before it's read again; after GIVE_UP such reads it's
 *  left (said in the run's log and the owner console's own reasons) until its recording or matches change. */
export const RETRY_MS = 3 * 24 * 3600_000;
export const GIVE_UP = 3;
/** An event whose good rows waited (another session's open PR carries the event) is read again after WAIT_MS,
 *  doubling with each wait in a row up to RETRY_MS: the PR in its way usually merges within hours, and the waits never
 *  count toward GIVE_UP (its rows were good). */
export const WAIT_MS = 6 * 3600_000;
export const waitBackoff = (waits: number) => Math.min(RETRY_MS, WAIT_MS * 2 ** Math.max(0, waits - 1));

export interface Queued { season: number; code: string; name: string; frames: { state: string; due: number; rank?: number } }

/** The events this run reads: queued ones, in the queue's order, not held (`inPr`: in another session's open PR, or
 *  in a job a lane is reading), not waiting out a retry, at most `max`. `skipped` says why each other queued event wasn't picked. */
export function pickEvents(queue: Queued[], inPr: Set<string>, memory: Memory, max: number, now = Date.now()): { picked: Queued[]; skipped: { event: string; why: string }[] } {
  const picked: Queued[] = [], skipped: { event: string; why: string }[] = [];
  const queued = queue.filter((q) => q.frames.state === "queued").sort((a, b) => (a.frames.rank ?? Infinity) - (b.frames.rank ?? Infinity));
  for (const q of queued) {
    const key = `${q.season}/${q.code}`, m = memory[key];
    if (inPr.has(key)) skipped.push({ event: key, why: "read, in an open PR" });
    else if (m?.waits && now - Date.parse(m.last) < waitBackoff(m.waits)) skipped.push({ event: key, why: `its rows waited ${m.waits} time${m.waits === 1 ? "" : "s"} (${m.result}): read again after ${new Date(Date.parse(m.last) + waitBackoff(m.waits)).toISOString().slice(0, 16)}Z` });
    else if (m?.timeouts && now - Date.parse(m.last) < WAIT_MS) skipped.push({ event: key, why: `stopped at the reader's per-event limit with nothing new (${m.result}): read again after ${new Date(Date.parse(m.last) + WAIT_MS).toISOString().slice(0, 16)}Z` });
    else if (m && m.tries >= GIVE_UP) skipped.push({ event: key, why: `read ${m.tries} times with nothing new (${m.result}): left until its recording or matches change` });
    else if (m && !m.waits && !m.timeouts && now - Date.parse(m.last) < RETRY_MS) skipped.push({ event: key, why: `read ${m.last.slice(0, 10)} with nothing new (${m.result}): tried again after ${new Date(Date.parse(m.last) + RETRY_MS).toISOString().slice(0, 10)}` });
    else if (picked.length >= max) skipped.push({ event: key, why: "next run" });
    else picked.push(q);
  }
  return { picked, skipped };
}

/** Several computers each run the autopilot on their own shard of the queue (--shard K/N), so no two read the same
 *  event. An event ("season/code") is in shard FNV-1a(key) mod N: the same on every computer and
 *  every run, whatever else is queued. */
export function shardOf(key: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
  return h % n;
}
/** --shard "K/N" (0 <= K < N), or null when it isn't one. No flag: "0/1", every event. */
export function parseShard(s: string | undefined): { k: number; n: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? "0/1");
  if (!m) return null;
  const k = Number(m[1]), n = Number(m[2]);
  return n >= 1 && k < n ? { k, n } : null;
}
/** A computer with no credentials (no gh, no VM key) that reads one shard for the computer that has them (--lanes
 *  "K=user@host,…" there): that one sends it a job (a snapshot and the events to read), collects what it read, and
 *  hands the server what it read itself. Each lane's shard and ssh address, or why the list isn't one. */
export interface Lane { k: number; host: string }
export function parseLanes(s: string | undefined, shard: { k: number; n: number }): Lane[] | string {
  if (!s) return [];
  const lanes: Lane[] = [];
  for (const part of s.split(",")) {
    const m = /^(\d+)=([\w.-]+@[\w.-]+)$/.exec(part.trim());
    if (!m) return `"${part}": not K=user@host`;
    const k = Number(m[1]);
    if (k >= shard.n || k === shard.k || lanes.some((l) => l.k === k)) return `shard ${k}: not one of the ${shard.n} other than this computer's own (${shard.k}), or given twice`;
    lanes.push({ k, host: m[2] });
  }
  return lanes;
}
/** A lane's state (its .data/lane/state.json): idle (or none), queued (a job sent, not started), running, done or
 *  failed (its results to collect). A lane holds no credentials and the coordinator does, so nothing a lane writes is
 *  trusted: its state only says which step comes next, checked against the coordinator's own record of the job. */
export interface LaneState { state: "idle" | "queued" | "running" | "done" | "failed"; id?: string; at?: string; why?: string }
/** A job the coordinator sent (its own record, .data/autopilot/lanes/<K>/job.json): never the lane's word for it. */
export interface LaneJob { id: string; seasons: { season: number; codes: string[] }[] }
/** A job sent but not started within this long: the lane is started again. */
export const LANE_KICK_MS = 3600_000;
/** The longest a lane's run of `job` can take: per season, its read calls' own limits (two reads, those not read yet
 *  and those read again, each readCallMs of the season's events; 3 h each for --verify and --bounds), and an hour more.
 *  `limitOf`: an event's own read limit (eventLimitMs; unknown: 0, a day's call). A lane still "running" after that was
 *  killed (a reboot, a power cut) before it could say so: what it finished is collected, as for a failed job. */
export const laneJobMs = (job: LaneJob, limitOf: (season: number, code: string) => number = () => 0) =>
  job.seasons.reduce((s, x) => s + 2 * readCallMs(x.codes.map((c) => limitOf(x.season, c))) + 6 * 3600_000, 0) + 3600_000;
/** A job id the coordinator makes (its run's stamp): used in paths and commands, so nothing else is taken. */
export const LANE_ID = /^[\w-]{1,64}$/;
/** What the coordinator does with a lane this run, from its state file's text ("" when it has none) and the job it sent
 *  that lane (null: none outstanding). "reset": the lane's state names no job sent to it (its results, if any, are
 *  left), so it's set idle. */
export function laneStep(text: string, job: LaneJob | null, now = Date.now(), jobMs = job ? laneJobMs(job) : 0): { do: "collect" | "dispatch" | "wait" | "kick" | "reset"; state: LaneState } {
  let state: LaneState;
  try { state = text.trim() ? JSON.parse(text) : { state: "idle" }; } catch { return { do: "wait", state: { state: "failed", why: `its state file isn't JSON: ${text.trim().slice(0, 80)}` } }; }
  if (!state || typeof state !== "object" || typeof state.state !== "string") return { do: "wait", state: { state: "failed", why: "its state file isn't a state" } };
  if (state.id != null && (typeof state.id !== "string" || !LANE_ID.test(state.id))) return { do: "wait", state: { state: "failed", why: "its state names a job id the coordinator never makes" } };
  const ours = !!job && state.id === job.id;
  if (state.state === "done" || state.state === "failed") return { do: ours ? "collect" : "reset", state };
  if (state.state === "queued") return ours ? { do: state.at && now - Date.parse(state.at) > LANE_KICK_MS ? "kick" : "wait", state } : { do: "reset", state };
  if (state.state === "running") {
    if (ours && state.at && now - Date.parse(state.at) > jobMs) return { do: "collect", state: { ...state, state: "failed", why: `still "running" ${Math.round((now - Date.parse(state.at)) / 3600_000)} h after it started, past any read's limits: killed` } };
    return { do: "wait", state };
  }
  return { do: "dispatch", state };
}
/** One season of a lane's results, as the coordinator ships it. */
export interface LaneResult { season: number; codes: string[]; changed: Row[]; readFailed: boolean; stopped: Map<string, string | undefined> }
/** A lane's results for `job` (its files: name and text), kept to the job: only its seasons, only its codes (the job's
 *  own list, not the lane's), rows that are rows of those codes. A season with no file or one that can't be read is a
 *  read that failed (its events not counted as tried). The rows still go through rowProblems like any read's. */
export function laneResults(job: LaneJob, files: { name: string; text: string }[]): LaneResult[] {
  return job.seasons.map(({ season, codes }) => {
    const f = files.find((x) => x.name === `${season}.json`);
    let r: any = null;
    try { r = f ? JSON.parse(f.text) : null; } catch { /* unreadable: failed */ }
    if (!r || typeof r !== "object" || r.season !== season) return { season, codes, changed: [], readFailed: true, stopped: new Map() };
    const ok = (code: unknown): code is string => typeof code === "string" && codes.includes(code);
    const changed = (Array.isArray(r.changed) ? r.changed : []).filter((x: any) => x && typeof x === "object" && typeof x.videoId === "string" && ok(x.code)) as Row[];
    const stopped = new Map<string, string | undefined>((Array.isArray(r.stopped) ? r.stopped : []).filter((x: any) => Array.isArray(x) && ok(x[0]) && (x[1] == null || typeof x[1] === "string")).map((x: any) => [x[0], x[1] ?? undefined]));
    return { season, codes, changed, readFailed: r.readFailed !== false, stopped };
  });
}

/** A read call's own limit, a backstop over its events' (the reader's eventLimitMs, as long as each event's videos):
 *  at least READ_CALL_MS, and never under the sum of the events it reads plus an hour (opening players, the OCR's start),
 *  so an event with more than a day of video (or a call of several long ones) is stopped by its own limit, which keeps its finished
 *  videos and says which video it was on, never by this one first. */
export const READ_CALL_MS = 24 * 3600_000;
export const readCallMs = (eventLimits: number[]) => Math.max(READ_CALL_MS, eventLimits.reduce((s, x) => s + (Number.isFinite(x) && x > 0 ? x : 0), 0) + 3600_000);

/** A season's frame-read data file, as a PR's file list names it (its season), or null. */
export const frameFileSeason = (path: string): number | null => {
  const m = /^server\/data\/frameTimings\/(\d{4})\.ts$/.exec(path);
  return m ? Number(m[1]) : null;
};
/** Events ("season/code") other open PRs bring frame-read rows for, each with the first PR that does: the codes on the
 *  "+" lines of each PR's patch to a season's frame-read file. Another session's data PR holds its events as the
 *  autopilot's own do, so no two PRs carry one event (#1932 and #1933 repeated #1829's USCHSCMPSUBS and USMOKSCMP).
 *  A season's file whose patch GitHub left out (a diff too big to show) is in `unread`, for the caller to read the
 *  PR's own copy of (holdCodes): never silently nothing. */
export function heldElsewhere(prs: { number: number; files: { filename: string; patch?: string }[] }[]): { held: Map<string, number>; unread: { number: number; filename: string }[] } {
  const held = new Map<string, number>(), unread: { number: number; filename: string }[] = [];
  for (const p of prs) for (const f of p.files) {
    const season = frameFileSeason(f.filename);
    if (season == null) continue;
    if (!f.patch) { unread.push({ number: p.number, filename: f.filename }); continue; }
    holdCodes(held, season, f.patch.split("\n").flatMap((line) => (line.startsWith("+") ? [/"code":"([^"]+)"/.exec(line)?.[1]].filter((c): c is string => !!c) : [])), p.number);
  }
  return { held, unread };
}
/** Holds `codes` of `season` for PR `number`, an event already held keeping the first PR that carries it. */
export function holdCodes(held: Map<string, number>, season: number, codes: string[], number: number): void {
  for (const c of codes) if (!held.has(`${season}/${c}`)) held.set(`${season}/${c}`, number);
}

/** Events left to someone else by hand (.data/autopilot/skip.txt): one "season/code" a line, "#" starts a comment.
 *  For another session reading events with no PR open yet, which heldElsewhere can't see. Anything else is ignored. */
export function parseSkip(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d{4})\/([A-Z0-9]+)\s*(?:#.*)?$/i.exec(line);
    if (m) out.add(`${m[1]}/${m[2].toUpperCase()}`);
  }
  return out;
}

/** An event's memory after a read: shipped rows clear it; nothing new counts a try. */
export function remember(memory: Memory, key: string, shipped: number, result: string, now = Date.now()): void {
  if (shipped) { delete memory[key]; return; }
  memory[key] = { tries: (memory[key]?.tries ?? 0) + 1, last: new Date(now).toISOString(), result };
}
/** Timeouts in a row with nothing new before an event stopped at the reader's per-event limit counts a try. */
export const TIMEOUTS_TO_TRY = 2;
/** An event's memory after the reader stopped it at its per-event limit with no new row (a timeout that wrote rows is
 *  progress, remembered as any read that shipped or waited). The first such stop isn't a try (a slow night): read
 *  again after WAIT_MS. The TIMEOUTS_TO_TRY-th in a row counts one (remember): the usual RETRY_MS and GIVE_UP follow,
 *  so a video that always runs past the limit (huge, or broken) stops being read every run. `video`: the one it was
 *  stopped on, for the run's summary and the owner. "counted": this stop counted a try. */
export function rememberTimeout(memory: Memory, key: string, video: string | undefined, now = Date.now()): "again" | "counted" {
  const m = memory[key], timeouts = (m?.timeouts ?? 0) + 1;
  const what = `stopped at the per-event limit${video ? ` on video ${video}` : ""}`;
  if (timeouts >= TIMEOUTS_TO_TRY) { remember(memory, key, 0, `${what}, ${timeouts} runs in a row with nothing new`, now); return "counted"; }
  memory[key] = { tries: m?.tries ?? 0, last: new Date(now).toISOString(), result: what, timeouts, ...(video ? { video } : {}) };
  return "again";
}

/** The events the frame reader stopped at its per-event limit (scripts/video-frames.ts: "CODE: over its N min limit
 *  with video V unfinished: …"), from its stderr, and the video each was on (undefined: stopped between videos). */
export function overLimit(err: string): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const m of err.matchAll(/^(\S+): over its \d+ min limit(?: with video (\S+) unfinished)?:/gm)) out.set(m[1], m[2]);
  return out;
}

/** An event's memory after a read whose good rows all waited: one more wait in a row, its tries left as they were. */
export function rememberWait(memory: Memory, key: string, result: string, now = Date.now()): void {
  const m = memory[key];
  memory[key] = { tries: m?.tries ?? 0, last: new Date(now).toISOString(), result, waits: (m?.waits ?? 0) + 1 };
}

/** What became of one event's read this run, and so what the runner remembers of it (remember / rememberWait / nothing).
 *  `rows`: its good rows (no problem against the live row); `opened`: those handed to the server (delivered);
 *  `waiting`: those that wait (another open PR carries the event); `tooBig`: always 0 now that nothing ships as a PR. */
export type Outcome = "shipped" | "waits" | "timed out" | "open failed" | "read failed" | "too big" | "nothing new";
export function readOutcome(o: { rows: number; opened: number; waiting: number; tooBig: number; readFailed: boolean; timedOut?: boolean; changed?: number }): Outcome {
  if (o.opened) return "shipped";
  if (o.waiting) return "waits";
  // Stopped at the reader's per-event limit having written no row (`changed`: its rows the read changed): no progress.
  if (o.timedOut && !o.changed) return "timed out";
  if (o.rows && o.tooBig >= o.rows) return "too big";
  if (o.rows) return "open failed";
  return o.readFailed ? "read failed" : "nothing new";
}

/** A memory from before a change to the event (its recording or matches) is forgotten: the queue only queues it again
 *  when something changed, or for a read before the event ended. `queuedKeys`: events queued now. */
export const forgetSettled = (memory: Memory, queuedKeys: Set<string>) => { for (const k of Object.keys(memory)) if (!queuedKeys.has(k)) delete memory[k]; };

/** What a delivery's rows change against the live rows: clips added (playable starts the live site doesn't have),
 *  matches settled with a reason, and recordings and events read. */
export function rowsDelta(rows: Row[], live: Map<string, Row>): { clips: number; recordings: number; events: string[]; reasons: number } {
  let clips = 0, reasons = 0;
  for (const r of rows) {
    const had = live.get(rowKey(r)), was = had ? playableStarts(had) : {};
    clips += Object.keys(playableStarts(r)).filter((l) => was[l] == null).length;
    reasons += Object.keys(r.missing ?? {}).length + Object.keys(r.review ?? {}).length + Object.keys(r.earlyStart ?? {}).length;
  }
  return { clips, recordings: rows.length, events: [...new Set(rows.map((r) => r.code))].sort(), reasons };
}
