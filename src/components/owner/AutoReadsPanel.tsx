// Owner console › Clip coverage › Waiting for approval (server/videos/autoReads.ts): what the clip autopilot read that
// broke one of the rules against the row the site serves now. Everything else it reads goes live on its own, with no
// PR; these wait here. One card per read: the event, its video (opening just before the first change), what it changes
// (matches added, moved, pulled, as chips that play that second), the rules it broke in plain words, and Approve (live
// as read) or Reject (dropped; the event can be read again).
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Play, X } from "lucide-react";
import { useState } from "react";
import { Section } from "../page";
import { Async } from "../states";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { playInDialog } from "../../lib/streamSeek";
import { ago } from "../../lib/format";
import { watchUrl } from "../../shared/recording";
import { thumbnailUrl } from "../../shared/stream";
import type { AutoReadChange, OwnerAutoReads, PendingAutoRead } from "../../shared/api";
import { SEARCH_PALETTE } from "../../lib/textTones";
import { hms } from "./clipReview";
import { cn } from "../cn";

export const AUTO_READS_PATH = "/api/owner/auto-reads";
const P = SEARCH_PALETTE;
const TOUCH = "pointer-coarse:min-h-[44px]";
const n = (x: number) => x.toLocaleString();
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const readKey = (p: PendingAutoRead) => `${p.kind}/${p.videoId}/${p.code}`;

/** Each kind of change: its chip colour and a word for it. */
const CHANGE: Record<AutoReadChange["what"], { name: string; swatch: (typeof P)[keyof typeof P] }> = {
  added: { name: "added", swatch: P.yes },
  moved: { name: "moved", swatch: P.upcoming },
  pulled: { name: "pulled", swatch: P.pen },
  confirmed: { name: "confirmed", swatch: P.yes },
  restored: { name: "back", swatch: P.winning },
  unconfirmed: { name: "unconfirmed", swatch: P.finished },
  dropped: { name: "dropped", swatch: P.pen },
};

/** Open a video in the app's dialog at a second (a new tab when the dialog isn't mounted). */
function watch(videoId: string, t: number | null, label: string) {
  if (!playInDialog({ videoId, t: t ?? 0, label })) window.open(watchUrl(videoId, t ?? undefined), "_blank", "noopener,noreferrer");
}

export function AutoReadsPanel() {
  const state = useApi<OwnerAutoReads>(AUTO_READS_PATH);
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (p: PendingAutoRead, how: "approve" | "reject") => {
    setBusy(readKey(p));
    try {
      const r = await apiFetch<OwnerAutoReads>(`${AUTO_READS_PATH}/${how}`, { method: "POST", json: { kind: p.kind, videoId: p.videoId, code: p.code, pendingAt: p.pendingAt } });
      prime(AUTO_READS_PATH, r);
      // The clips it put live (or didn't) show in the coverage lists and the menu's counts.
      markStale("/api/owner/clip-coverage");
      toast.success(how === "approve" ? `${p.code}: live as read` : `${p.code}: read dropped`);
    } catch (err) {
      toast.error((err as ApiError).message);
      markStale(AUTO_READS_PATH);
    }
    setBusy(null);
  };
  return (
    <Async state={state}>
      {(d) => (
        <Section
          title={`Waiting for approval (${n(d.total)})`}
          description="The clip autopilot's reads go live on their own. These broke a rule against what's live now, so they wait for you: Approve puts one live as read, Reject drops it and the event can be read again."
          className="scroll-mt-4"
          id="auto-reads"
        >
          <div className="grid gap-3" data-auto-reads>
            <LastDelivery d={d} />
            {d.pending.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {d.pending.map((p) => <ReadCard key={readKey(p)} p={p} busy={busy === readKey(p)} onDecide={decide} />)}
              </ul>
            ) : <p className="text-sm text-text-muted" data-auto-reads-empty>Nothing waiting: every read so far kept the rules and went live.</p>}
            {d.total > d.pending.length && <p className="text-sm text-text-muted">Showing the newest {n(d.pending.length)} of {n(d.total)}.</p>}
          </div>
        </Section>
      )}
    </Async>
  );
}

