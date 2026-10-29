// The owner's data jobs (server/portal/ops.ts) as cards: re-sync now, rebuild offline packs, clear caches.
// Each asks in a dialog before it starts (the server refuses a start without {confirm:true} too), runs in
// the background, and shows its progress on its card. Data & sync shows re-sync and caches; Packs & offline
// shows the rebuild. None of them deletes anything a device saved.
import { useEffect, useState } from "react";
import { PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import type { OpName, OpsStatus } from "../../shared/owner";

export const OPS: { op: OpName; title: string; icon: typeof RefreshCw; does: string; confirm: string; tone: string }[] = [
  { op: "resync", title: "Re-sync now", icon: RefreshCw, tone: "bg-accent/15 text-accent-text",
    does: "Fetches the current season from FIRST, then rebuilds stats, ratings and the prediction ledger. Takes a few minutes.",
    confirm: "Live results for events on today wait until it finishes. The scheduled sync won't start while it runs. Match data only ever changes to what FIRST publishes." },
  { op: "packs", title: "Rebuild offline packs", icon: PackageOpen, tone: "bg-info/15 text-info",
    does: "Builds fresh offline packs from the current data. Devices pick them up on their next visit.",
    confirm: "Building packs takes a few minutes, and live results for today's events pause until it's done. Packs already saved on devices stay until each device updates them." },
  { op: "caches", title: "Clear caches", icon: Trash2, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    does: "Empties the server's in-memory caches (ratings, track record, forecasts, search, weather, flags) and rebuilds the costly ones.",
    confirm: "Pages may be slower for a minute while ratings rebuild. Nothing stored is touched." },
];

/** The cards for `ops`, in a section, with the writer's state and one confirmation dialog. `onDone`: a job finished. */
export function OpsCards({ ops, title = "Data jobs", description, onDone }: { ops: OpName[]; title?: string; description?: string; onDone?: (op: OpName) => void }) {
  const state = useApi<OpsStatus>("/api/owner/ops");
  const [asking, setAsking] = useState<OpName | null>(null);
  const [sending, setSending] = useState(false);
  const running = !!state.data && ops.some((op) => state.data!.jobs[op]?.state === "running");
  // While a job runs, check on it every 2 seconds.
  const { reload } = state;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(reload, 2000);
    return () => window.clearInterval(t);
  }, [running, reload]);
  // A job that was running here and has now ended: the reports it changed load again.
  const [watching, setWatching] = useState<OpName[]>([]);
  useEffect(() => {
    if (!state.data) return;
    const ended = watching.filter((op) => state.data!.jobs[op]?.state !== "running");
    if (!ended.length) return;
    setWatching((w) => w.filter((op) => !ended.includes(op)));
    for (const op of ended) onDone?.(op);
  }, [state.data, watching, onDone]);
  const start = async (op: OpName) => {
    setSending(true);
    try {
      const r = await apiFetch<{ status: OpsStatus }>(`/api/owner/ops/${op}`, { method: "POST", json: { confirm: true } });
      prime("/api/owner/ops", r.status);
      markStale("/api/owner/audit");
      setWatching((w) => [...w, op]);
      toast.success("Started. Progress shows on its card.");
      setAsking(null);
    } catch (e) {
      toast.error((e as ApiError).message);
      reload();
    } finally { setSending(false); }
  };
  const shown = OPS.filter((o) => ops.includes(o.op));
  const chosen = shown.find((o) => o.op === asking);
  return (
    <Section title={title} description={description ?? "Each runs in the background and never alongside a scheduled sync or the live results lane: if one of those is busy, the job says so instead of starting."}>
      <Async state={state}>
        {(s) => (
          <>
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", s.writer || s.cycle ? "bg-warning" : "bg-success")} aria-hidden />
              {s.cycle ? `A data update (${s.cycle.reason}) is running on this server.` : s.writer ? `The data writer is busy: ${s.writer.what}.` : "The data writer is free."}
            </p>
            <div className={cn("grid gap-3", shown.length > 1 && "lg:grid-cols-2", shown.length > 2 && "lg:grid-cols-3")}>
              {shown.map((o) => {
                const job = s.jobs[o.op];
                const off = s.unavailable[o.op];
                return (
                  <div key={o.op} className="flex flex-col rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2.5">
                      <span className={cn("grid size-8 place-items-center rounded-lg", o.tone)}><o.icon className="size-4" aria-hidden /></span>
                      <h3 className="font-medium text-foreground">{o.title}</h3>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{o.does}</p>
                    {job && (
                      <div role="status" className={cn("mt-3 rounded-lg border px-3 py-2 text-xs",
                        job.state === "running" ? "border-info/40 bg-info/[0.06]" : job.state === "done" ? "border-success/40 bg-success/[0.06]" : "border-danger/40 bg-danger/[0.06]")}>
                        <p className="font-medium text-foreground">
                          {job.state === "running" ? `Running since ${ago(job.startedAt)}` : job.state === "done" ? `Finished ${ago(job.finishedAt)}` : `Failed ${ago(job.finishedAt)}`}
                        </p>
                        {job.message && <p className="mt-0.5 break-words text-muted-foreground">{job.message}</p>}
                      </div>
                    )}
                    {off && <p className="mt-3 text-xs text-muted-foreground">{off}</p>}
                    <div className="mt-auto pt-4">
                      <Button variant="secondary" className="w-full" disabled={!!off || job?.state === "running"} onClick={() => setAsking(o.op)}>
                        <o.icon /> {job?.state === "running" ? "Running…" : o.title}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Async>
      <Dialog open={!!chosen} onOpenChange={(v) => { if (!v && !sending) setAsking(null); }}>
        <DialogContent>
          {chosen && (
            <>
              <DialogHeader>
                <DialogTitle>{chosen.title}?</DialogTitle>
                <DialogDescription>{chosen.does} {chosen.confirm}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsking(null)} disabled={sending}>Cancel</Button>
                <Button onClick={() => void start(chosen.op)} disabled={sending}><chosen.icon /> {sending ? "Starting…" : `Yes, ${chosen.title.toLowerCase()}`}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
