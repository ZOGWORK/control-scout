// "Scouting commons" on the team page (docs/scouting-commons.md): pit scouting other workspaces shared at events where
// the commons is open, as a separate, labelled layer under the reader's own workspace's take (which comes first).
// Signed-in accounts only; nothing at all when no open event has anything on the team (and nothing is muted).
// Each entry can be reported to Control Scout, and its workspace muted for this account only (unmuted from the
// list under the entries).
import { useId, useState } from "react";
import { Camera, Clock, Cog, EyeOff, Flag, Globe2, MoreHorizontal, Users } from "lucide-react";
import { Section } from "./page";
import { Badge, Label, Textarea } from "./ui/basic";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/overlay";
import { toast } from "./ui/sonner";
import { StatTile } from "./StatTile";
import { cn } from "./cn";
import { commonsPhotoUrl, pitAge, reportEntry, setMute, useCommons, type PitAgeTone } from "../lib/commons";
import type { ApiError } from "../lib/api";
import { int } from "../lib/format";
import { REPORT_NOTE_MAX, REPORT_REASONS, REPORT_REASON_LABEL, type CommonsAnswer, type CommonsEntry, type CommonsReportReason } from "../shared/commons";
import type { ConsensusNumber } from "../shared/consensus";

const avg = (x: ConsensusNumber) => (Number.isInteger(x.avg) ? String(x.avg) : x.avg.toFixed(1));

const AGE_STYLE: Record<PitAgeTone, string> = {
  fresh: "border-success/40 bg-success/10 text-success",
  aging: "border-warning/50 bg-warning/15 text-warning",
  stale: "border-danger/40 bg-danger/10 text-danger",
};

/** The pit claim's age, big and coloured: the first thing read on each entry. */
export function PitAgeBadge({ entry, events, now }: { entry: CommonsEntry; events: CommonsAnswer["events"]; now?: number }) {
  const a = pitAge(entry.scoutedAt, events.find((e) => e.code === entry.eventCode), now);
  return (
    <div className={cn("inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1 text-sm", AGE_STYLE[a.tone])} data-testid="pit-age" data-tone={a.tone}>
      <Clock className="size-4 shrink-0" aria-hidden />
      <span><span className="font-semibold">Scouted {a.when}</span><span className="opacity-90"> · {a.note}</span></span>
    </div>
  );
}

function answerText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null; // unanswered; 0 and "no" are answers
  return v === true ? "yes" : v === false ? "no" : String(v);
}