function LastDelivery({ d }: { d: OwnerAutoReads }) {
  const l = d.lastDelivery;
  if (!l) return <p className="text-sm text-text-muted">The autopilot hasn't handed the site a read yet.</p>;
  const host = l.source?.split(" ")[0];
  return (
    <p className="text-sm text-text-muted" data-auto-reads-last>
      Last read handed over {ago(l.at)}{host ? ` from ${host}` : ""}: <span className="font-medium text-text-base">{plural(l.live, "row")} live</span>
      {l.pending ? `, ${plural(l.pending, "row")} waiting` : ""}{l.dropped ? `, ${plural(l.dropped, "failed read")} dropped` : ""}.
    </p>
  );
}

function ReadCard({ p, busy, onDecide }: { p: PendingAutoRead; busy: boolean; onDecide: (p: PendingAutoRead, how: "approve" | "reject") => void }) {
  const title = `${p.season} ${p.code}`;
  const counts = p.kind === "frames"
    ? `${plural(p.before, "clip")} live, ${n(p.after)} after`
    : `${plural(p.before, "clip")} confirmed now, ${n(p.after)} after`;
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-card p-3" data-auto-read={readKey(p)}>
      <div className="flex gap-3">
        <button type="button" onClick={() => watch(p.videoId, p.at, `${title} · the read waiting for approval`)}
          className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-muted sm:w-32" aria-label={`Play ${title}'s video${p.at != null ? ` at ${hms(p.at)}` : ""}`}>
          <img src={thumbnailUrl(p.videoId)} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          <span className="absolute inset-0 grid place-items-center"><span className="grid size-8 place-items-center rounded-full bg-black/60 text-white"><Play className="size-4 fill-current" aria-hidden /></span></span>
        </button>
        <div className="grid min-w-0 flex-1 content-start gap-1">
          <Link to={`/events/${p.season}/${encodeURIComponent(p.code)}`} className="truncate text-sm font-medium hover:underline">{p.eventName || p.code}</Link>
          <span className="text-xs text-text-muted">{p.season} · {p.code} · {p.kind === "frames" ? "frame read" : "first-frame check"} of {p.checked}</span>
          <span className="text-xs text-text-muted">
            <a href={watchUrl(p.videoId, p.at ?? undefined)} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">{p.videoId}</a>
            {" · "}{counts}{p.liveFrom === null ? " · new" : ""} · came in {ago(p.pendingAt)}
          </span>
        </div>
      </div>
      {p.changes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-auto-read-changes>
          {p.changes.slice(0, 30).map((c) => <ChangeChip key={`${c.what}/${c.label}`} c={c} videoId={p.videoId} title={title} />)}
          {p.changes.length > 30 && <span className="inline-flex min-h-8 items-center px-1 text-xs text-text-muted">+{n(p.changes.length - 30)} more</span>}
        </div>
      )}
      <ul className="grid gap-1 rounded-lg bg-warning/10 p-2.5 text-sm" data-auto-read-problems>
        {p.problems.map((x) => (
          <li key={x} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span className="min-w-0 break-words">{x}</span></li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className={TOUCH} disabled={busy} onClick={() => onDecide(p, "approve")} data-auto-read-approve><Check /> Approve</Button>
        <Button size="sm" variant="outline" className={TOUCH} disabled={busy} onClick={() => onDecide(p, "reject")} data-auto-read-reject><X /> Reject</Button>
      </div>
    </li>
  );
}

function ChangeChip({ c, videoId, title }: { c: AutoReadChange; videoId: string; title: string }) {
  const K = CHANGE[c.what];
  const t = c.to ?? c.from;
  const where = c.what === "moved" && c.from != null && c.to != null ? `${hms(c.from)} → ${hms(c.to)}` : t != null ? hms(t) : null;
  const tip = `${c.label} ${K.name}${where ? ` · ${where}` : ""}${c.showed ? ` · its first frame shows ${c.showed}` : ""}`;
  const cls = cn("inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold tabular-nums", TOUCH, K.swatch.fill);
  if (t == null) return <span className={cls} title={tip} data-change={c.what}>{c.label} {K.name}</span>;
  return (
    <button type="button" className={cn(cls, "transition-transform hover:brightness-110 active:scale-95 motion-reduce:transform-none")} title={tip} aria-label={tip}
      onClick={() => watch(videoId, Math.max(0, t - 5), `${title} ${c.label} · ${K.name}`)} data-change={c.what}>
      <Play className="size-3 fill-current" aria-hidden />{c.label} {K.name}
    </button>
  );
}
