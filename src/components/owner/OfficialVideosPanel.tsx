// Owner console › Official videos (docs/official-videos.md, server/videos/officialOwnerRoutes.ts). The auto-watcher's
// state (API key, last run, quota today, Run now), then its review queue: each video it couldn't add on its own, with
// why and the event it fits best, to approve (as a day's recording or a highlight) or reject. Then what was added or
// decided lately (any can be taken off its event), the videos set aside as not competition streams, and the watched
// channels with their region rules. Every action is audited on the server.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Play, RefreshCw, Trash2, Tv, X } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge, Input } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { thumbnailUrl } from "../../shared/stream";
import { watchUrl } from "../../shared/recording";
import type { OfficialChannelRow, OfficialWatchRow, OwnerOfficialVideos } from "../../shared/api";

const PATH = "/api/owner/official-videos";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const mins = (s: number | null) => (s == null ? "" : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);

async function act(path: string, init: { method: string; json?: unknown }, done: string): Promise<boolean> {
  try {
    const r = await apiFetch<OwnerOfficialVideos>(`${PATH}${path}`, init);
    prime(PATH, r);
    prime(`${PATH}/counts`, { pending: r.pending.length });
    toast.success(done);
    return true;
  } catch (e) {
    toast.error((e as ApiError).message);
    return false;
  }
}

export function OfficialVideosPanel() {
  const state = useApi<OwnerOfficialVideos>(PATH);
  return (
    <Async state={state}>
      {(d) => (
        <div className="grid gap-8">
          <Status d={d} />
          <Section title={<>To review {d.pending.length > 0 && <Badge variant="soft" className="ml-1 align-middle">{d.pending.length}</Badge>}</>}
            description="Videos the watcher found on an official channel but couldn't add on its own: why, and the event it fits best. Approve one as a day's recording or as a highlight, or reject it. Either way it's never proposed again.">
            {d.pending.length ? <ul className="grid gap-3">{d.pending.map((w) => <Review key={w.videoId} w={w} />)}</ul>
              : <EmptyState icon={Tv} title="Nothing to review" description="New videos on the watched channels show here when they can't be added on their own." />}
          </Section>
          <Section title="Added and decided lately" description="The watcher's own adds, and your approvals and rejections. Removing a video takes it off its event for good.">
            {d.decided.length ? <ul className="grid gap-2">{d.decided.map((w) => <Decided key={w.videoId} w={w} />)}</ul>
              : <p className="text-sm text-muted-foreground">Nothing yet.</p>}
          </Section>
          <Section title={`Set aside (${d.ignored.length})`} collapsible summary="Not competition streams by their title: webinars, kickoffs, FRC and so on. Any can still be approved."
            description="Not competition streams by their title: webinars, kickoffs, FRC and so on. Any can still be approved.">
            {d.ignored.length ? <ul className="grid gap-3">{d.ignored.map((w) => <Review key={w.videoId} w={w} />)}</ul> : <p className="text-sm text-muted-foreground">None.</p>}
          </Section>
          <Channels channels={d.channels} />
        </div>
      )}
    </Async>
  );
}

function Status({ d }: { d: OwnerOfficialVideos }) {
  const [busy, setBusy] = useState(false);
  const last = d.runs[0];
  return (
    <Section title="Official videos" description={`Recordings and highlights from the organisers' own YouTube channels: ${d.recordings} day recordings for ${d.events} events. The watcher reads each watched channel's new uploads every ${d.everyHours} hours with the YouTube Data API (never a search) and adds a recording only when every check passes; the rest waits below.`} stackAction
      action={<Button variant="outline" disabled={busy || !d.apiKey} onClick={async () => { setBusy(true); await act("/run", { method: "POST" }, "Watcher ran."); setBusy(false); }}><RefreshCw className={busy ? "animate-spin" : ""} /> Run now</Button>}>
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-3"><dt className="text-muted-foreground">YouTube API key</dt><dd className="mt-1 font-medium">{d.apiKey ? "Set" : <span className="text-danger">Not set: the watcher can't run</span>}</dd></div>
        <div className="rounded-xl border border-border bg-card p-3"><dt className="text-muted-foreground">Last run</dt><dd className="mt-1 font-medium" data-last-run>{last ? `${ago(last.startedAt)}: ${last.seen} new, ${last.added} added, ${last.queued} to review` : "Not yet"}</dd>
          {last?.error && <dd className="mt-1 text-danger">{last.error}</dd>}</div>
        <div className="rounded-xl border border-border bg-card p-3"><dt className="text-muted-foreground">Quota used today</dt><dd className="mt-1 font-medium tabular-nums">{d.unitsToday} of 10,000 units</dd></div>
        <div className="rounded-xl border border-border bg-card p-3"><dt className="text-muted-foreground">Next run</dt><dd className="mt-1 font-medium">{d.apiKey ? (d.nextRunAt ? when(d.nextRunAt) : "Within 30 minutes") : "—"}</dd></div>
      </dl>
      {d.runs.length > 1 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Earlier runs</summary>
          <ul className="mt-2 grid gap-1">{d.runs.map((r) => <li key={r.id} className="tabular-nums">{when(r.startedAt)} · {r.units} units · {r.channels} channels · {r.seen} new · {r.added} added · {r.queued} to review{r.error ? <span className="text-danger"> · {r.error}</span> : null}</li>)}</ul>
        </details>
      )}
    </Section>
  );
}