/** Report one entry: a reason and an optional note. Reporters stay anonymous; the owner reviews the queue. */
function ReportDialog({ entry, open, onOpenChange }: { entry: CommonsEntry; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState<CommonsReportReason>("wrong");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const send = async () => {
    setBusy(true);
    try {
      const r = await reportEntry(entry.id, reason, note);
      toast.success(r.already ? "You've already reported this entry. It's in the queue." : "Reported. Thanks: Control Scout will take a look.");
      onOpenChange(false);
      setNote("");
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report {entry.source.name}'s pit entry</DialogTitle>
          <DialogDescription>Control Scout reviews every report and can take an entry down. {entry.source.name} isn't told who reported it.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">What's wrong?</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
              <input type="radio" name={`${id}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[var(--accent)]" />
              {REPORT_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div>
          <Label htmlFor={`${id}-note`}>Anything to add? (optional)</Label>
          <Textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={REPORT_NOTE_MAX} placeholder="e.g. They swapped to a tank drive on Saturday morning." className="mt-2" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { void send(); }} disabled={busy}><Flag /> Send report</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CommonsCard({ entry, events, onMute }: { entry: CommonsEntry; events: CommonsAnswer["events"]; onMute: () => void }) {
  const [reporting, setReporting] = useState(false);
  const ev = events.find((e) => e.code === entry.eventCode);
  const answers = entry.fields.map((f) => ({ f, v: answerText(entry.data[f.id]) })).filter((x) => x.v != null);
  return (
    <li className="min-w-0 rounded-xl border border-border border-l-4 border-l-info bg-card p-4" data-testid="commons-entry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium"><Users className="size-4 shrink-0 text-info" aria-hidden />{entry.source.name}</p>
          <p className="text-xs text-muted-foreground">Pit scouting at {ev?.name ?? entry.eventCode}</p>
        </div>
        <div className="flex items-start gap-1">
          <PitAgeBadge entry={entry} events={events} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More about ${entry.source.name}'s entry`} className="max-sm:size-10"><MoreHorizontal /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setReporting(true)}><Flag /> Report this entry</DropdownMenuItem>
              <DropdownMenuItem onSelect={onMute}><EyeOff /> Mute {entry.source.name}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ReportDialog entry={entry} open={reporting} onOpenChange={setReporting} />
      {answers.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-1.5">
          {answers.map(({ f, v }) => (
            <div key={f.id} className="inline-flex items-baseline gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs">
              <dt className="text-muted-foreground">{f.label}</dt><dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.notes && <p className="mt-2 whitespace-pre-line text-sm">{entry.notes}</p>}
      {entry.photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Photos">
          {entry.photos.map((p) => p.expired ? (
            <li key={p.id} className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border text-center text-[11px] text-muted-foreground"><span><Camera className="mx-auto mb-1 size-4" aria-hidden />Photo expired</span></li>
          ) : (
            <li key={p.id}><PitPhoto id={p.id} alt={`${entry.source.name}'s pit photo of ${entry.team}`} /></li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The team page's block, under the reader's own workspace's take. */
export function CommonsSection({ team, season }: { team: number; season: number }) {
  const c = useCommons(team, season);
  const d = c?.data;
  if (!c || !d || (!d.entries.length && !d.muted.length)) return null; // signed out, failed, loading, or nothing shared: say nothing
  const mute = async (id: number, name: string, muted: boolean) => {
    try {
      await setMute(id, muted);
      toast.success(muted ? `${name} muted: their shares are hidden for you. Unmute below.` : `${name} unmuted.`);
      c.reload();
    } catch (e) { toast.error((e as ApiError).message); }
  };
  const l = d.layer;
  const workspaces = l.scouts;
  return (
    <Section title={<span className="inline-flex items-center gap-2">Scouting commons <Badge variant="info"><Globe2 /> Shared by other teams</Badge></span>}
      description={<>Pit scouting other workspaces chose to share at {d.events.length === 1 ? d.events[0].name : "events where the commons is open"}. A separate layer: your own workspace's scouting comes first{d.ownHidden ? `, and your workspace's ${d.ownHidden === 1 ? "share is" : `${d.ownHidden} shares are`} left out here` : ""}. Check the time on each claim: robots change between days.</>}>
      <div className="space-y-4" data-testid="commons">
        {d.entries.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile tone="sky" icon={Globe2} label="Shared entries" value={int(l.entries)} hint={`from ${int(workspaces)} ${workspaces === 1 ? "workspace" : "workspaces"}`} />
          {l.counters.slice(0, 3).map((x) => (
            <StatTile key={x.id} tone="emerald" icon={Cog} label={x.label} value={avg(x)} hint={`average of ${int(x.n)}`} />
          ))}
          {l.ratings.slice(0, 3).map((r) => (
            <StatTile key={r.id} tone="violet" icon={Cog} label={r.label} value={<>{avg(r)}<span className="text-base font-normal text-muted-foreground"> / {r.max}</span></>} hint={`average of ${int(r.n)}`} />
          ))}
        </div>}
        {l.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Most reported">
            {l.tags.map((t) => (
              <li key={t.label} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-info/30 bg-info/[0.08] px-2.5 py-1 text-xs">
                <span className="break-words">{t.label}</span><span className="font-mono tabular-nums text-muted-foreground" aria-label={`${t.count} ${t.count === 1 ? "entry" : "entries"}`}>×{t.count}</span>
              </li>
            ))}
          </ul>
        )}
        {d.entries.length > 0
          ? <ul className="grid gap-3 lg:grid-cols-2">{d.entries.map((e) => <CommonsCard key={e.id} entry={e} events={d.events} onMute={() => { void mute(e.source.id, e.source.name, true); }} />)}</ul>
          : <p className="rounded-xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">Everything shared on {team} comes from workspaces you muted.</p>}
        {d.muted.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-label="Muted workspaces">
            <EyeOff className="size-4" aria-hidden /> Muted by you:
            {d.muted.map((m) => <Button key={m.id} variant="outline" size="sm" onClick={() => { void mute(m.id, m.name, false); }} aria-label={`Unmute ${m.name}`}>{m.name} · Unmute</Button>)}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Each entry is credited to the workspace that shared it. Averages count each workspace as one scout. Match scouting is never shared. Something wrong? Report it from the entry's menu.</p>
      </div>
    </Section>
  );
}

/** A pit photo, or the same small placeholder as an expired one when it doesn't load (never a broken-image icon). */
function PitPhoto({ id, alt }: { id: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border text-center text-[11px] text-muted-foreground" role="img" aria-label={`${alt}: not available`} data-photo-failed><span aria-hidden><Camera className="mx-auto mb-1 size-4" />Photo not available</span></span>;
  return <a href={commonsPhotoUrl(id)} target="_blank" rel="noreferrer"><img src={commonsPhotoUrl(id)} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-20 rounded-lg border border-border object-cover" /></a>;
}
