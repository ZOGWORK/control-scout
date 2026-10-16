// The owner portal (/owner): how Control Scout is doing and the switches to run it. Owner only:
// OwnerRoute draws it for the account /api/auth/me marks isOwner, and every /api/owner/* call is
// checked on the server (404 for anyone else). One panel at a time (?panel=…), each loading its
// own data when opened.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity, AlertTriangle, Archive, Bug, Building2, CheckCircle2, ClipboardList, Database, DatabaseZap, ExternalLink, Gauge, HardDriveDownload,
  Inbox, LayoutDashboard, Link2, Mail, PackageOpen, Radio, RefreshCw, RotateCcw, ScrollText, ServerCog, Target, Timer, ToggleRight, Trash2, Users,
} from "lucide-react";
import { PageHeader, Section, EmptyState } from "../components/page";
import { StatTile, Meter } from "../components/StatTile";
import { Async } from "../components/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/overlay";
import { toast } from "../components/ui/sonner";
import { cn } from "../components/cn";
import { apiFetch, ApiError, markStale, prime, useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import { ago, int, pct, seasonLabel } from "../lib/format";
import { fmtBytes } from "../lib/recordings";
import { refreshFlags } from "../lib/flags";
import { FLAG_INFO } from "../shared/flags";
import type {
  AuditEntry, FeedbackList, FeedbackMessage, FeedbackStatus, FlagRow, LedgerKind, OpName, OpsStatus, OwnerOverview, OwnerUsage, PredictionHealth, RouteStats,
} from "../shared/owner";
import type { Flag } from "../shared/flags";

const PANELS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "usage", label: "Usage", icon: Activity },
  { id: "predictions", label: "Predictions", icon: Target },
  { id: "flags", label: "Switches", icon: ToggleRight },
  { id: "feedback", label: "Feedback", icon: Inbox },
  { id: "errors", label: "Errors", icon: Bug },
  { id: "ops", label: "Data jobs", icon: DatabaseZap },
  { id: "audit", label: "Audit log", icon: ScrollText },
] as const;
type PanelId = (typeof PANELS)[number]["id"];

/** Chart colours, validated as a pair for each theme (gold, then blue). */
const CHART_VARS = "[--ow-a:#a16207] [--ow-b:#0284c7] dark:[--ow-a:#b88a00] dark:[--ow-b:#0284c7]";

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const ms = (x: number | null | undefined) => (x == null ? "—" : x < 10 ? `${x.toFixed(1)} ms` : x < 1000 ? `${Math.round(x)} ms` : `${(x / 1000).toFixed(1)} s`);
const bytes = (b: number | null | undefined) => (b == null ? "—" : fmtBytes(b));

