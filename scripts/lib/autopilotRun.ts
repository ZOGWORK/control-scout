// The clip autopilot's choices (scripts/clip-autopilot.ts), kept apart so they're tested: which queued events a run
// reads, when an event that gave nothing new is tried again, and what a data PR says (its CHANGELOG entry).
import { playableStarts } from "../../server/data/frameTimings.js";
import { rowKey, type Keyed, type Row } from "./autopilotRows.js";

/** What the runner remembers of each event between runs (by "season/code"): how often it read it with nothing new to
 *  ship, and when it last tried. */
export interface EventMemory { tries: number; last: string; result: string; waits?: number; timeouts?: number; video?: string }
export type Memory = Record<string, EventMemory>;

/** After a read that gave nothing new, an event waits this long before it's read again; after GIVE_UP such reads it's
 *  left (said in the run's log and the owner console's own reasons) until its recording or matches change. */
export const RETRY_MS = 3 * 24 * 3600_000;
export const GIVE_UP = 3;
/** An event whose good rows waited (they touch an open PR's lines, or didn't fit this run's PRs) is read again after
 *  WAIT_MS, doubling with each wait in a row up to RETRY_MS: the PR in its way usually merges within hours, and the
 *  waits never count toward GIVE_UP (its rows were good). */
export const WAIT_MS = 6 * 3600_000;
export const waitBackoff = (waits: number) => Math.min(RETRY_MS, WAIT_MS * 2 ** Math.max(0, waits - 1));

export interface Queued { season: number; code: string; name: string; frames: { state: string; due: number; rank?: number } }

/** The events this run reads: queued ones, in the queue's order, not already in an open autopilot PR, not waiting out a
 *  retry, at most `max`. `skipped` says why each other queued event wasn't picked. */