function VideoHead({ w }: { w: OfficialWatchRow }) {
  return (
    <div className="flex min-w-0 gap-3">
      <a href={watchUrl(w.videoId)} target="_blank" rel="noreferrer noopener" className="relative hidden aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-black sm:block" aria-label={`Open ${w.title} on YouTube`}>
        <img src={thumbnailUrl(w.videoId)} alt="" loading="lazy" className="size-full object-cover" />
        <Play className="absolute inset-0 m-auto size-6 fill-white text-white" aria-hidden />
      </a>
      <div className="min-w-0">
        <a href={watchUrl(w.videoId)} target="_blank" rel="noreferrer noopener" className="inline-flex items-start gap-1 break-words font-medium text-foreground hover:underline [overflow-wrap:anywhere]">{w.title}<ExternalLink className="mt-1 size-3 shrink-0" aria-hidden /></a>
        <p className="text-xs text-muted-foreground">{w.channel} · {w.start ? `broadcast ${when(w.start)}` : `uploaded ${when(w.published)}`}{w.durationS ? ` · ${mins(w.durationS)}` : ""}</p>
        <p className="mt-1 text-sm">{w.why}</p>
      </div>
    </div>
  );
}

function Review({ w }: { w: OfficialWatchRow }) {
  const [season, setSeason] = useState(w.season ? String(w.season) : "");
  const [code, setCode] = useState(w.code ?? "");
  const [day, setDay] = useState(w.day ?? "");
  const [part, setPart] = useState(w.part ?? "");
  const [kind, setKind] = useState<"recording" | "highlight">(w.durationS != null && w.durationS < 45 * 60 ? "highlight" : "recording");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<boolean>) => { setBusy(true); await fn(); setBusy(false); };
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-3" data-review={w.videoId}>
      <VideoHead w={w} />
      <form className="mt-3 grid gap-2 sm:grid-cols-[5.5rem_minmax(0,9rem)_minmax(0,10rem)_minmax(0,1fr)] sm:items-end" noValidate
        onSubmit={(e) => { e.preventDefault(); void run(() => act(`/${w.videoId}/approve`, { method: "POST", json: { season: Number(season), code, day: kind === "recording" ? day : null, part: kind === "recording" ? part : null, kind } }, `Added to ${code.toUpperCase()}.`)); }}>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Season</span><Input inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Event code</span><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 40))} spellCheck={false} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">{kind === "recording" ? "Day (at the venue)" : "Kind"}</span>
          {kind === "recording" ? <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /> : <span className="flex h-9 items-center text-sm">Highlight</span>}</label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Part (optional)</span><Input value={part} disabled={kind === "highlight"} placeholder="Awards" onChange={(e) => setPart(e.target.value.slice(0, 60))} /></label>
        <span className="flex flex-wrap gap-2 sm:col-span-4">
          <span className="inline-flex h-9 items-center rounded-lg border border-border p-0.5 text-xs" role="group" aria-label="Add as">
            {(["recording", "highlight"] as const).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={kind === k ? "h-full rounded-md bg-accent px-2 text-accent-ink" : "h-full rounded-md px-2 text-muted-foreground"}>{k === "recording" ? "Recording" : "Highlight"}</button>)}
          </span>
          <Button type="submit" disabled={busy || !season || !code || (kind === "recording" && !day)}><Check /> Approve</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => act(`/${w.videoId}/reject`, { method: "POST", json: {} }, "Rejected."))}><X /> Reject</Button>
        </span>
      </form>
    </li>
  );
}

