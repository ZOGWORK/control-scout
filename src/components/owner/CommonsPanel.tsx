// Owner console › Moderation › Scouting commons (docs/scouting-commons.md): open the commons one event at a time,
// work through readers' reports (take an entry down, or dismiss), restore what was taken down, and suspend a
// workspace from the commons. Every action is in the audit log. The whole commons also has a feature toggle
// (Features › Scouting commons) above all of this.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Flag, Globe2, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { EmptyState, Section } from "../page";
import { Async } from "../states";
import { Badge, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { Switch } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { agoShort, dateRange } from "../../lib/format";
import { REPORT_REASON_LABEL, type CommonsModeration, type CommonsRemoved, type CommonsReportGroup, type CommonsWorkspaceRow } from "../../shared/commons";

const EVENTS = "/api/owner/commons/events";
const REPORTS = "/api/owner/commons/reports";
const WORKSPACES = "/api/owner/commons/workspaces";

/**
 * After an action, everything it can change is read again: the other lists' counts and the console's badges
 * (the overview). `keep`: the answer the action already returned, primed after the rest is marked stale.
 */
function afterAction(keep: string, value: unknown) {
  markStale("/api/owner/commons/");
  markStale("/api/owner/overview");
  prime(keep, value);
}

const answerText = (v: unknown) => (v === undefined || v === null || v === "" ? null : v === true ? "yes" : v === false ? "no" : String(v));

/** What was reported: its answers, notes and photos, as the entry is now (whatever readers see). */
function ReportedEntry({ g }: { g: CommonsReportGroup }) {
  const answers = g.fields.map((f) => ({ f, v: answerText(g.data[f.id]) })).filter((x) => x.v != null);
  return (
    <div className="mt-2 space-y-2">
      {answers.length > 0 && (
        <dl className="flex flex-wrap gap-1.5">
          {answers.map(({ f, v }) => <div key={f.id} className="inline-flex items-baseline gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs"><dt className="text-muted-foreground">{f.label}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
      )}
      {g.notes && <p className="line-clamp-4 whitespace-pre-line rounded-lg bg-muted/50 px-3 py-2 text-sm">{g.notes}</p>}
      {g.photos.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Photos">
          {g.photos.map((p) => p.expired
            ? <li key={p.id} className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground">Expired</li>
            : <li key={p.id}><a href={`/api/owner/commons/photos/${encodeURIComponent(p.id)}`} target="_blank" rel="noreferrer"><img src={`/api/owner/commons/photos/${encodeURIComponent(p.id)}`} alt={`Photo on ${g.source.name}'s reported entry`} loading="lazy" className="size-16 rounded-lg border border-border object-cover" /></a></li>)}
        </ul>
      )}
    </div>
  );
}

interface EventSwitch { season: number; code: string; name: string; start: string | null; end: string | null; enabled: boolean; updatedAt: string; updatedBy: string; shared: number }

/** What an action that needs a reason is waiting on: the question, and what to do with the reason given. */
interface Pending { title: string; description: string; confirm: string; run: (reason: string) => void }

/** Asks for a short reason (shown to the workspace and kept in the audit log) before a takedown or a suspension. */
function ReasonDialog({ pending, onClose }: { pending: Pending | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const id = useId();
  const close = () => { onClose(); setReason(""); };
  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{pending?.title}</DialogTitle><DialogDescription>{pending?.description}</DialogDescription></DialogHeader>
        <label htmlFor={id} className="text-sm font-medium">Reason <span className="font-normal text-muted-foreground">(shown to the workspace, kept in the audit log)</span></label>
        <Input id={id} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not scouting" />
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button variant="destructive" onClick={() => { pending?.run(reason.trim()); close(); }}>{pending?.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Events() {
  const state = useApi<{ events: EventSwitch[] }>(EVENTS);
  const current = useMeta()?.currentSeason ?? new Date().getFullYear();
  const [season, setSeason] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const set = async (s: number, c: string, enabled: boolean) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ events: EventSwitch[] }>(`${EVENTS}/${s}/${encodeURIComponent(c)}`, { method: "PUT", json: { enabled } });
      afterAction(EVENTS, r);
      toast.success(enabled ? `The commons is open at ${c}.` : `The commons is closed at ${c}. Shares are kept for if it opens again.`);
      if (enabled) setCode("");
    } catch (e) { setError((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Events</h3>
      <form className="mb-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[6rem_12rem_auto] sm:items-end" noValidate
        onSubmit={(e) => { e.preventDefault(); const c = code.trim().toUpperCase(); if (!c) { setError("Enter the event's code (it's in the event page's address)."); return; } void set(Number(season || current), c, true); }}>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Season</span>
          <Input inputMode="numeric" value={season} placeholder={String(current)} onChange={(e) => setSeason(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </label>
        <label className="grid gap-1 text-sm"><span className="text-muted-foreground">Event code</span>
          <Input value={code} placeholder="USCAFFQ1" onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 40))} autoCapitalize="characters" spellCheck={false} aria-describedby={`${id}-err`} />
        </label>
        <Button type="submit" disabled={busy}><Globe2 /> Open the commons here</Button>
        {error && <p id={`${id}-err`} role="alert" className="text-sm text-danger sm:col-span-3">{error}</p>}
      </form>
      <Async state={state} empty={(d) => !d.events.length && <EmptyState icon={Globe2} title="Not open at any event" description="Open it at one event above. Workspaces that joined can then share pit entries scouted there." />}>
        {({ events }) => (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>Dates</TableHead><TableHead>Shared now</TableHead><TableHead>Open</TableHead></TableRow></TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={`${e.season}:${e.code}`}>
                  <TableCell><Link to={`/events/${e.season}/${e.code}`} className="font-medium hover:underline">{e.name}</Link><span className="ml-2 font-mono text-xs text-muted-foreground">{e.code}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dateRange(e.start, e.end)}</TableCell>
                  <TableCell className="tabular-nums">{e.shared}</TableCell>
                  <TableCell><Switch checked={e.enabled} disabled={busy} onCheckedChange={(v) => { void set(e.season, e.code, v); }} aria-label={`Commons open at ${e.code}`} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Async>
    </div>
  );
}

function Reports() {
  const state = useApi<CommonsModeration>(REPORTS);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // Older takedowns loaded with "Show older" (the first page comes with the queue).
  const [older, setOlder] = useState<CommonsRemoved[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const loadOlder = async (last: CommonsRemoved) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ removed: CommonsRemoved[]; more: boolean }>(`/api/owner/commons/removed?before=${encodeURIComponent(last.removedAt)}&entryId=${encodeURIComponent(last.entryId)}`);
      setOlder((x) => [...x, ...r.removed]);
      setOlderMore(r.more);
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const act = async (path: string, init: { method: string; json: unknown }, done: string) => {
    setBusy(true);
    try { afterAction(REPORTS, await apiFetch<CommonsModeration>(path, init)); setOlder([]); toast.success(done); } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const takeDown = (entryId: string, name: string) => setPending({
    title: `Take down ${name}'s entry?`, description: "It's hidden at once, its open reports are closed, and the workspace can't share it again until you restore it.", confirm: "Take down",
    run: (reason) => { void act(`/api/owner/commons/entries/${encodeURIComponent(entryId)}`, { method: "PUT", json: { removed: true, reason } }, "Taken down."); },
  });

  return (
    <Async state={state}>
      {({ reports, removed: first, removedMore }) => {
        const removed = [...first, ...older];
        const more = olderMore ?? removedMore;
        return (
        <div className="space-y-6">
          <ReasonDialog pending={pending} onClose={() => setPending(null)} />
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">Reports {reports.length > 0 && <Badge variant="destructive">{reports.length}</Badge>}</h3>
            {!reports.length ? <EmptyState icon={ShieldCheck} title="No open reports" description="Readers report shared entries from the entry's menu on a team page. They show up here." /> : (
              <ul className="space-y-3">
                {reports.map((g) => (
                  <li key={g.entryId} className="rounded-xl border border-border border-l-4 border-l-danger bg-card p-4" data-testid="commons-report">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{g.source.name} · <Link to={`/teams/${g.team}?season=${g.season}`} className="font-mono hover:underline">{g.team}</Link> at <span className="font-mono">{g.eventCode}</span></p>
                        <p className="text-xs text-muted-foreground">{g.scoutedAt ? `Scouted ${agoShort(g.scoutedAt)}` : "Deleted since"}{g.status && g.status !== "published" ? ` · ${g.status}` : ""}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void act(`/api/owner/commons/entries/${encodeURIComponent(g.entryId)}/dismiss`, { method: "POST", json: {} }, "Reports dismissed."); }}>Dismiss</Button>
                        <Button variant="destructive" size="sm" disabled={busy} onClick={() => takeDown(g.entryId, g.source.name)}><Trash2 /> Take down</Button>
                      </div>
                    </div>
                    <ReportedEntry g={g} />
                    <ul className="mt-2 space-y-1 text-sm">
                      {g.reports.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-baseline gap-2"><Flag className="size-3.5 shrink-0 self-center text-danger" aria-hidden /><span className="font-medium">{REPORT_REASON_LABEL[r.reason]}</span>{r.note && <span className="text-muted-foreground">“{r.note}”</span>}<span className="text-xs text-muted-foreground">{agoShort(Date.parse(r.createdAt))}</span></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {removed.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Taken down</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Entry</TableHead><TableHead>Why</TableHead><TableHead>When</TableHead><TableHead className="w-0" /></TableRow></TableHeader>
                <TableBody>
                  {removed.map((x) => (
                    <TableRow key={x.entryId}>
                      <TableCell>{x.source.name} · <span className="font-mono">{x.team}</span> at <span className="font-mono text-xs">{x.eventCode}</span></TableCell>
                      <TableCell className="text-muted-foreground">{x.reason || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{agoShort(Date.parse(x.removedAt))}</TableCell>
                      <TableCell><Button variant="outline" size="sm" disabled={busy} onClick={() => { void act(`/api/owner/commons/entries/${encodeURIComponent(x.entryId)}`, { method: "PUT", json: { removed: false } }, "Restored: it's shared again."); }}><RotateCcw /> Restore</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {more && <Button variant="outline" size="sm" className="mt-3" disabled={busy} onClick={() => { void loadOlder(removed[removed.length - 1]); }}>Show older</Button>}
            </div>
          )}
        </div>
        );
      }}
    </Async>
  );
}

function Workspaces() {
  const state = useApi<{ workspaces: CommonsWorkspaceRow[] }>(WORKSPACES);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const set = async (w: CommonsWorkspaceRow, suspended: boolean, reason = "") => {
    setBusy(true);
    try {
      afterAction(WORKSPACES, await apiFetch<{ workspaces: CommonsWorkspaceRow[] }>(`${WORKSPACES}/${w.source.id}`, { method: "PUT", json: { suspended, reason } }));
      toast.success(suspended ? `${w.source.name} suspended.` : `${w.source.name} can share again.`);
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">Workspaces</h3>
      <ReasonDialog pending={pending} onClose={() => setPending(null)} />
      <Async state={state} empty={(d) => !d.workspaces.length && <EmptyState icon={Globe2} title="No workspace has joined yet" description="Workspace admins join in Settings › Workspace › Scouting commons." />}>
        {({ workspaces }) => (
          <Table>
            <TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Joined</TableHead><TableHead>Shared</TableHead><TableHead>Taken down</TableHead><TableHead className="w-0" /></TableRow></TableHeader>
            <TableBody>
              {workspaces.map((w) => (
                <TableRow key={w.source.id}>
                  <TableCell className="font-medium">{w.source.name}{w.suspended && <Badge variant="destructive" className="ml-2">Suspended</Badge>}</TableCell>
                  <TableCell>{w.optedIn ? "Yes" : "Left"}</TableCell>
                  <TableCell className="tabular-nums">{w.shared}</TableCell>
                  <TableCell className="tabular-nums">{w.removed}</TableCell>
                  <TableCell>{w.suspended
                    ? <Button variant="outline" size="sm" disabled={busy} onClick={() => { void set(w, false); }}>Lift suspension</Button>
                    : <Button variant="outline" size="sm" disabled={busy} onClick={() => setPending({
                      title: `Suspend ${w.source.name}?`, description: "Everything it shared is hidden from the scouting commons and it can't share more, until you lift it. Its own scouting is untouched.", confirm: "Suspend",
                      run: (reason) => { void set(w, true, reason); },
                    })}><Ban /> Suspend</Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Async>
    </div>
  );
}

export function CommonsPanel() {
  return (
    <Section title="Scouting commons" description="Pit scouting workspaces share with everyone at an event. It opens one event at a time, so what's shared stays reviewable. Readers' reports land here; taking an entry down or suspending a workspace hides it at once, and everything is in the audit log. The whole commons also has a switch under Features.">
      <div className="space-y-8">
        <Reports />
        <Events />
        <Workspaces />
      </div>
    </Section>
  );
}
