// /status: is each part of Control Scout running right now, and how has it been. One banner for the whole site, then
// one card per part: up/down, its uptime over a day and a month, and a strip of its last 90 minutes of checks.
// The checks run on the server every 2 minutes (server/uptime.ts); there are no alerts. Gated by statusPage.
import { Activity, Bot, CheckCircle2, CircleAlert, CircleHelp, Globe, Database, Workflow, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { useTitle } from "../lib/meta";
import { useApi } from "../lib/api";
import { PageHeader } from "../components/page";
import { Async } from "../components/states";
import { cn } from "../components/cn";
import { CHECK_EVERY_MIN, STATUS_BARS, type ServiceKey, type ServiceStatus, type StatusBar, type StatusResponse } from "../shared/status";

const ICONS: Record<ServiceKey, ComponentType<{ className?: string }>> = { site: Globe, api: Database, controlPoint: Workflow, bot: Bot };
const ICON_TONE: Record<ServiceKey, string> = {
  site: "bg-info/12 text-info",
  api: "bg-accent-soft text-accent-text",
  controlPoint: "bg-success/12 text-success",
  bot: "bg-[#8b5cf6]/15 text-[#a78bfa]",
};

const BANNER: Record<StatusResponse["overall"], { title: string; body: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  up: { title: "Everything is running", body: "Every part of Control Scout passed its last check.", icon: CheckCircle2, tone: "border-success/40 bg-success/10 text-success" },
  partial: { title: "Some parts are down", body: "The rest is working. Each part below says which.", icon: CircleAlert, tone: "border-warning/40 bg-warning/10 text-warning" },
  down: { title: "Control Scout is down", body: "No part passed its last check. We're on it.", icon: XCircle, tone: "border-danger/40 bg-danger/10 text-danger" },
  unknown: { title: "No checks yet", body: "The first checks land within a few minutes.", icon: CircleHelp, tone: "border-line bg-surface text-text-muted" },
};

const ago = (at: number, now: number) => {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The badge colour for an uptime: green at 99.5 % and up, orange from 95 %, red below. */
export function uptimeTone(p: number | null): string {
  if (p === null) return "bg-surface text-text-muted";
  return p >= 99.5 ? "bg-success/15 text-success" : p >= 95 ? "bg-warning/15 text-warning" : "bg-danger/15 text-danger";
}
const fmt = (p: number | null) => (p === null ? "—" : `${p >= 99.995 ? 100 : p.toFixed(p >= 99 ? 2 : 1)}%`);

function Bars({ bars, label }: { bars: StatusBar[]; label: string }) {
  const down = bars.filter((b) => b.ok === false).length;
  const ran = bars.filter((b) => b.ok !== null).length;
  return (
    <div>
      <div role="img" aria-label={`${label}, last ${STATUS_BARS * CHECK_EVERY_MIN} minutes: ${ran ? `${ran - down} of ${ran} checks passed` : "no checks"}`}
        className="flex h-9 items-stretch gap-[3px]">
        {bars.map((b) => (
          <span key={b.at} title={`${clock(b.at)}: ${b.ok === null ? "not checked" : b.ok ? "up" : "down"}`}
            className={cn("min-w-0 flex-1 rounded-[3px] transition-transform hover:scale-y-110",
              b.ok === null ? "bg-line" : b.ok ? "bg-success" : "bg-danger")} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-text-muted">
        <span>{STATUS_BARS * CHECK_EVERY_MIN} min ago</span><span>now</span>
      </div>
    </div>
  );
}

function ServiceCard({ s }: { s: ServiceStatus }) {
  const Icon = ICONS[s.key];
  return (
    <li className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", ICON_TONE[s.key])}><Icon className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold tracking-tight text-foreground">{s.label}</h2>
          <p className="text-sm text-text-muted">{s.about}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
          s.up === null ? "bg-line text-text-muted" : s.up ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
          <span className={cn("size-2 rounded-full", s.up === null ? "bg-text-muted" : s.up ? "bg-success animate-pulse motion-reduce:animate-none" : "bg-danger")} aria-hidden />
          {s.up === null ? "Not checked" : s.up ? "Up" : "Down"}
        </span>
      </div>
      <Bars bars={s.bars} label={s.label} />
      <dl className="mt-4 grid grid-cols-2 gap-2">
        {([["Last 24 hours", s.uptime24h], ["Last 30 days", s.uptime30d]] as const).map(([k, v]) => (
          <div key={k} className={cn("rounded-xl px-3 py-2", uptimeTone(v))}>
            <dt className="text-xs opacity-80">{k}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export default function StatusPage() {
  useTitle("Status");
  const state = useApi<StatusResponse>("/api/status");
  return (
    <div>
      <PageHeader title="Status" description={`Is Control Scout running? Every part is checked every ${CHECK_EVERY_MIN} minutes.`} />
      <Async state={state}>
        {(d) => {
          const b = BANNER[d.overall];
          const now = Date.now();
          return (
            <>
              <section aria-live="polite" className={cn("mb-6 flex items-center gap-4 rounded-2xl border p-4 sm:p-6", b.tone)}>
                <b.icon className="size-9 shrink-0 sm:size-11" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{b.title}</p>
                  <p className="text-sm text-foreground/80">{b.body}</p>
                </div>
                {d.checkedAt !== null && (
                  <p className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted max-sm:hidden"><Activity className="size-3.5" aria-hidden /> Checked {ago(d.checkedAt, now)}</p>
                )}
              </section>
              <ul className="grid gap-4 lg:grid-cols-2">
                {d.services.map((s) => <ServiceCard key={s.key} s={s} />)}
              </ul>
              <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success" aria-hidden /> Up</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-danger" aria-hidden /> Down</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-line" aria-hidden /> Not checked</span>
              </p>
            </>
          );
        }}
      </Async>
    </div>
  );
}
