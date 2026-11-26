// Owner console › Creator videos (server/videos/creatorVideos.ts, server/videos/creatorOwnerRoutes.ts). The intake's
// state (API key, quota today, its last runs, Run now), the watched creator channels (FUN Robotics Network first) to
// add or deactivate, and every automatic team tag with the one action on it: Remove, for a wrong tag (remembered, so
// it never comes back). Tags go live as found: there is no queue here. Every action is audited on the server.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Plus, RefreshCw, Search, Tag, Trash2, Tv } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge, Input } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { seriesLabel } from "../../shared/creatorVideos";

const PATH = "/api/owner/creators";

interface Channel { channelId: string; handle: string | null; title: string; active: boolean; addedBy: string | null; addedAt: string; checkedAt: string | null; lastError: string | null; videos: number }
interface RunRow { id: number; startedAt: string; finishedAt: string | null; units: number; channels: number; seen: number; refreshed: number; dropped: number; tagged: number; error: string | null }
interface TagRow { videoId: string; title: string; series: string | null; program: string; season: number | null; publishedAt: string; team: number; teamName: string | null; rule: string }
export interface OwnerCreators {
  apiKey: boolean; everyHours: number; unitsToday: number;
  counts: { videos: number; tags: number; teams: number; removals: number };
  channels: Channel[]; runs: RunRow[]; tags: TagRow[];
}

/** How a tag was found, in words. */
const RULE_TEXT: Record<string, string> = {
  "title:cue": "Title: number with a cue",
  "title:bare-name": "Title: number beside its name",
  "title:name": "Title: whole team name",
  "description:cue": "Description: number with a cue",
  "description:bare-name": "Description: number beside its name",
};

async function act(path: string, json: unknown, done: string): Promise<OwnerCreators | null> {
  try {
    const r = await apiFetch<OwnerCreators>(`${PATH}${path}`, { method: "POST", json });
    toast.success(done);
    return r;
  } catch (e) {
    toast.error((e as ApiError).message);
    return null;
  }
}

export function CreatorVideosPanel() {
  const [filter, setFilter] = useState("");
  const [asked, setAsked] = useState("");
  const path = asked ? `${PATH}?${/^\d{1,5}$/.test(asked) ? `team=${asked}` : `q=${encodeURIComponent(asked)}`}` : PATH;
  const state = useApi<OwnerCreators>(path);
  const put = (r: OwnerCreators | null) => { if (r) { prime(path, r); void state.reload(); } };
  return (
    <Async state={state}>
      {(d) => (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-8" data-owner-creators>
          <Status d={d} onDone={put} />
          <Section title="Channels" description="Creator channels the intake reads, through each one's own uploads list and playlists (never a search). Deactivating stops reading new uploads; what's stored keeps being refreshed.">
            <ul className="grid gap-2">{d.channels.map((c) => <ChannelRow key={c.channelId} c={c} onDone={put} />)}</ul>
            <AddChannel onDone={put} />
          </Section>
          <Section title={<>Team tags <Badge variant="soft" className="ml-1 align-middle">{d.counts.tags}</Badge></>}
            description={`Found automatically in FTC videos' titles and descriptions and live at once: ${d.counts.teams} team${d.counts.teams === 1 ? "" : "s"}, ${d.counts.removals} removed by you. A title tag puts the video on the team's page (and Behind the Bot's badge). Remove a wrong one: it never comes back.`}>
            <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setAsked(filter.trim()); }}>
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Team number or words of the title" aria-label="Filter the tags" className="max-w-xs" />
              <Button type="submit" variant="outline" size="sm" className="max-sm:h-10"><Search /> Filter</Button>
              {asked && <Button type="button" variant="ghost" size="sm" className="max-sm:h-10" onClick={() => { setFilter(""); setAsked(""); }}>Clear</Button>}
            </form>
            {d.tags.length ? <ul className="grid gap-2">{d.tags.map((t) => <TagRowView key={`${t.videoId}-${t.team}`} t={t} onDone={put} />)}</ul>
              : <EmptyState icon={Tag} title={asked ? "No tags match" : "No tags yet"} description={asked ? "Try another team or other words." : "Tags show here after the intake's first run."} />}
          </Section>
        </div>
      )}
    </Async>
  );
}

