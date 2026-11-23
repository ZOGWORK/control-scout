// Owner console › Analytics (owner only): page views and sessions from visitors who opted into usage
// statistics (page views first: the owner reads this tab for traffic, not prediction counts), and the choice
// to publish the home page's "in use" section (server/ownerSettings.ts; confirmed, and audited with the old
// and new value). Aggregates only: no accounts, emails or addresses.
import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Eye, Globe, MousePointerClick } from "lucide-react";
import { Section } from "../page";
import { StatTile } from "../StatTile";
import { Async } from "../states";
import { Button } from "../ui/button";
import { Switch } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago, int } from "../../lib/format";
import type { OwnerAnalytics, PublishUsageSetting } from "../../shared/owner";
import { PublicUsagePanel } from "../home/HomeSections";

/** Page views per day: one bar a day, zero-based, the day's number on hover and in the label read aloud. Sessions are in
 *  each bar's tooltip, not drawn: the chart answers one question, how many pages were viewed. */
function DailyViews({ daily }: { daily: OwnerAnalytics["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.pageViews));
  const every = Math.max(1, Math.ceil(daily.length / 5));
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <p className="mb-2 text-xs text-muted-foreground tabular-nums">Busiest day {int(max)} views</p>
      <div className="flex h-40 items-end gap-1" role="img"
        aria-label={`Page views per day: ${daily.map((d) => `${d.day} ${d.pageViews}`).join("; ")}`}>
        {daily.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 items-end" title={`${d.day}: ${int(d.pageViews)} page views · ${int(d.sessions)} sessions`}>
            <span className="block w-full rounded-t-[3px] bg-accent" style={{ height: `${(d.pageViews / max) * 100}%`, minHeight: d.pageViews ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] text-muted-foreground" aria-hidden>
        {daily.map((d, i) => <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % every === 0 ? d.day.slice(5) : ""}</span>)}
      </div>
    </div>
  );
}

/** A short ranked list with each row's share drawn as a zero-based bar behind it (largest = full width). */
function Ranked({ title, rows, unit, empty }: { title: string; rows: { key: string; label: string; value: number; href?: string }[]; unit: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground">{title}</h3>
      {rows.length ? (
        <ol className="space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="relative flex items-center justify-between gap-3 overflow-hidden rounded-md px-2 py-1 text-sm">
              <span className="absolute inset-y-0 left-0 rounded-md bg-accent/15" style={{ width: `${(r.value / max) * 100}%` }} aria-hidden />
              {r.href
                ? <Link to={r.href} className="relative min-w-0 truncate font-mono text-xs text-foreground hover:underline" title={r.label}>{r.label}</Link>
                : <span className="relative min-w-0 truncate text-foreground" title={r.label}>{r.label}</span>}
              <span className="relative shrink-0 tabular-nums text-muted-foreground">{int(r.value)} <span className="sr-only">{unit}</span></span>
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted-foreground">{empty}</p>}
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
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text v8:text-accent"><Globe className="size-4" aria-hidden /></span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="font-medium text-foreground" id="publish-usage-label">Publish the "in use" section on the homepage</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Page views and sessions started per day for 30 days, nothing else. {s.source === "owner"
            ? `Chosen here ${ago(s.updatedAt)}.`
            : `Not chosen here yet: following the server setting (${s.envDefault ? "on" : "off"}).`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-sm font-medium", s.enabled ? "text-success v8:text-emerald-400" : "text-muted-foreground")}>{s.enabled ? "Published" : "Hidden"}</span>
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
            <Section title="Page views" description="Counted only from visitors who said yes to usage statistics.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile tone="accent" icon={Eye} label="Page views" value={int(a.totals.pageViews)} hint={`${int(a.totals.pageViews / Math.max(1, a.days))} a day on average`} />
                <StatTile tone="sky" icon={MousePointerClick} label="Sessions" value={int(a.totals.sessions)} hint="Visits started" />
                <StatTile className="col-span-2 sm:col-span-1" tone="emerald" icon={CalendarDays} label="Today" value={int(a.daily.at(-1)?.pageViews ?? 0)} hint="page views so far (UTC)" />
              </div>
              <div className="mt-4"><DailyViews daily={a.daily} /></div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Ranked title="Most viewed pages" rows={a.topPages.map((r) => ({ key: r.path, label: r.path, value: r.views, href: r.path }))} unit="views" empty="No page views in this period." />
                <Ranked title="Where visits came from" rows={a.referrers.map((r) => ({ key: r.host, label: r.host, value: r.sessions }))} unit="visits" empty="No visits came from another site in this period." />
              </div>
            </Section>
            <Section title="Home page">
              <PublishUsage s={a.publishUsage} />
              {/* "Control Scout, in use": the classic home page's section as visitors would see it, published or not.
                  Folded: it repeats the page views above, and only matters when deciding to publish it. Its own
                  container, as on the home page (its tiles lay out by width). */}
              <details className="group mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Preview what visitors would see</summary>
                <div data-owner-in-use className="@container/home mt-3 [&>section]:border-t-0 [&>section]:pt-0"><PublicUsagePanel path="/api/owner/public-usage" /></div>
              </details>
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