export default function OwnerPage() {
  useTitle("Owner");
  const [sp, setSp] = useSearchParams();
  const panel = (PANELS.find((p) => p.id === sp.get("panel"))?.id ?? "overview") as PanelId;
  const go = (id: string) => setSp((p) => { const n = new URLSearchParams(p); if (id === "overview") n.delete("panel"); else n.set("panel", id); return n; }, { replace: true });
  return (
    <div className={CHART_VARS}>
      <PageHeader title="Owner" description="How Control Scout is doing, and the switches to run it. Only you can see this page." />
      <Tabs value={panel} onValueChange={go}>
        <TabsList aria-label="Owner panels">
          {PANELS.map((p) => <TabsTrigger key={p.id} value={p.id}><p.icon aria-hidden />{p.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview"><OverviewPanel onOpen={go} /></TabsContent>
        <TabsContent value="usage"><UsagePanel /></TabsContent>
        <TabsContent value="predictions"><PredictionsPanel /></TabsContent>
        <TabsContent value="flags"><FlagsPanel /></TabsContent>
        <TabsContent value="feedback"><FeedbackPanel /></TabsContent>
        <TabsContent value="errors"><ErrorsPanel /></TabsContent>
        <TabsContent value="ops"><OpsPanel /></TabsContent>
        <TabsContent value="audit"><AuditPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function TileGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return <div className={cn("grid grid-cols-2 gap-3", cols === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>{children}</div>;
}

/** A label / value list (two columns from sm up). */
function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 pb-2 last:border-0 sm:[&:nth-last-child(2)]:border-0">
          <dt className="shrink-0 text-sm text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right text-sm text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- Overview ---------------------------------------------------------------------------------

function OverviewPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const state = useApi<OwnerOverview>("/api/owner/overview");
  return (
    <Async state={state}>
      {(o) => (
        <>
          <Section title="People and data">
            <TileGrid cols={3}>
              <StatTile tone="accent" icon={Users} label="Accounts" value={int(o.accounts.total)} hint={`${int(o.accounts.active30d)} active in the last 30 days · ${int(o.accounts.new7d)} new this week`} />
              <StatTile tone="violet" icon={Link2} label="Linked to Control Point" value={int(o.controlPointLinked)}
                hint={o.accounts.total ? `${pct(o.controlPointLinked / o.accounts.total)} of accounts` : "No accounts yet"}
                bar={o.accounts.total ? <Meter parts={[{ pc: (o.controlPointLinked / o.accounts.total) * 100, cls: "bg-violet-500" }]} /> : undefined} />
              <StatTile tone="sky" icon={Building2} label="Workspaces" value={o.workspaces == null ? "—" : int(o.workspaces)}
                hint={o.workspaces == null ? "Counted once workspace scouting ships" : "Control Point workspaces that have used Scout"} />
              <StatTile tone="emerald" icon={ClipboardList} label="Scout entries" value={int(o.scoutEntries.personal + (o.scoutEntries.workspace ?? 0))}
                hint={`${int(o.scoutEntries.personal)} personal · ${o.scoutEntries.workspace == null ? "shared: —" : `${int(o.scoutEntries.workspace)} shared`}`} />
              <StatTile tone="amber" icon={Database} label="Database" value={bytes(o.storage.databaseBytes)} hint={o.storage.databaseLocal ? "Local file, write-ahead log included" : "Remote database (pages in use)"} />
              <StatTile tone="sky" icon={HardDriveDownload} label="Offline packs" value={bytes(o.storage.packsBytes)}
                hint={o.storage.packsBytes == null ? "None built on this server" : `${o.storage.packFiles} pack file${o.storage.packFiles === 1 ? "" : "s"}${o.health.packsAt ? ` · built ${ago(o.health.packsAt)}` : ""}`} />
            </TileGrid>
          </Section>
          <Section title="Waiting for you">
            <TileGrid cols={3}>
              <StatTile tone="accent" icon={Inbox} label="Open feedback" value={int(o.inbox.openFeedback)} hint="Messages from the contact form" onClick={() => onOpen("feedback")} ariaLabel={`Open feedback: ${o.inbox.openFeedback}. Show the inbox`} />
              <StatTile tone="amber" icon={Bug} label="Error reports" value={int(o.inbox.errorReports)} hint={o.inbox.unfiledErrors ? `${int(o.inbox.unfiledErrors)} not on GitHub yet` : "All filed on GitHub"} onClick={() => onOpen("errors")} ariaLabel={`Error reports: ${o.inbox.errorReports}. Show them`} />
              <StatTile tone="emerald" icon={ServerCog} label="Up for" value={uptime(o.health.uptimeSeconds)} hint={`Since ${when(o.health.startedAt)}`} />
            </TileGrid>
          </Section>
          <Section title="Server">
            <Facts rows={[
              ["Release", <span className="font-mono">{o.health.release ? o.health.release.slice(0, 12) : "development"}</span>],
              ["Prediction engine", <span className="font-mono">v{o.health.engineVersion}</span>],
              ["Data synced", ago(o.health.dataAsOf)],
              ["Stats rebuilt", ago(o.health.statsAt)],
              ["Packs built", o.health.packsAt ? ago(o.health.packsAt) : "—"],
              ["Data writer", o.health.writer ? <span className="text-warning">{o.health.writer.what}</span> : "Free"],
            ]} />
          </Section>
        </>
      )}
    </Async>
  );
}

function uptime(s: number): string {
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}

// --- Usage ------------------------------------------------------------------------------------

function UsagePanel() {
  const [days, setDays] = useState(14);
  const state = useApi<OwnerUsage>(`/api/owner/usage?days=${days}`);
  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-1" role="group" aria-label="Period">
        {[7, 14, 30].map((d) => (
          <Button key={d} size="sm" variant={d === days ? "default" : "outline"} aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</Button>
        ))}
      </div>
      <Async state={state}>
        {(u) => {
          const views = u.pageViews.reduce((s, d) => s + d.views, 0);
          return (
            <>
              <Section title="Traffic">
                <TileGrid>
                  <StatTile tone="accent" icon={Activity} label="API requests" value={int(u.totals.requests)} hint={`${int(u.totals.requests / Math.max(1, u.days))} a day on average`} />
                  <StatTile tone="sky" icon={RefreshCw} label="Sync requests" value={int(u.totals.sync)} hint="Personal data, scouting and offline packs" />
                  <StatTile tone={u.totals.errors ? "amber" : "emerald"} icon={AlertTriangle} label="Server errors" value={int(u.totals.errors)} hint={u.totals.requests ? `${pct(u.totals.errors / u.totals.requests, 2)} of requests` : "No requests yet"} />
                  <StatTile tone="violet" icon={Radio} label="Live connections" value={int(u.live.total)} hint={u.live.peak ? `Peak ${int(u.live.peak)} since this server started` : "Nothing streams yet"} />
                </TileGrid>
                <p className="mt-3 text-xs text-muted-foreground">{int(views)} page views in this period from visitors who opted into usage statistics. Health checks and this page's own requests aren't counted.</p>
              </Section>
              <Section title="Requests per day" description="Sync traffic and everything else, UTC days.">
                <DailyBars daily={u.daily} />
              </Section>
              <Section title="Slowest routes" description="By 95th percentile, routes with at least 5 requests in the period.">
                <RouteTable rows={u.slowest} empty="Not enough requests yet to rank routes by speed." />
              </Section>
              <Section title="Busiest routes">
                <RouteTable rows={u.busiest} empty="No API requests recorded in this period." />
              </Section>
            </>
          );
        }}
      </Async>
    </>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />{label}</span>)}
    </div>
  );
}

/** Stacked daily bars: sync (blue) under everything else (gold). Values are in the tooltip and in the table below. */
/** The element's width in CSS pixels: charts draw in real pixels, so their text stays the same size on a phone and a wide screen. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.clientWidth));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w || fallback] as const;
}

function DailyBars({ daily }: { daily: OwnerUsage["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, width] = useWidth(640);
  const max = Math.max(1, ...daily.map((d) => d.requests));
  const W = width, H = 200, L = 44, B = 176, T = 10;
  const bw = (W - L) / daily.length;
  const y = (v: number) => B - (v / max) * (B - T);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const every = Math.max(1, Math.ceil(daily.length / Math.max(3, Math.floor((W - L) / 64))));
  const h = hover != null ? daily[hover] : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Requests per day for the last ${daily.length} days, from ${int(daily[0]?.requests)} to ${int(daily.at(-1)?.requests)}.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{t >= 1000 ? `${(t / 1000).toFixed(t >= 10_000 ? 0 : 1)}k` : t}</text>
            </g>
          ))}
          {daily.map((d, i) => {
            const x = L + i * bw + 2, w = Math.max(2, bw - 4);
            const other = d.requests - d.sync;
            return (
              <g key={d.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => setHover(i)}>
                <rect x={L + i * bw} y={T} width={bw} height={B - T} fill="transparent" />
                {d.sync > 0 && <rect x={x} y={y(d.sync)} width={w} height={B - y(d.sync)} rx={Math.min(4, w / 2)} fill="var(--ow-b)" opacity={hover == null || hover === i ? 1 : 0.45} />}
                {other > 0 && <rect x={x} y={y(d.requests)} width={w} height={Math.max(0, y(d.sync) - y(d.requests) - (d.sync > 0 ? 2 : 0))} rx={Math.min(4, w / 2)} fill="var(--ow-a)" opacity={hover == null || hover === i ? 1 : 0.45} />}
                {i % every === 0 && <text x={L + i * bw + bw / 2} y={B + 16} textAnchor="middle" className="fill-muted-foreground text-[11px]">{d.day.slice(5)}</text>}
              </g>
            );
          })}
        </svg>
        {h && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
            <p className="font-medium text-foreground">{h.day}</p>
            <p className="text-muted-foreground">{int(h.requests)} requests · {int(h.sync)} sync · {int(h.errors)} errors</p>
          </div>
        )}
      </div>
      <Legend items={[["var(--ow-a)", "Other API requests"], ["var(--ow-b)", "Sync requests"]]} />
    </div>
  );
}

function RouteTable({ rows, empty }: { rows: RouteStats[]; empty: string }) {
  if (!rows.length) return <EmptyState icon={Timer} title={empty} />;
  return (
    <div className="rounded-xl border border-border bg-card">
      <Table className="[&_td]:whitespace-nowrap">
        <TableHeader><TableRow><TableHead>Route</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">Median</TableHead><TableHead className="text-right">95th %</TableHead><TableHead className="text-right">Slowest</TableHead><TableHead className="text-right">Errors</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.route}>
              <TableCell className="max-w-[16rem] truncate font-mono text-xs" title={r.route}>{r.route}</TableCell>
              <TableCell className="text-right tabular-nums">{int(r.count)}</TableCell>
              <TableCell className="text-right tabular-nums">{ms(r.p50Ms)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", (r.p95Ms ?? 0) > 300 && "text-warning")}>{ms(r.p95Ms)}</TableCell>
              <TableCell className="text-right tabular-nums">{ms(r.maxMs)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", r.errors > 0 && "text-danger")}>{int(r.errors)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Prediction health ------------------------------------------------------------------------

function PredictionsPanel() {
  // In the address (?kind=backtest&season=2025), so a view can be linked to and survives a reload.
  const [sp, setSp] = useSearchParams();
  const kind: LedgerKind = sp.get("kind") === "backtest" ? "backtest" : "live";
  const season = Number(sp.get("season")) || null;
  const pick = (k: LedgerKind, s: number | null) => setSp((p) => {
    const n = new URLSearchParams(p);
    if (k === "live") n.delete("kind"); else n.set("kind", k);
    if (s) n.set("season", String(s)); else n.delete("season");
    return n;
  }, { replace: true });
  const setKind = (k: LedgerKind) => pick(k, null);
  const setSeason = (s: number) => pick(kind, s);
  const state = useApi<PredictionHealth>(`/api/owner/predictions?kind=${kind}${season ? `&season=${season}` : ""}`);
  const seasons = useMemo(() => [...new Set((state.data?.available ?? []).filter((a) => a.kind === kind).map((a) => a.season))], [state.data, kind]);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Which calls">
          {(["live", "backtest"] as const).map((k) => (
            <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} aria-pressed={k === kind} onClick={() => setKind(k)}>
              {k === "live" ? "Live calls" : "Backtest"}
            </Button>
          ))}
        </div>
        {seasons.length > 1 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Season">
            {seasons.map((s) => (
              <Button key={s} size="sm" variant={s === state.data?.season ? "secondary" : "ghost"} aria-pressed={s === state.data?.season} onClick={() => setSeason(s)}>{seasonLabel(s)}</Button>
            ))}
          </div>
        )}
      </div>
      <Async state={state}>
        {(p) => !p.summary ? (
          <EmptyState icon={Target} title={kind === "live" ? "No live calls scored yet" : "No backtest on this server"}
            description={kind === "live" ? "Live calls are logged before each match and scored once it's played. They show here after the first event of the season." : "The stats job writes the backtest; it shows here after the next run."} />
        ) : (
          <>
            <Section title={`${kind === "live" ? "Live calls" : "Backtest"}, ${seasonLabel(p.season!)}`} description={kind === "live" ? "Logged before each match, scored once it was played." : "Walk-forward replay: each match predicted from the data before it. Never mixed with live calls."}>
              <TileGrid>
                <StatTile tone="accent" icon={Target} label="Scored calls" value={int(p.summary.n)} />
                <StatTile tone="emerald" icon={CheckCircle2} label="Called right" value={pct(p.summary.accuracy, 1)} hint="Favourite won, ties and coin flips left out" />
                <StatTile tone="sky" icon={Gauge} label="Brier score" value={p.summary.brier.toFixed(3)} hint={`Lower is better · always saying 50% scores ${p.summary.baselineBrier.toFixed(3)}`} />
                <StatTile tone={p.rolling?.drifting ? "amber" : "violet"} icon={Activity} label={`Last ${p.thresholds.rollingWindow} calls`}
                  value={p.rolling ? pct(p.rolling.accuracy, 1) : "—"}
                  hint={p.rolling ? `Brier ${p.rolling.brier.toFixed(3)} · ${p.rolling.drifting ? "drifting from the season" : "in line with the season"}` : "Not enough calls yet"} />
              </TileGrid>
            </Section>
            <div className="grid gap-x-6 lg:grid-cols-2">
              <Section title="Calibration" description="Calls grouped by red's win chance: how often red then won. On the line means the odds can be taken at face value.">
                <Reliability bins={p.reliability} />
              </Section>
              <Section title="Week by week" description="How sure the favourite was on average, against how often it won.">
                <Weekly weeks={p.weekly.filter((w) => w.n >= 10)} />
              </Section>
            </div>
            <Section title="Drift alerts" description={`A week is flagged when its Brier score is ${p.thresholds.brier.toFixed(2)} worse, or its accuracy ${Math.round(p.thresholds.accuracy * 100)} points lower, than the season before it (weeks with ${p.thresholds.minWeek}+ calls).`}>
              {p.alerts.length ? (
                <ul className="space-y-2">
                  {p.alerts.map((a) => (
                    <li key={a.week} className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/[0.06] p-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-foreground">Week of {a.week} <span className="font-normal text-muted-foreground">· {int(a.n)} calls</span></p>
                        <p className="text-muted-foreground">
                          {a.reasons.includes("accuracy") && <>Called right {pct(a.accuracy, 1)} against {pct(a.baselineAccuracy, 1)} before. </>}
                          {a.reasons.includes("brier") && <>Brier {a.brier.toFixed(3)} against {a.baselineBrier.toFixed(3)}.</>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState icon={CheckCircle2} title="No drift" description="Every week with enough calls stayed close to the season so far." />}
            </Section>
          </>
        )}
      </Async>
    </>
  );
}

function Reliability({ bins }: { bins: PredictionHealth["reliability"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, width] = useWidth(300);
  const shown = bins.filter((b) => b.n > 0);
  const S = Math.min(360, width), P = 36;
  const x = (p: number) => P + p * (S - P - 22), y = (p: number) => S - P - p * (S - P - 12);
  const maxN = Math.max(1, ...shown.map((b) => b.n));
  const h = hover != null ? shown[hover] : null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="relative mx-auto max-w-[360px]" ref={box}>
        <svg viewBox={`0 0 ${S} ${S}`} className="h-auto w-full" role="img" aria-label="Calibration: predicted chance of a red win against how often red won, per probability bin.">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} className="stroke-border" />
              <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} className="stroke-border" />
              <text x={x(t)} y={y(0) + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">{t * 100}%</text>
              <text x={x(0) - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{t * 100}%</text>
            </g>
          ))}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="stroke-muted-foreground" strokeDasharray="4 4" strokeWidth={1.5} />
          {shown.map((b, i) => (
            <circle key={b.lo} cx={x(b.predicted)} cy={y(b.actual)} r={5 + 5 * Math.sqrt(b.n / maxN)} fill="var(--ow-a)" className="stroke-card" strokeWidth={2}
              opacity={hover == null || hover === i ? 1 : 0.5} tabIndex={0} role="img" aria-label={`Predicted ${pct(b.predicted, 1)}, red won ${pct(b.actual, 1)}, ${b.n} calls`}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
          ))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute left-12 top-1 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
            <p className="font-medium text-foreground">Said {pct(h.predicted, 1)} · red won {pct(h.actual, 1)}</p>
            <p className="text-muted-foreground">{int(h.n)} calls</p>
          </div>
        )}
      </div>
      <p className="mt-1 text-center text-xs text-muted-foreground">Predicted red win chance → how often red won. Bigger dots hold more calls.</p>
    </div>
  );
}

function Weekly({ weeks }: { weeks: PredictionHealth["weekly"] }) {
  if (weeks.length < 2) return <EmptyState icon={Activity} title="Not enough weeks yet" description="Needs two weeks with at least 10 scored calls each." />;
  return <WeeklyChart weeks={weeks} />;
}

function WeeklyChart({ weeks }: { weeks: PredictionHealth["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, width] = useWidth(520);
  const W = width, H = 240, L = 40, R = W - 24, T = 12, B = 210;
  const vals = weeks.flatMap((w) => [w.expected, w.actual]);
  const lo = Math.min(0.5, Math.floor(Math.min(...vals) * 10) / 10), hi = 1;
  const x = (i: number) => L + (i / (weeks.length - 1)) * (R - L);
  const y = (v: number) => B - ((v - lo) / (hi - lo)) * (B - T);
  const line = (k: "expected" | "actual") => weeks.map((w, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(w[k]).toFixed(1)}`).join(" ");
  const every = Math.max(1, Math.ceil(weeks.length / Math.max(3, Math.floor((R - L) / 70))));
  const h = hover != null ? weeks[hover] : null;
  const ticks = Array.from({ length: Math.round((hi - lo) * 10) + 1 }, (_, i) => lo + i / 10).filter((_, i, a) => a.length <= 6 || i % 2 === 0);
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Week by week from ${weeks[0].week}: expected and actual share of favourites winning.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={R} y1={y(t)} y2={y(t)} className="stroke-border" />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">{Math.round(t * 100)}%</text>
            </g>
          ))}
          {h && <line x1={x(hover!)} x2={x(hover!)} y1={T} y2={B} className="stroke-muted-foreground" strokeDasharray="3 3" />}
          <path d={line("expected")} fill="none" stroke="var(--ow-b)" strokeWidth={2} strokeLinejoin="round" />
          <path d={line("actual")} fill="none" stroke="var(--ow-a)" strokeWidth={2} strokeLinejoin="round" />
          {weeks.map((w, i) => (
            <g key={w.week}>
              <circle cx={x(i)} cy={y(w.actual)} r={4} fill="var(--ow-a)" className="stroke-card" strokeWidth={2} />
              <rect x={x(i) - (R - L) / weeks.length / 2} y={T} width={(R - L) / weeks.length} height={B - T} fill="transparent"
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => setHover(i)} />
              {i % every === 0 && <text x={x(i)} y={B + 18} textAnchor="middle" className="fill-muted-foreground text-[11px]">{w.week.slice(5)}</text>}
            </g>
          ))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
            <p className="font-medium text-foreground">Week of {h.week} · {int(h.n)} calls</p>
            <p className="text-muted-foreground">Expected {pct(h.expected, 1)} · won {pct(h.actual, 1)} · Brier {h.brier.toFixed(3)}</p>
          </div>
        )}
      </div>
      <Legend items={[["var(--ow-a)", "Favourite won"], ["var(--ow-b)", "Expected (average favourite's chance)"]]} />
    </div>
  );
}

// --- Feature flags ----------------------------------------------------------------------------

function FlagsPanel() {
  const state = useApi<{ flags: FlagRow[] }>("/api/owner/flags");
  const [busy, setBusy] = useState<Flag | null>(null);
  const toggle = async (f: FlagRow, enabled: boolean) => {
    setBusy(f.name);
    try {
      const r = await apiFetch<{ flags: FlagRow[] }>(`/api/owner/flags/${f.name}`, { method: "PUT", json: { enabled } });
      prime("/api/owner/flags", r);
      void refreshFlags();
      toast.success(`${FLAG_INFO[f.name].label} ${enabled ? "on" : "off"}. It takes effect within a few seconds.`);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(null); }
  };
  return (
    <Section title="Switches" description="Turn a feature off without a deploy, and back on again. Every server picks a change up within a few seconds; open pages within a few minutes.">
      <Async state={state}>
        {({ flags }) => (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {flags.map((f) => {
              const info = FLAG_INFO[f.name];
              const id = `flag-${f.name}`;
              return (
                <li key={f.name} className="flex items-start gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      {info.label}
                      <Badge variant={f.enabled ? "success" : "destructive"}>{f.enabled ? "On" : "Off"}</Badge>
                    </label>
                    <p className="mt-1 text-sm text-muted-foreground">{f.enabled ? info.on : info.off}</p>
                    {info.pending && <p className="mt-1 text-xs text-muted-foreground/80">{info.pending}</p>}
                    <p className="mt-1 text-xs text-muted-foreground/80">{f.updatedAt ? `Changed ${ago(f.updatedAt)} by ${f.updatedBy}` : "Never changed: on by default"}</p>
                  </div>
                  <Switch id={id} className="mt-1" checked={f.enabled} disabled={busy === f.name} onCheckedChange={(v) => void toggle(f, v)} aria-label={`${info.label}: ${f.enabled ? "on" : "off"}`} />
                </li>
              );
            })}
          </ul>
        )}
      </Async>
    </Section>
  );
}

// --- Feedback inbox ---------------------------------------------------------------------------

const TOPIC: Record<string, string> = { bug: "Bug", data: "Wrong data", feature: "Idea", other: "Other" };

function FeedbackPanel() {
  const [status, setStatus] = useState<FeedbackStatus | "all">("open");
  const path = `/api/owner/feedback?status=${status}`;
  const state = useApi<FeedbackList>(path);
  const [busy, setBusy] = useState<number | null>(null);
  // Older pages ("Show older"), for the list they were loaded for; the first page is the cached one above.
  const [older, setOlder] = useState<{ status: FeedbackStatus | "all"; messages: FeedbackMessage[]; more: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const extra = older?.status === status ? older : null;
  const loadOlder = async (first: FeedbackList) => {
    const last = (extra?.messages.at(-1) ?? first.messages.at(-1))?.id;
    if (!last) return;
    setLoadingOlder(true);
    try {
      const page = await apiFetch<FeedbackList>(`${path}&before=${last}`);
      setOlder({ status, messages: [...(extra?.messages ?? []), ...page.messages], more: page.more });
    } catch (e) { toast.error((e as ApiError).message); } finally { setLoadingOlder(false); }
  };
  const move = async (m: FeedbackMessage, to: FeedbackStatus) => {
    setBusy(m.id);
    try {
      await apiFetch(`/api/owner/feedback/${m.id}`, { method: "PATCH", json: { status: to } });
      setOlder(null); // older pages may hold the moved message: they load again on request
      // Every list (and the overview's open count) is out of date now, not just this one.
      // Marked stale rather than dropped: what's on screen reloads in place, the rest when next shown.
      markStale("/api/owner/feedback");
      markStale("/api/owner/overview");
      toast.success(to === "open" ? "Moved back to open" : to === "resolved" ? "Marked resolved" : "Archived");
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(null); }
  };
  const counts = state.data?.counts;
  const tabs: [FeedbackStatus | "all", string][] = [["open", "Open"], ["resolved", "Resolved"], ["archived", "Archived"], ["all", "All"]];
  return (
    <Section title="Feedback inbox" description="Messages from the contact form. Resolving or archiving only files them away; nothing is deleted.">
      <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Show">
        {tabs.map(([k, label]) => (
          <Button key={k} size="sm" variant={k === status ? "default" : "outline"} aria-pressed={k === status} onClick={() => setStatus(k)}>
            {label}{counts && k !== "all" ? <span className="tabular-nums opacity-70">{counts[k]}</span> : null}
          </Button>
        ))}
      </div>
      <Async state={state} empty={(d) => !d.messages.length && <EmptyState icon={Inbox} title={status === "open" ? "Inbox zero" : "Nothing here"} description={status === "open" ? "Every message has been dealt with." : undefined} />}>
        {(d) => (
          <>
          <ul className="space-y-3">
            {[...d.messages, ...(extra?.messages ?? []).filter((m) => !d.messages.some((x) => x.id === m.id))].map((m) => (
              <li key={m.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant={m.topic === "bug" ? "destructive" : m.topic === "data" ? "soft" : m.topic === "feature" ? "beta" : "secondary"}>{TOPIC[m.topic] ?? m.topic}</Badge>
                  <span className="font-medium text-foreground">{m.name ?? "No name given"}</span>
                  <a className="inline-flex min-w-0 items-center gap-1 truncate text-accent-text underline-offset-4 hover:underline" href={`mailto:${m.email}`}><Mail className="size-3.5 shrink-0" aria-hidden />{m.email}</a>
                  <span className="ml-auto text-xs text-muted-foreground" title={when(m.createdAt)}>#{m.id} · {ago(m.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{m.message}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {m.status !== "resolved" && <Button size="sm" variant="secondary" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "resolved")}><CheckCircle2 /> Resolve</Button>}
                  {m.status !== "archived" && <Button size="sm" variant="outline" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "archived")}><Archive /> Archive</Button>}
                  {m.status !== "open" && <Button size="sm" variant="ghost" className="max-sm:h-10" disabled={busy === m.id} onClick={() => void move(m, "open")}><RotateCcw /> Reopen</Button>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {m.status !== "open" && m.statusAt ? `${m.status === "resolved" ? "Resolved" : "Archived"} ${ago(m.statusAt)}` : m.emailed ? "Also emailed to you" : "Stored here only"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {(extra ? extra.more : d.more) && (
            <div className="mt-4 flex justify-center">
              <Button variant="outline" disabled={loadingOlder} onClick={() => void loadOlder(d)}>{loadingOlder ? "Loading…" : "Show older messages"}</Button>
            </div>
          )}
          </>
        )}
      </Async>
    </Section>
  );
}

// --- Error reports ----------------------------------------------------------------------------

interface ErrorReportRow {
  fingerprint: string; message: string; count: number; firstSeen: string; lastSeen: string;
  issueNumber: number | null; issueUrl: string | null; issueState: string | null;
  sample: { route: string; appVersion: string; stack: string; userAgent: string };
}

function ErrorsPanel() {
  const state = useApi<{ reports: ErrorReportRow[] }>("/api/owner/errors?limit=100");
  return (
    <Section title="Error reports" description="Crashes people chose to report, grouped by what broke. Each is filed as a GitHub issue when the server has a token for it.">
      <Async state={state} empty={(d) => !d.reports.length && <EmptyState icon={Bug} title="No error reports" description="Nobody has reported a crash." />}>
        {({ reports }) => (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.fingerprint} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-danger/15 font-display text-sm font-semibold tabular-nums text-danger" title={`${r.count} reports`}>{r.count > 99 ? "99+" : r.count}</span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-mono text-sm text-foreground">{r.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.count} report{r.count === 1 ? "" : "s"} · last {ago(r.lastSeen)} · first {ago(r.firstSeen)} · on <span className="font-mono">{r.sample.route}</span> · v{r.sample.appVersion}
                    </p>
                  </div>
                  {r.issueUrl ? (
                    <Button size="sm" variant="outline" className="shrink-0 max-sm:h-10" asChild>
                      <a href={r.issueUrl} target="_blank" rel="noreferrer noopener">#{r.issueNumber}{r.issueState && r.issueState !== "open" ? ` · ${r.issueState.replace("_", " ")}` : ""} <ExternalLink /></a>
                    </Button>
                  ) : <Badge variant="secondary" className="shrink-0">Not filed</Badge>}
                </div>
                {r.sample.stack && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Latest stack</summary>
                    <pre className="custom-scrollbar mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">{r.sample.stack}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Section>
  );
}

// --- Data jobs --------------------------------------------------------------------------------

const OPS: { op: OpName; title: string; icon: typeof RefreshCw; does: string; confirm: string; tone: string }[] = [
  { op: "resync", title: "Re-sync now", icon: RefreshCw, tone: "bg-accent/15 text-accent-text",
    does: "Fetches the current season from FIRST, then rebuilds stats, ratings and the prediction ledger. Takes a few minutes.",
    confirm: "Live results for events on today wait until it finishes. The scheduled sync won't start while it runs." },
  { op: "packs", title: "Rebuild offline packs", icon: PackageOpen, tone: "bg-info/15 text-info",
    does: "Builds fresh offline packs from the current data. Devices pick them up on their next visit.",
    confirm: "Building packs takes a few minutes, and live results for today's events pause until it's done." },
  { op: "caches", title: "Clear caches", icon: Trash2, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    does: "Empties the server's in-memory caches (ratings, track record, forecasts, search, weather, flags) and rebuilds the costly ones.",
    confirm: "Pages may be slower for a minute while ratings rebuild. Nothing stored is touched." },
];

function OpsPanel() {
  const state = useApi<OpsStatus>("/api/owner/ops");
  const [asking, setAsking] = useState<OpName | null>(null);
  const [sending, setSending] = useState(false);
  const running = !!state.data && Object.values(state.data.jobs).some((j) => j?.state === "running");
  // While a job runs, check on it every 2 seconds.
  const { reload } = state;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(reload, 2000);
    return () => window.clearInterval(t);
  }, [running, reload]);
  const start = async (op: OpName) => {
    setSending(true);
    try {
      const r = await apiFetch<{ status: OpsStatus }>(`/api/owner/ops/${op}`, { method: "POST", json: { confirm: true } });
      prime("/api/owner/ops", r.status);
      toast.success("Started. Progress shows on its card.");
      setAsking(null);
    } catch (e) {
      toast.error((e as ApiError).message);
      reload();
    } finally { setSending(false); }
  };
  const chosen = OPS.find((o) => o.op === asking);
  return (
    <Section title="Data jobs" description="Each runs in the background and never alongside a scheduled sync or the live results lane: if one of those is busy, the job says so instead of starting.">
      <Async state={state}>
        {(s) => (
          <>
            <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("size-2 rounded-full", s.writer || s.cycle ? "bg-warning" : "bg-success")} aria-hidden />
              {s.cycle ? `A data update (${s.cycle.reason}) is running on this server.` : s.writer ? `The data writer is busy: ${s.writer.what}.` : "The data writer is free."}
            </p>
            <div className="grid gap-3 lg:grid-cols-3">
              {OPS.map((o) => {
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

// --- Audit log --------------------------------------------------------------------------------

function describe(e: AuditEntry): string {
  const d = e.details ?? {};
  switch (e.action) {
    case "flag.set": return `Turned ${FLAG_INFO[d.flag as Flag]?.label ?? String(d.flag)} ${d.enabled ? "on" : "off"}`;
    case "feedback.status": return `${d.status === "open" ? "Reopened" : d.status === "resolved" ? "Resolved" : "Archived"} feedback #${d.id}`;
    case "ops.resync": return "Re-sync now";
    case "ops.packs": return "Rebuild offline packs";
    case "ops.caches": return "Clear caches";
    default: return e.action;
  }
}

function AuditPanel() {
  const state = useApi<{ entries: AuditEntry[] }>("/api/owner/audit?limit=200");
  return (
    <Section title="Audit log" description="Everything done from this page: who, what and when. Kept for good; nothing here can be edited.">
      <Async state={state} empty={(d) => !d.entries.length && <EmptyState icon={ScrollText} title="Nothing yet" description="Switches, inbox changes and data jobs are recorded here." />}>
        {({ entries }) => (
          <div className="rounded-xl border border-border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What</TableHead><TableHead>Result</TableHead><TableHead>Who</TableHead></TableRow></TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={e.at}>{when(e.at)}</TableCell>
                    <TableCell className="min-w-[10rem] font-medium">{describe(e)}</TableCell>
                    <TableCell className={cn("min-w-[10rem] text-xs", e.result?.startsWith("failed") || e.result?.startsWith("refused") ? "text-danger" : "text-muted-foreground")}>{e.result ?? "Done"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{e.actor}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Async>
    </Section>
  );
}