function Status({ d, onDone }: { d: OwnerCreators; onDone: (r: OwnerCreators | null) => void }) {
  const [busy, setBusy] = useState(false);
  const last = d.runs[0];
  return (
    <Section title="Intake" description={`Every ${d.everyHours} hours: each channel's playlists and new uploads, the 30-day refresh (deleted and non-embeddable videos dropped), then every video's tags derived again.`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>{d.apiKey ? "YouTube API key set" : <span className="text-danger">YOUTUBE_API_KEY isn't set: nothing is read</span>}</span>
        <span>{d.counts.videos} videos stored</span>
        <span>{d.unitsToday} units today</span>
        <span>Last run {last ? `${ago(last.startedAt)}${last.error ? ` · ${last.error}` : ""}` : "never"}</span>
        <Button size="sm" variant="outline" disabled={busy || !d.apiKey} className="max-sm:h-10"
          onClick={async () => { setBusy(true); onDone(await act("/run", {}, "Intake run done")); setBusy(false); }}>
          <RefreshCw className={busy ? "animate-spin" : undefined} /> Run now
        </Button>
      </div>
      {d.runs.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {d.runs.slice(0, 5).map((r) => (
            <li key={r.id} className="tabular-nums">{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {r.units} units · {r.seen} new · {r.refreshed} refreshed · {r.dropped} dropped · {r.tagged} tags{r.error ? ` · ${r.error}` : ""}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ChannelRow({ c, onDone }: { c: Channel; onDone: (r: OwnerCreators | null) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm" data-creator-channel>
      <div className="min-w-0">
        <a href={`https://www.youtube.com/${c.handle ?? `channel/${c.channelId}`}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-medium hover:underline">{c.title} <ExternalLink className="size-3" aria-hidden /></a>
        {!c.active && <Badge variant="outline" className="ml-2">Deactivated</Badge>}
        <p className="text-xs text-muted-foreground">{c.handle ?? c.channelId} · {c.videos} videos · checked {c.checkedAt ? ago(c.checkedAt) : "never"}{c.lastError ? ` · ${c.lastError}` : ""}</p>
      </div>
      {c.active && (
        <Button size="sm" variant="ghost" disabled={busy} className="max-sm:h-10"
          onClick={async () => { setBusy(true); onDone(await act(`/channels/${c.channelId}/deactivate`, {}, `${c.title} deactivated`)); setBusy(false); }}>
          Deactivate
        </Button>
      )}
    </li>
  );
}

function AddChannel({ onDone }: { onDone: (r: OwnerCreators | null) => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await act("/channels", { channel: v }, "Channel added");
      if (r) setV("");
      onDone(r);
      setBusy(false);
    }}>
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="youtube.com/@channel, @handle or UC… id" aria-label="Channel to add" className="max-w-sm" />
      <Button type="submit" size="sm" disabled={busy || !v.trim()} className="max-sm:h-10"><Plus /> Add channel</Button>
    </form>
  );
}

function TagRowView({ t, onDone }: { t: TagRow; onDone: (r: OwnerCreators | null) => void }) {
  const [busy, setBusy] = useState(false);
  const series = seriesLabel(t.series);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3 text-sm" data-creator-tag>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/teams/${t.team}`} className="font-semibold tabular-nums hover:underline">{t.team}</Link>
          {t.teamName && <span className="text-muted-foreground">{t.teamName}</span>}
          {series && <Badge variant="soft">{series}</Badge>}
          <Badge variant="outline">{RULE_TEXT[t.rule] ?? t.rule}</Badge>
        </p>
        <a href={watchUrl(t.videoId, 0)} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Tv className="size-3 shrink-0" aria-hidden /><span className="truncate">{t.title}</span>
        </a>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} className="max-sm:h-10" aria-label={`Remove the tag ${t.team} from ${t.title}`}
        onClick={async () => { setBusy(true); onDone(await act("/tags/remove", { videoId: t.videoId, team: t.team }, `Tag ${t.team} removed`)); setBusy(false); }}>
        <Trash2 /> Remove
      </Button>
    </li>
  );
}
