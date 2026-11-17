// The clip autopilot's checks on the sweep's rows (scripts/video-frames.ts --clips, server/data/clipChecks.ts): each
// clip the live site plays from the clock, read paused at its first second. No row ships unless it keeps the rule: a
// clip is pulled only where its first frame names another match; one whose frame names its own match is ok; one that
// names nothing stays served (unconfirmed). And what its data PR's CHANGELOG entry says.
import type { ClipCheck } from "../../server/data/clipChecks.js";

const isDate = (s: string) => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** The match an overlay names, as the reader compares them: a replay ("M6-2") by its match. */
const base = (label: string) => label.replace(/-\d+$/, "");

/** What's wrong with a sweep row, against the row live now (none: new). Empty: it can ship. */
export function clipCheckProblems(next: ClipCheck, live?: ClipCheck): string[] {
  const out: string[] = [];
  if (!Number.isInteger(next.season)) out.push(`season ${next.season} isn't a season`);
  if (!isDate(next.checked)) out.push(`checked "${next.checked}" isn't a date`);
  if (live && JSON.stringify(live) !== JSON.stringify(next) && !(next.checked >= live.checked)) out.push(`changed with an older checked date than the live row's (${live.checked})`);
  const ok = new Set(next.ok ?? []), pulled = next.pulled ?? {}, unconfirmed = next.unconfirmed ?? {};
  for (const [l, p] of Object.entries(pulled)) {
    if (!Number.isInteger(p.t) || p.t < 0) out.push(`${l}: pulled at ${p.t}, not a second in the video`);
    // Pulled only by a frame naming a different match.
    if (!p.showed || base(p.showed) === base(l)) out.push(`${l}: pulled, but its frame names ${p.showed || "nothing"}`);
    if (ok.has(l)) out.push(`${l}: both ok and pulled`);
    if (unconfirmed[l]) out.push(`${l}: both pulled and unconfirmed`);
  }
  for (const l of ok) if (unconfirmed[l]) out.push(`${l}: both ok and unconfirmed`);
  for (const [l, u] of Object.entries(unconfirmed)) if (!Number.isInteger(u.t) || u.t < 0) out.push(`${l}: unconfirmed at ${u.t}, not a second in the video`);
  if (next.noOverlay && (ok.size || Object.keys(pulled).length)) out.push("no readable overlay, yet a frame was read");
  // What the live row settled stays: a pull is lifted only by a frame naming its own match (ok), and an ok clip is
  // pulled only by a frame naming another.
  for (const l of Object.keys(live?.pulled ?? {})) if (!pulled[l] && !ok.has(l)) out.push(`${l}: a pulled clip back without a frame naming it`);
  for (const l of live?.ok ?? []) if (!ok.has(l) && !pulled[l]) out.push(`${l}: an ok clip dropped without a frame naming another match`);
  return out;
}

/** A sweep PR's numbers against the live rows: clips checked by this sweep, and of them ok, pulled, unconfirmed. */
export function clipsDelta(rows: ClipCheck[], live: Map<string, ClipCheck>): { checked: number; ok: number; pulled: number; unconfirmed: number; noOverlay: number; events: string[]; pulledList: string[] } {
  let ok = 0, pulled = 0, unconfirmed = 0, noOverlay = 0;
  const pulledList: string[] = [];
  for (const r of rows) {
    const was = live.get(`${r.videoId}|${r.code}`);
    ok += (r.ok ?? []).filter((l) => !was?.ok?.includes(l)).length;
    for (const [l, p] of Object.entries(r.pulled ?? {})) if (!was?.pulled?.[l]) { pulled++; pulledList.push(`${r.season} ${r.code} ${l} (${r.videoId} at ${p.t} s shows ${p.showed})`); }
    unconfirmed += Object.keys(r.unconfirmed ?? {}).length;
    if (r.noOverlay && !was?.noOverlay) noOverlay++;
  }
  return { checked: ok + pulled + unconfirmed, ok, pulled, unconfirmed, noOverlay, events: [...new Set(rows.map((r) => `${r.season} ${r.code}`))].sort(), pulledList };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** The sweep PR's CHANGELOG entry ("VERSION" and "#PR" filled by the runner). */
export function clipsEntry(d: ReturnType<typeof clipsDelta>, date: string): string {
  const lead = d.pulled
    ? `Videos › ${n(d.pulled, "clip")} that opened on the wrong match no longer play: the clip autopilot read each clock-placed clip's first frame, and these named another match.`
    : `Videos › ${n(d.checked, "clock-placed clip")} checked by their first frame by the clip autopilot: none opens on another match.`;
  const highlights = d.pulled
    ? [`[fixes] ${n(d.pulled, "clip")} that opened on the wrong match no longer play`, `[fixes] ${n(d.ok, "more clip")} confirmed by their own first frame`, "[fixes] A clip is pulled only when a frame names another match"]
    : [`[fixes] ${n(d.ok, "more clip")} confirmed by their own first frame`, "[fixes] A clip is pulled only when a frame names another match", "[fixes] No clip changes"];
  return [
    `## VERSION — ${date}`, "", lead, "", "### Highlights", ...highlights.map((h) => `- ${h}`), "", "### Fixed",
    `- Videos: clock-placed clips of ${d.events.join(", ")} checked by their first frame, read paused: ${d.ok} name their own match, ${d.pulled} name another match (pulled, never served)${d.pulledList.length ? `: ${d.pulledList.join("; ")}` : ""}, ${d.unconfirmed} name none (still served, read again next sweep)${d.noOverlay ? `, ${n(d.noOverlay, "video")} with no readable overlay` : ""}. (\`server/data/clipChecks.ts\`) (#PR)`,
    "",
  ].join("\n");
}