export function pickEvents(queue: Queued[], inPr: Set<string>, memory: Memory, max: number, now = Date.now()): { picked: Queued[]; skipped: { event: string; why: string }[] } {
  const picked: Queued[] = [], skipped: { event: string; why: string }[] = [];
  const queued = queue.filter((q) => q.frames.state === "queued").sort((a, b) => (a.frames.rank ?? Infinity) - (b.frames.rank ?? Infinity));
  for (const q of queued) {
    const key = `${q.season}/${q.code}`, m = memory[key];
    if (inPr.has(key)) skipped.push({ event: key, why: "read, in an open autopilot PR" });
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
 *  event or open PRs for it. An event ("season/code") is in shard FNV-1a(key) mod N: the same on every computer and
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
/** The shard that keeps an open autopilot PR (rebuilds it, labels it, asks for its review): a frame-read PR's, that of
 *  its first event (its rows' "season/code", sorted), the one that opened it; a sweep PR's (no events of its own)
 *  shard 0's, the one that sweeps. */
export function prShard(p: { season: number; rows: string[]; file?: string }, n: number): number {
  if (p.file) return 0;
  const events = p.rows.map((k) => `${p.season}/${k.split("|")[1]}`).sort();
  return events.length ? shardOf(events[0], n) : 0;
}

/** A computer with no credentials (no gh, no VM key) that reads one shard for the computer that has them (--lanes
 *  "K=user@host,…" there): that one sends it a job (a snapshot and the events to read), collects what it read, and
 *  opens the PRs itself. Each lane's shard and ssh address, or why the list isn't one. */
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
/** The longest a lane's run of `job` can take: per season, its read calls' own limits (12 h a read, 3 h each for
 *  --verify and --bounds), and an hour more. A lane still "running" after that was killed (a reboot, a power cut) before
 *  it could say so: what it finished is collected, as for a failed job. */
export const laneJobMs = (job: LaneJob) => job.seasons.length * 18 * 3600_000 + 3600_000;
/** A job id the coordinator makes (its run's stamp): used in paths and commands, so nothing else is taken. */
export const LANE_ID = /^[\w-]{1,64}$/;
/** What the coordinator does with a lane this run, from its state file's text ("" when it has none) and the job it sent
 *  that lane (null: none outstanding). "reset": the lane's state names no job sent to it (its results, if any, are
 *  left), so it's set idle. */
export function laneStep(text: string, job: LaneJob | null, now = Date.now()): { do: "collect" | "dispatch" | "wait" | "kick" | "reset"; state: LaneState } {
  let state: LaneState;
  try { state = text.trim() ? JSON.parse(text) : { state: "idle" }; } catch { return { do: "wait", state: { state: "failed", why: `its state file isn't JSON: ${text.trim().slice(0, 80)}` } }; }
  if (!state || typeof state !== "object" || typeof state.state !== "string") return { do: "wait", state: { state: "failed", why: "its state file isn't a state" } };
  if (state.id != null && (typeof state.id !== "string" || !LANE_ID.test(state.id))) return { do: "wait", state: { state: "failed", why: "its state names a job id the coordinator never makes" } };
  const ours = !!job && state.id === job.id;
  if (state.state === "done" || state.state === "failed") return { do: ours ? "collect" : "reset", state };
  if (state.state === "queued") return ours ? { do: state.at && now - Date.parse(state.at) > LANE_KICK_MS ? "kick" : "wait", state } : { do: "reset", state };
  if (state.state === "running") {
    if (ours && state.at && now - Date.parse(state.at) > laneJobMs(job!)) return { do: "collect", state: { ...state, state: "failed", why: `still "running" ${Math.round((now - Date.parse(state.at)) / 3600_000)} h after it started, past any read's limits: killed` } };
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
 *  `rows`: its good rows; `opened`: those a PR opened with; `waiting`: those that wait (prChunks later); `tooBig`: those
 *  no PR Loopy can review holds (the owner's). */
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

/** Why an open autopilot PR is rebuilt on main (none: it's left as it is; never to renumber): it conflicts; main
 *  changed or removed one of its rows since it branched (`baseRows`: its file at the merge base, [] where it didn't
 *  exist); or it still carries a release file (`changedFiles`: its files changed since the merge base). */
export function needsRebuild(o: { mergeable: string; want: Set<string>; baseRows: Keyed[]; mainRows: Keyed[]; changedFiles: string[]; releaseFiles: string[] }): string[] {
  const was = new Map(o.baseRows.map((r) => [rowKey(r), JSON.stringify(r)])), now = new Map(o.mainRows.map((r) => [rowKey(r), JSON.stringify(r)]));
  const mainMoved = [...o.want].some((k) => was.get(k) !== now.get(k));
  const release = o.changedFiles.some((f) => o.releaseFiles.includes(f.trim()));
  return [o.mergeable === "CONFLICTING" && "conflict", mainMoved && "main changed its rows", release && "release dropped"].filter((x): x is string => !!x);
}

/** Whether to ask Loopy to review a PR's `head`: not while Loopy's latest summary already names it (`reviewed`), and at
 *  most once a day for the same head (`asked`: the last ask). A new head (a rebuild) asks at once. */
export const ASK_EVERY_MS = 24 * 3600_000;
export function askDue(asked: { head: string; at: string } | undefined, head: string, reviewed: string | null, now = Date.now()): boolean {
  if (reviewed && head.startsWith(reviewed)) return false;
  return !asked || asked.head !== head || now - Date.parse(asked.at) >= ASK_EVERY_MS;
}

/** A memory from before a change to the event (its recording or matches) is forgotten: the queue only queues it again
 *  when something changed, or for a read before the event ended. `queuedKeys`: events queued now. */
export const forgetSettled = (memory: Memory, queuedKeys: Set<string>) => { for (const k of Object.keys(memory)) if (!queuedKeys.has(k)) delete memory[k]; };

/** What a data PR's rows change against the live rows: clips added (playable starts the live site doesn't have),
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

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** The PR's CHANGELOG entry, "VERSION" and "PR" left for the runner to fill (the version is taken when the PR is made
 *  or rebuilt on main; the PR number once it exists). */
export function changelogEntry(season: number, d: ReturnType<typeof rowsDelta>, date: string): string {
  const where = `${n(d.recordings, "recording")} of ${n(d.events.length, "event")}`;
  const lead = d.clips
    ? `Videos › ${n(d.clips, "more match", "more matches")} get clips, each start read off its recording's own frames (${where}, ${season}), read and checked by the clip autopilot.`
    : `Videos › ${where} (${season}) are checked against their frames by the clip autopilot: no new clip, and every match they hold has its reason.`;
  const highlights = d.clips
    ? [`[fixes] ${n(d.clips, "more match", "more matches")} get clips read off their recordings`, "[fixes] Each clip opens on a frame naming its match", "[fixes] Read automatically once the event ended"]
    : [`[fixes] ${n(d.recordings, "more recording")} checked against their frames`, "[fixes] Each missing match says what the video shows", "[fixes] No clip changes"];
  return [
    `## VERSION — ${date}`, "", lead, "", "### Highlights", ...highlights.map((h) => `- ${h}`), "", "### Fixed",
    `- Videos: frame-read rows for ${d.events.join(", ")} (${season}): ${n(d.clips, "clip")} added, ${n(d.reasons, "match", "matches")} given a reason from the frames. Every start passed the autopilot's checks (opening frame 20/12/5/2/0 s before or 2/4 s after the start, naming the match, plausible, no live clip pulled without a frame naming another match). (\`server/data/frameTimings/${season}.ts\`) (#PR)`,
    "",
  ].join("\n");
}

/** The next release after `v` (src/lib/changelog.ts nextRelease, here without its browser imports): the last number
 *  steps, carrying at 9. */
export function nextVersion(v: string): string {
  const p = v.split(".").map(Number);
  let i = p.length - 1;
  p[i]++;
  while (i > 0 && p[i] > 9) { p[i] = 0; p[--i]++; }
  return p.join(".");
}