const STATUS: Record<string, { label: string; variant: "success" | "info" | "destructive" | "secondary" }> = {
  added: { label: "Added by the watcher", variant: "success" }, approved: { label: "Approved", variant: "info" }, rejected: { label: "Rejected", variant: "destructive" },
};

function Decided({ w }: { w: OfficialWatchRow }) {
  const s = STATUS[w.status] ?? { label: w.status, variant: "secondary" as const };
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2"><Badge variant={s.variant}>{s.label}</Badge>
          {w.code && w.season ? <Link to={`/events/${w.season}/${w.code}`} className="font-medium hover:underline">{w.season} {w.code}</Link> : null}
          {w.day ? <span className="text-muted-foreground">{w.day}{w.part ? ` · ${w.part}` : ""}</span> : null}</p>
        <a href={watchUrl(w.videoId)} target="_blank" rel="noreferrer noopener" className="mt-1 block truncate text-foreground hover:underline">{w.title}</a>
        <p className="text-xs text-muted-foreground">{w.channel} · {ago(w.decidedAt ?? w.seenAt)}{w.decidedBy && w.decidedBy !== "watcher" ? ` by ${w.decidedBy}` : ""}</p>
      </div>
      {(w.status === "added" || w.status === "approved") && (
        <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); await act(`/${w.videoId}/remove`, { method: "POST" }, "Removed from its event."); setBusy(false); }}><Trash2 /> Remove</Button>
      )}
    </li>
  );
}

function Channels({ channels }: { channels: OfficialChannelRow[] }) {
  const [form, setForm] = useState({ channelId: "", title: "", region: "", words: "", titlePattern: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Section title={`Watched channels (${channels.length})`} collapsible summary="The official channels the watcher reads, each with the events it can be matched to."
      description="Only these channels are read. Region: which events a channel's video can be (country=Romania · state=VA,MD,DC · type=Premier,OffSeason · name=<pattern>, joined with ;). Edit one by saving it again with the same id.">
      <form className="mb-4 grid gap-2 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[14rem_minmax(0,1fr)_minmax(0,1fr)_10rem_10rem_auto] lg:items-end" noValidate
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); if (await act("/channels", { method: "PUT", json: form }, "Channel saved.")) setForm({ channelId: "", title: "", region: "", words: "", titlePattern: "" }); setBusy(false); }}>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Channel id (UC…)</span><Input value={form.channelId} onChange={set("channelId")} spellCheck={false} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Name</span><Input value={form.title} onChange={set("title")} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Region</span><Input value={form.region} placeholder="state=TX" onChange={set("region")} spellCheck={false} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Region words</span><Input value={form.words} placeholder="texas" onChange={set("words")} /></label>
        <label className="grid gap-1 text-xs"><span className="text-muted-foreground">Title pattern</span><Input value={form.titlePattern} placeholder="texas" onChange={set("titlePattern")} spellCheck={false} /></label>
        <Button type="submit" disabled={busy || !form.channelId || !form.region}>Save channel</Button>
      </form>
      <ul className="grid gap-2">
        {channels.map((c) => (
          <li key={c.channelId} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm">
            <div className="min-w-0">
              <a href={`https://www.youtube.com/channel/${c.channelId}`} target="_blank" rel="noreferrer noopener" className="font-medium hover:underline">{c.title}</a>
              <p className="font-mono text-xs text-muted-foreground">{c.region}{c.words ? ` · words: ${c.words}` : ""}{c.titlePattern ? ` · title: ${c.titlePattern}` : ""}</p>
              <p className="text-xs text-muted-foreground">Watched from {when(c.watchFrom)} · {c.checkedAt ? `read ${ago(c.checkedAt)}` : "not read yet"}</p>
              {c.lastError && <p className="text-xs text-danger">{c.lastError}</p>}
            </div>
            <span className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setForm({ channelId: c.channelId, title: c.title, region: c.region, words: c.words ?? "", titlePattern: c.titlePattern ?? "" })}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => void act(`/channels/${c.channelId}`, { method: "DELETE" }, `Stopped watching ${c.title}.`)}><Trash2 /> Remove</Button>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
