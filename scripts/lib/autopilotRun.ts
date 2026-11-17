// The clip autopilot's choices (scripts/clip-autopilot.ts), kept apart so they're tested: which queued events a run
// reads, when an event that gave nothing new is tried again, and what a data PR says (its CHANGELOG entry).
import { playableStarts } from "../../server/data/frameTimings.js";
import { rowKey, type Row } from "./autopilotRows.js";

/** What the runner remembers of each event between runs (by "season/code"): how often it read it with nothing new to
 *  ship, and when it last tried. */
export interface EventMemory { tries: number; last: string; result: string }
export type Memory = Record<string, EventMemory>;

/** After a read that gave nothing new, an event waits this long before it's read again; after GIVE_UP such reads it's
 *  left (said in the run's log and the owner console's own reasons) until its recording or matches change. */
export const RETRY_MS = 3 * 24 * 3600_000;
export const GIVE_UP = 3;

export interface Queued { season: number; code: string; name: string; frames: { state: string; due: number; rank?: number } }

/** The events this run reads: queued ones, in the queue's order, not already in an open autopilot PR, not waiting out a
 *  retry, at most `max`. `skipped` says why each other queued event wasn't picked. */
export function pickEvents(queue: Queued[], inPr: Set<string>, memory: Memory, max: number, now = Date.now()): { picked: Queued[]; skipped: { event: string; why: string }[] } {
  const picked: Queued[] = [], skipped: { event: string; why: string }[] = [];
  const queued = queue.filter((q) => q.frames.state === "queued").sort((a, b) => (a.frames.rank ?? Infinity) - (b.frames.rank ?? Infinity));
  for (const q of queued) {
    const key = `${q.season}/${q.code}`, m = memory[key];
    if (inPr.has(key)) skipped.push({ event: key, why: "read, in an open autopilot PR" });
    else if (m && m.tries >= GIVE_UP) skipped.push({ event: key, why: `read ${m.tries} times with nothing new (${m.result}): left until its recording or matches change` });
    else if (m && now - Date.parse(m.last) < RETRY_MS) skipped.push({ event: key, why: `read ${m.last.slice(0, 10)} with nothing new (${m.result}): tried again after ${new Date(Date.parse(m.last) + RETRY_MS).toISOString().slice(0, 10)}` });
    else if (picked.length >= max) skipped.push({ event: key, why: "next run" });
    else picked.push(q);
  }
  return { picked, skipped };
}

/** An event's memory after a read: shipped rows clear it; nothing new counts a try. */
export function remember(memory: Memory, key: string, shipped: number, result: string, now = Date.now()): void {
  if (shipped) { delete memory[key]; return; }
  memory[key] = { tries: (memory[key]?.tries ?? 0) + 1, last: new Date(now).toISOString(), result };
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
    `- Videos: frame-read rows for ${d.events.join(", ")} (${season}): ${n(d.clips, "clip")} added, ${n(d.reasons, "match", "matches")} given a reason from the frames. Every start passed the autopilot's checks (opening frame at 20/12/5/2/0 s naming the match, plausible, no live clip pulled without a frame naming another match). (\`server/data/frameTimings/${season}.ts\`) (#PR)`,
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
