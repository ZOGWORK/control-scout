// The owner console's Data & sync section: when each season last synced from FIRST, the data-quality
// checks (for triage: nothing here edits match data, the fix for wrong FTC data is a re-sync), and the
// re-sync and cache jobs behind a confirmation (OpsCards). Read from /api/owner/data.
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BarChart3, CheckCircle2, CloudDownload, PackageOpen, Radio, RefreshCw, XCircle } from "lucide-react";
import { Section } from "../page";
import { StatTile } from "../StatTile";
import { Async } from "../states";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { ago, int } from "../../lib/format";
import type { DataFlag, OwnerDataReport, SeasonSync } from "../../shared/ownerData";
import { OpsCards } from "./OpsCards";

const DATA = "/api/owner/data";
const since = (iso: string | null | undefined) => (iso ? ago(iso) : "Never");
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

export function DataPanel() {
  const state = useApi<OwnerDataReport>(DATA);
  const [checking, setChecking] = useState(false);
  const checkAgain = async () => {
    setChecking(true);
    try { prime(DATA, await apiFetch<OwnerDataReport>(`${DATA}?fresh=1`)); }
    catch (e) { toast.error((e as ApiError).message); }
    finally { setChecking(false); }
  };
  // A re-sync that finishes changes every number here.
  const onDone = useCallback(() => markStale(DATA), []);
  return (
    <>
      <Async state={state}>
        {(d) => (
          <>
            <Section title="Sync status" description="Results come from the FIRST Events API on a schedule (often on event days); stats, ratings and live results are rebuilt after each sync.">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile tone="accent" icon={CloudDownload} label="Last sync" value={since(d.timestamps.syncAt)} hint={when(d.timestamps.syncAt)} />
                <StatTile tone="sky" icon={BarChart3} label="Stats rebuilt" value={since(d.timestamps.statsAt)} hint={when(d.timestamps.statsAt)} />
                <StatTile tone="emerald" icon={Radio} label="Live results" value={since(d.timestamps.recordsAt)} hint={when(d.timestamps.recordsAt)} />
                <StatTile tone="violet" icon={PackageOpen} label="Packs built" value={since(d.timestamps.packsAt)} hint={when(d.timestamps.packsAt)} />
              </div>
              <SeasonTable seasons={d.seasons} />
            </Section>
            <Section stackAction title="Data-quality flags" description="Checks over the stored data, for triage. Nothing on this screen changes match data: wrong FTC results are fixed at the source and come in with a re-sync."
              action={<Button variant="secondary" size="sm" onClick={() => void checkAgain()} disabled={checking}><RefreshCw className={cn(checking && "animate-spin")} /> {checking ? "Checking…" : "Check again"}</Button>}>
              <p className="mb-3 text-xs text-muted-foreground">Checked {ago(d.computedAt)} ({when(d.computedAt)}).</p>
              <ul className="grid items-start gap-3 lg:grid-cols-2">
                {d.flags.map((f) => <FlagCard key={f.id} f={f} />)}
              </ul>
            </Section>
          </>
        )}
      </Async>
      <OpsCards ops={["resync", "caches"]} onDone={onDone} />
    </>
  );
}

function SeasonStatus({ s }: { s: SeasonSync }) {
  if (s.current) return <Badge variant="soft">Current</Badge>;
  if (s.frozen) return <Badge variant="secondary">Frozen</Badge>;
  return <Badge variant="info">Open</Badge>;
}

function SeasonTable({ seasons }: { seasons: SeasonSync[] }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Season</TableHead>
            <TableHead>Last sync</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right max-sm:hidden">Matches</TableHead>
            <TableHead className="max-sm:hidden">Last run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {seasons.map((s) => {
            const failed = s.lastRun?.failed ?? 0;
            return (
              <TableRow key={s.season}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium tabular-nums text-foreground">{s.label}</span>
                    <SeasonStatus s={s} />
                  </div>
                  <span className="text-xs text-muted-foreground">{s.game}</span>
                </TableCell>
                <TableCell>
                  <span className="text-foreground">{since(s.lastSync)}</span>
                  {s.lastSync && s.lastComplete !== s.lastSync && (
                    <span className="block text-xs text-warning">{s.lastComplete ? `Last complete ${ago(s.lastComplete)}` : "Never complete"}</span>
                  )}
                  {s.teamsAt && <span className="block text-xs text-muted-foreground">Teams read {ago(s.teamsAt)}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {int(s.eventsDetailed)}<span className="text-muted-foreground"> / {int(s.events)}</span>
                  <span className="block text-xs text-muted-foreground">with results</span>
                  {s.fallbackEvents > 0 && <span className="block text-xs text-muted-foreground">{int(s.fallbackEvents)} via fallback</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums max-sm:hidden">{int(s.matchesPlayed)}</TableCell>
                <TableCell className="max-sm:hidden">
                  {s.lastRun ? (
                    <span className="text-xs text-muted-foreground">
                      {int(s.lastRun.detailed)} fetched
                      {failed > 0 && <Badge variant="destructive" className="ml-1.5">{int(failed)} failed</Badge>}
                    </span>
                  ) : <span className="text-xs text-muted-foreground">{s.frozen ? "Skipped (frozen)" : "—"}</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function FlagCard({ f }: { f: DataFlag }) {
  const tone = f.error ? "danger" : f.count ? "warning" : "success";
  const Icon = f.error ? XCircle : f.count ? AlertTriangle : CheckCircle2;
  return (
    <li className={cn("min-w-0 rounded-xl border p-4",
      tone === "danger" ? "border-danger/40 bg-danger/[0.05]" : tone === "warning" ? "border-warning/40 bg-warning/[0.06]" : "border-success/30 bg-success/[0.05]")}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-5 shrink-0", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success")} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            {f.title}
            <Badge variant={f.error ? "destructive" : f.count ? "secondary" : "success"} className="tabular-nums">{f.error ? "Check failed" : f.count ? int(f.count) : "None"}</Badge>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
          {f.error && <p className="mt-2 break-words text-xs text-danger">{f.error}</p>}
          {f.examples.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3" aria-label={`${f.title}: first ${f.examples.length}`}>
              {f.examples.map((x, i) => (
                <li key={i} className="min-w-0 text-sm">
                  {x.href ? <Link to={x.href} className="break-words font-medium text-foreground underline-offset-2 hover:underline">{x.label}</Link>
                    : <span className="break-all font-medium text-foreground">{x.label}</span>}
                  {x.detail && <span className="block break-words text-xs text-muted-foreground">{x.detail}</span>}
                </li>
              ))}
              {f.count > f.examples.length && <li className="text-xs text-muted-foreground">and {int(f.count - f.examples.length)} more</li>}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
