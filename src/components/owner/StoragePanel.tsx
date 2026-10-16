// The owner portal's photo storage panel (docs/r2-photos.md): R2 usage against the 10 GB free tier,
// per event, the guardrails (notice at 7 GB, warning and an owner alert at 9 GB, uploads refused at
// the soft cap), a manual per-event purge with confirmation, and the nightly cleanup on demand.
// Both actions are audited on the server.
import { useState } from "react";
import { AlertTriangle, Brush, CalendarClock, HardDrive, ImageOff, Images, Info, Trash2 } from "lucide-react";
import { Section, EmptyState } from "../page";
import { StatTile, Meter } from "../StatTile";
import { Async } from "../states";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import { ago, int } from "../../lib/format";
import type { OwnerStorage } from "../../shared/photos";

const gb = (b: number) => `${(b / 1e9).toFixed(b >= 1e10 ? 1 : 2)} GB`;
const mb = (b: number) => (b >= 1e9 ? gb(b) : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
/** A UTC day: expiry times are midnights UTC (the nightly job runs after 08:00 UTC). */
const day = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" }));

/** The prominent banner over every owner panel at 9 GB and beyond (and at the cap). */
export function StorageBanner({ onOpen }: { onOpen: () => void }) {
  const { data } = useApi<OwnerStorage>("/api/owner/storage");
  if (!data || (data.level !== "warning" && data.level !== "full")) return null;
  return <StorageWarning s={data} onOpen={onOpen} />;
}

function StorageWarning({ s, onOpen }: { s: OwnerStorage; onOpen?: () => void }) {
  const full = s.level === "full";
  return (
    <div role="alert" className={cn("mb-5 flex flex-wrap items-start gap-3 rounded-xl border p-4", full ? "border-danger/50 bg-danger/[0.08]" : "border-warning/50 bg-warning/[0.10]")}>
      <AlertTriangle className={cn("mt-0.5 size-5 shrink-0", full ? "text-danger" : "text-warning")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{full ? "Photo storage is full: new uploads are refused" : "Photo storage approaching the 10 GB free tier limit"}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {gb(s.usedBytes)} of 10 GB used. {full ? "Members see \"Photo storage is full\" until space is freed." : `Purge an event or uploads will pause at ${gb(s.softCapBytes)}.`}
        </p>
      </div>
      {onOpen && <Button variant="secondary" size="sm" onClick={onOpen}>Open storage</Button>}
    </div>
  );
}

export function StoragePanel() {
  const state = useApi<OwnerStorage>("/api/owner/storage");
  const [purging, setPurging] = useState<OwnerStorage["events"][number] | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [busy, setBusy] = useState(false);
  const act = async (path: string, json: Record<string, unknown>, done: (r: any) => string) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ storage: OwnerStorage }>(path, { method: "POST", json: { ...json, confirm: true } });
      prime("/api/owner/storage", r.storage);
      toast.success(done(r));
      setPurging(null); setCleaning(false);
    } catch (e) { toast.error((e as ApiError).message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Async state={state}>
        {(s) => (
          <>
            {(s.level === "warning" || s.level === "full") && <StorageWarning s={s} />}
            {s.level === "notice" && (
              <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-info/40 bg-info/[0.06] p-4">
                <Info className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
                <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Over 7 GB of photos stored.</span> Nothing to do yet: photos clear themselves 2 days after each event. The warning comes at 9 GB.</p>
              </div>
            )}
            {!s.configured && (
              <div role="status" className="mb-5 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                R2 isn't configured on this server, so photos are off and hidden everywhere. Setup: docs/r2-photos.md.
              </div>
            )}
            <Section title="Photo storage" description="Entry photos in Cloudflare R2. The free tier is 10 GB; new uploads stop at the soft cap, so storage never grows into paid usage."
              action={s.configured ? <Button variant="secondary" size="sm" onClick={() => setCleaning(true)}><Brush /> Run cleanup now</Button> : undefined}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile tone={s.level === "ok" ? "emerald" : s.level === "notice" ? "sky" : "amber"} icon={HardDrive} label="Used" value={s.usedBytes < 1e8 ? mb(s.usedBytes) : gb(s.usedBytes)}
                  hint={`of 10 GB · uploads stop at ${gb(s.softCapBytes)}`}
                  bar={<Meter parts={[{ pc: Math.min(100, (s.usedBytes / s.limitBytes) * 100), cls: s.level === "ok" ? "bg-success" : s.level === "notice" ? "bg-info" : s.level === "warning" ? "bg-warning" : "bg-danger" }]} />} />
                <StatTile tone="accent" icon={Images} label="Photos" value={int(s.photos)} hint={s.enabled ? "Stored, plus uploads in progress" : "The photos switch is off"} />
                <StatTile tone="violet" icon={CalendarClock} label="Events" value={int(s.events.length)} hint="With photos stored" />
                <StatTile tone="sky" icon={Brush} label="Last cleanup" value={s.lastRun ? ago(s.lastRun.at) : "—"}
                  hint={s.lastRun ? `${int(s.lastRun.expired)} expired · bucket ${s.lastRun.bucketBytes == null ? "not listed" : mb(s.lastRun.bucketBytes)}${s.lastRun.failures ? ` · ${s.lastRun.failures} failures` : ""}` : "Runs nightly after 08:00 UTC"} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Notice at 7 GB · warning and an owner alert at 9 GB · new uploads refused at {gb(s.softCapBytes)} (R2_SOFT_CAP_GB).</p>
            </Section>
            <Section title="By event" description="Photos are deleted 2 days after their event ends (14 days after upload when the end date isn't known). Entries and their text always stay.">
              {!s.events.length ? <EmptyState icon={ImageOff} title="No photos stored" description="Photos members add to workspace entries show up here by event." /> : (
                <div className="rounded-xl border border-border bg-card">
                  <Table>
                    <TableHeader><TableRow><TableHead>Event</TableHead><TableHead className="text-right">Photos</TableHead><TableHead className="text-right">Size</TableHead><TableHead>Event ends</TableHead><TableHead>Deleted from</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {s.events.map((e) => (
                        <TableRow key={`${e.season}:${e.eventCode}`}>
                          <TableCell className="min-w-[10rem]">
                            <span className="font-mono">{e.eventCode || "No event"}</span> <Badge variant="secondary">{e.season}</Badge>
                            {e.eventName && <span className="block truncate text-xs text-muted-foreground">{e.eventName}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{int(e.photos)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">{mb(e.bytes)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{e.eventEnd ?? "Unknown"}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{day(e.expiresAt)}</TableCell>
                          <TableCell className="text-right"><Button variant="outline" size="sm" onClick={() => setPurging(e)}><Trash2 /> Purge</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Section>
          </>
        )}
      </Async>
      <Dialog open={!!purging} onOpenChange={(v) => { if (!v && !busy) setPurging(null); }}>
        <DialogContent>
          {purging && (
            <>
              <DialogHeader>
                <DialogTitle>Purge {purging.eventCode || "photos with no event"} ({purging.season})?</DialogTitle>
                <DialogDescription>
                  Deletes {int(purging.photos)} photo{purging.photos === 1 ? "" : "s"} ({mb(purging.bytes)}) from storage for every workspace. Their entries and notes stay and show "photo expired". This can't be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPurging(null)} disabled={busy}>Cancel</Button>
                <Button variant="destructive" disabled={busy}
                  onClick={() => void act("/api/owner/storage/purge", { season: purging.season, eventCode: purging.eventCode }, (r) => `Purged ${r.purged.photos} photo${r.purged.photos === 1 ? "" : "s"}`)}>
                  <Trash2 /> {busy ? "Purging…" : "Yes, purge"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={cleaning} onOpenChange={(v) => { if (!v && !busy) setCleaning(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run the photo cleanup now?</DialogTitle>
            <DialogDescription>The nightly job, now: deletes photos whose event ended more than 2 days ago, unfinished uploads and untracked objects, then totals the bucket.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCleaning(false)} disabled={busy}>Cancel</Button>
            <Button disabled={busy} onClick={() => void act("/api/owner/storage/maintenance", {}, (r) => `Cleanup done: ${r.result?.expired ?? 0} expired`)}><Brush /> {busy ? "Running…" : "Yes, run it"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
