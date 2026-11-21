// The owner's recording controls on an event page (server/videos/ownerRecordings.ts, /api/owner/event-recordings/*):
// each video the event's player plays, by day, with Replace (paste a YouTube link or id) and Remove, and Add a
// recording for a day. Drawn only for the account /api/auth/me marks isOwner; the server checks every call itself.
// The owner's choice wins over every automatic link for that day, and a removed video never comes back on its own.
import { useState } from "react";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Input } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, load, prime, useApi } from "../../lib/api";
import type { OwnerEventRecordings } from "../../shared/api";

/** "Sat, Nov 15": a day of the event (a calendar date, read in UTC so it never shifts). */
const fmtDay = (d: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const base = (season: number, code: string) => `/api/owner/event-recordings/${season}/${encodeURIComponent(code)}`;

/** `eventPath`: the event page's own read, fetched again after a change so the player shows it at once. */
export function EventRecordingsOwner({ season, code, eventPath }: { season: number; code: string; eventPath: string }) {
  const path = base(season, code);
  const state = useApi<OwnerEventRecordings>(path);
  const [busy, setBusy] = useState(false);
  const send = async (what: "add" | "replace" | "remove", json: Record<string, unknown>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      prime(path, await apiFetch<OwnerEventRecordings>(`${path}/${what}`, { method: "POST", json }));
      await load(eventPath, true).catch(() => {});
      toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as ApiError).message);
      return false;
    } finally { setBusy(false); }
  };
  const d = state.data;
  return (
    <div className="mt-4 max-w-4xl rounded-xl border border-dashed border-line p-3 text-sm" data-owner-recordings>
      <p className="font-medium text-text-base">Owner: this event's recordings</p>
      <p className="mt-0.5 text-xs text-text-muted">Your pick wins over every link found on its own for that day, and a video you remove never comes back.</p>
      {!d ? (state.error ? <p className="mt-2 text-xs text-danger">{state.error.message}</p> : <div className="skeleton mt-2 h-9 rounded-lg" />) : (
        <>
          {d.videos.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {d.videos.map((v) => <VideoRow key={v.videoId} v={v} days={d.days} busy={busy} send={send} />)}
            </ul>
          )}
          <AddRow days={d.days} taken={new Set(d.videos.map((v) => v.day).filter((x): x is string => !!x))} busy={busy} send={send} />
          {d.removed.length > 0 && (
            <p className="mt-2 text-xs text-text-muted" data-owner-removed>Removed: {d.removed.map((r) => `${r.videoId}${r.day ? ` (${fmtDay(r.day)})` : ""}`).join(", ")}. Add one again for its day to put it back.</p>
          )}
        </>
      )}
    </div>
  );
}

type Send = (what: "add" | "replace" | "remove", json: Record<string, unknown>, done: string) => Promise<boolean>;

function DayPick({ days, value, onChange, label }: { days: string[]; value: string; onChange: (d: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-lg border border-line bg-card px-2 text-sm max-sm:h-10">
      {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
    </select>
  );
}

function VideoRow({ v, days, busy, send }: { v: OwnerEventRecordings["videos"][number]; days: string[]; busy: boolean; send: Send }) {
  const [replacing, setReplacing] = useState(false);
  const [video, setVideo] = useState("");
  const [day, setDay] = useState(v.day && days.includes(v.day) ? v.day : days[0] ?? "");
  return (
    <li className="flex flex-wrap items-center gap-2 py-2" data-owner-video={v.videoId}>
      <span className="w-28 shrink-0 text-text-muted">{v.day ? fmtDay(v.day) : "Day not known"}{v.part ? ` · ${v.part}` : ""}</span>
      <span className="font-mono text-xs">{v.videoId}</span>
      {v.owner && <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-text-muted">Your pick</span>}
      {!replacing ? (
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReplacing(true)} data-owner-replace><RefreshCw className="size-4" aria-hidden /> Replace</Button>
          <Button variant="ghost" size="sm" disabled={busy} data-owner-remove
            onClick={() => { if (window.confirm(`Remove ${v.videoId} from this event? It won't come back on its own.`)) void send("remove", { videoId: v.videoId }, "Recording removed."); }}><Trash2 className="size-4" aria-hidden /> Remove</Button>
        </span>
      ) : (
        <form className="flex basis-full flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await send("replace", { from: v.videoId, video, day }, "Recording replaced.")) { setReplacing(false); setVideo(""); } }}>
          <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="YouTube link or video id" aria-label="The right video" className="h-9 min-w-0 flex-1 basis-56" autoComplete="off" autoFocus />
          {!v.day && <DayPick days={days} value={day} onChange={setDay} label="Its day" />}
          <Button type="submit" size="sm" className="h-9" disabled={busy || !video.trim() || !day}><Check className="size-4" aria-hidden /> Save</Button>
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setReplacing(false)}><X className="size-4" aria-hidden /> Cancel</Button>
        </form>
      )}
    </li>
  );
}

function AddRow({ days, taken, busy, send }: { days: string[]; taken: Set<string>; busy: boolean; send: Send }) {
  const free = days.filter((d) => !taken.has(d));
  const [day, setDay] = useState(free[0] ?? "");
  const [video, setVideo] = useState("");
  if (!free.length) return null;
  const pick = free.includes(day) ? day : free[0];
  return (
    <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (await send("add", { video, day: pick }, "Recording added.")) setVideo(""); }} data-owner-add>
      <span className="text-text-muted">Add a recording for</span>
      <DayPick days={free} value={pick} onChange={setDay} label="Day" />
      <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="YouTube link or video id" aria-label="The video" className="h-9 min-w-0 flex-1 basis-56" autoComplete="off" />
      <Button type="submit" size="sm" className="h-9" disabled={busy || !video.trim()}><Plus className="size-4" aria-hidden /> Add</Button>
    </form>
  );
}
