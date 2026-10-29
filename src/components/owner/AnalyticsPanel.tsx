// Owner console › Analytics (owner only): page views and sessions from visitors who opted into usage
// statistics, prediction calls (requests to /api/predict/*), the prediction ledger's counts, and the choice
// to publish the home page's "in use" section (server/ownerSettings.ts; confirmed, and audited with the old
// and new value). Aggregates only: no accounts, emails or addresses.
import { useState } from "react";
import { BookCheck, Eye, Globe, MousePointerClick, ScrollText, Target } from "lucide-react";
import { Section } from "../page";
import { StatTile } from "../StatTile";
import { Async } from "../states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { Switch } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago, int } from "../../lib/format";
import type { OwnerAnalytics, PublishUsageSetting } from "../../shared/owner";

const SERIES: { key: "pageViews" | "sessions" | "predictionCalls"; label: string; cls: string }[] = [
  { key: "pageViews", label: "Page views", cls: "bg-accent" },
  { key: "sessions", label: "Sessions", cls: "bg-info" },
  { key: "predictionCalls", label: "Prediction calls", cls: "bg-violet-500" },
];

function DailyGroups({ daily }: { daily: OwnerAnalytics["daily"] }) {
  const max = Math.max(1, ...daily.flatMap((d) => [d.pageViews, d.sessions, d.predictionCalls]));
  const every = Math.max(1, Math.ceil(daily.length / 5));
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex h-36 items-end gap-1" role="img"
        aria-label={`Per day: ${daily.map((d) => `${d.day} ${d.pageViews} views, ${d.sessions} sessions, ${d.predictionCalls} prediction calls`).join("; ")}`}>
        {daily.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 items-end gap-px" title={`${d.day}: ${int(d.pageViews)} views · ${int(d.sessions)} sessions · ${int(d.predictionCalls)} prediction calls`}>
            {SERIES.map((s) => <span key={s.key} className={cn("block min-w-0 flex-1 rounded-t-[2px]", s.cls)} style={{ height: `${(d[s.key] / max) * 100}%`, minHeight: d[s.key] ? 2 : 0 }} />)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] text-muted-foreground" aria-hidden>
        {daily.map((d, i) => <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % every === 0 ? d.day.slice(5) : ""}</span>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-[3px]", s.cls)} aria-hidden />{s.label}</span>)}
      </div>
    </div>
  );
}

function PublishUsage({ s }: { s: PublishUsageSetting }) {
  const [asking, setAsking] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (enabled: boolean) => {
    setBusy(true);
    try {
      await apiFetch("/api/owner/settings/public-usage", { method: "PUT", json: { enabled, confirm: true } });
      markStale("/api/owner/analytics");
      // The home page's own copy, if it was loaded in this tab.
      markStale("/api/public-usage");
      toast.success(enabled ? "The home page now shows the \"in use\" section" : "The \"in use\" section is hidden");
      setAsking(null);
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"><Globe className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium text-foreground" id="publish-usage-label">Publish the "in use" section on the homepage</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Page views and sessions started per day for 30 days, nothing else. {s.source === "owner"
            ? `Chosen here ${ago(s.updatedAt)}.`
            : `Not chosen here yet: following the server setting (${s.envDefault ? "on" : "off"}).`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-sm font-medium", s.enabled ? "text-success" : "text-muted-foreground")}>{s.enabled ? "Published" : "Hidden"}</span>
        <Switch checked={s.enabled} aria-labelledby="publish-usage-label" disabled={busy} onCheckedChange={(v) => setAsking(v)} />
      </div>
      <Dialog open={asking != null} onOpenChange={(v) => { if (!v && !busy) setAsking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{asking ? "Publish the \"in use\" section?" : "Hide the \"in use\" section?"}</DialogTitle>
            <DialogDescription>
              {asking
                ? "Everyone visiting the home page will see how many page views and sessions Control Scout had each day for the last 30 days, counted from visitors who opted in. Nothing else is published."
                : "The home page stops showing page views and sessions within a minute. Nothing is deleted."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAsking(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => asking != null && void save(asking)}>{busy ? "Saving…" : asking ? "Yes, publish it" : "Yes, hide it"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AnalyticsPanel() {
  const [days, setDays] = useState(14);
  const state = useApi<OwnerAnalytics>(`/api/owner/analytics?days=${days}`);
  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-1" role="group" aria-label="Period">
        {[7, 14, 30].map((d) => (
          <Button key={d} size="sm" variant={d === days ? "default" : "outline"} aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</Button>
        ))}
      </div>
      <Async state={state}>
        {(a) => (
          <>
            <Section title="Visitors and predictions" description="Page views and sessions come only from visitors who said yes to usage statistics. Prediction calls are requests to the prediction API.">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile tone="accent" icon={Eye} label="Page views" value={int(a.totals.pageViews)} hint={`${int(a.totals.pageViews / Math.max(1, a.days))} a day on average`} />
                <StatTile tone="sky" icon={MousePointerClick} label="Sessions" value={int(a.totals.sessions)} hint="Visits started" />
                <StatTile tone="violet" icon={Target} label="Prediction calls" value={int(a.totals.predictionCalls)} hint={`${int(a.totals.predictionCalls / Math.max(1, a.days))} a day on average`} />
                <StatTile tone="emerald" icon={BookCheck} label="Live calls scored" value={int(a.ledger.liveScored)} hint={`of ${int(a.ledger.liveLogged)} logged before their match`} />
              </div>
              <div className="mt-4"><DailyGroups daily={a.daily} /></div>
            </Section>
            <Section title="Prediction ledger" description="Live calls are logged before the match and scored once it's played. The replay (backtest) is counted apart, never blended.">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-card">
                  <Table>
                    <TableHeader><TableRow><TableHead>Ledger</TableHead><TableHead className="text-right">All time</TableHead><TableHead className="text-right">{a.days} days</TableHead></TableRow></TableHeader>
                    <TableBody>
                      <TableRow><TableCell>Live calls logged</TableCell><TableCell className="text-right tabular-nums">{int(a.ledger.liveLogged)}</TableCell><TableCell className="text-right tabular-nums">{int(a.ledger.liveLoggedInPeriod)}</TableCell></TableRow>
                      <TableRow><TableCell>Live calls scored</TableCell><TableCell className="text-right tabular-nums">{int(a.ledger.liveScored)}</TableCell><TableCell className="text-right tabular-nums">{int(a.ledger.liveScoredInPeriod)}</TableCell></TableRow>
                      <TableRow><TableCell>Replay calls scored</TableCell><TableCell className="text-right tabular-nums">{int(a.ledger.backtestScored)}</TableCell><TableCell className="text-right text-muted-foreground">—</TableCell></TableRow>
                    </TableBody>
                  </Table>
                </div>
                <div className="rounded-xl border border-border bg-card">
                  <Table className="[&_td]:whitespace-nowrap">
                    <TableHeader><TableRow><TableHead><span className="inline-flex items-center gap-1.5"><ScrollText className="size-3.5" aria-hidden />Prediction route</span></TableHead><TableHead className="text-right">Calls</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {a.predictionRoutes.length ? a.predictionRoutes.map((r) => (
                        <TableRow key={r.route}><TableCell className="max-w-[14rem] truncate font-mono text-xs" title={r.route}>{r.route}</TableCell><TableCell className="text-right tabular-nums">{int(r.count)}</TableCell></TableRow>
                      )) : <TableRow><TableCell colSpan={2} className="text-muted-foreground">No prediction calls in this period.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </Section>
            <Section title="Home page">
              <PublishUsage s={a.publishUsage} />
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
