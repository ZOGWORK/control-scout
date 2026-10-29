// Owner console › Features: the feature toggles (one card each, with its scope) and, below them, the kill switches
// (server/portal/features.ts, server/flags.ts). A global flip asks first, saying exactly what turns off and that
// nothing is deleted; a workspace's own setting (workspace-scoped toggles) applies at once, with a toast. The
// console itself is never behind any of these.
import { useMemo, useState } from "react";
import { ClipboardList, Coins, Download, Globe, MessageCircle, Power, PowerOff, Search, Sparkles, Trophy, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Badge, Input } from "../ui/basic";
import { Button } from "../ui/button";
import { Switch, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, prime, useApi, type ApiError } from "../../lib/api";
import { refreshFlags } from "../../lib/flags";
import { ago } from "../../lib/format";
import { FLAG_INFO, type Flag } from "../../shared/flags";
import type { OwnerFlag, OwnerFlags } from "../../shared/owner";

export const FLAGS_PATH = "/api/owner/flags";

/** Each feature toggle's colour and icon (literal classes, so Tailwind keeps them). */
const LOOK: Partial<Record<Flag, { icon: LucideIcon; chip: string; edge: string }>> = {
  livePredictions: { icon: Sparkles, chip: "bg-accent/15 text-accent-text", edge: "border-l-accent" },
  advancementOdds: { icon: TrendingUp, chip: "bg-info/15 text-info", edge: "border-l-info" },
  powerRankings: { icon: Trophy, chip: "bg-warning/15 text-warning", edge: "border-l-warning" },
  coinFlips: { icon: Coins, chip: "bg-success/15 text-success", edge: "border-l-success" },
  offlinePacks: { icon: Download, chip: "bg-info/15 text-info", edge: "border-l-info" },
  discordBot: { icon: MessageCircle, chip: "bg-violet-500/15 text-violet-500 dark:text-violet-300", edge: "border-l-violet-500" },
  workspaceScouting: { icon: ClipboardList, chip: "bg-danger/15 text-danger", edge: "border-l-danger" },
};

/** How many workspaces the overrides list shows before asking for a search. */
const LIST_MAX = 25;

export function FeaturesPanel() {
  const state = useApi<OwnerFlags>(FLAGS_PATH);
  const [ask, setAsk] = useState<{ flag: OwnerFlag; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const flipGlobal = async (f: OwnerFlag, enabled: boolean) => {
    setBusy(f.name);
    try {
      const r = await apiFetch<OwnerFlags>(`${FLAGS_PATH}/${f.name}`, { method: "PUT", json: { enabled, confirm: true } });
      prime(FLAGS_PATH, r);
      void refreshFlags();
      toast.success(`${FLAG_INFO[f.name].label} ${enabled ? "on" : "off"} everywhere. Every server has it within a few seconds.`);
      setAsk(null);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(null); }
  };

  return (
    <>
      <Async state={state}>
        {(d) => {
          const features = d.flags.filter((f) => f.group === "feature");
          const kills = d.flags.filter((f) => f.group === "kill");
          const off = features.filter((f) => !f.enabled).length;
          return (
            <>
              <Section title="Feature toggles"
                description={<>Switch a feature off for everyone, and back on, without a deploy. The server refuses it while it's off (pages say it's switched off for now), and nothing is deleted: switching back on brings everything back as it was. {off ? <strong className="text-foreground">{off} of {features.length} off right now.</strong> : `All ${features.length} on.`}</>}>
                <ul className="grid gap-3 lg:grid-cols-2">
                  {features.map((f) => (
                    <FeatureCard key={f.name} f={f} busy={busy === f.name} onFlip={(enabled) => setAsk({ flag: f, enabled })}>
                      {f.scope === "workspace" && <WorkspaceOverrides flag={f} data={d} />}
                    </FeatureCard>
                  ))}
                </ul>
              </Section>
              <Section title="Kill switches" description="Operational switches for parts of the app that depend on other services or run in the background. Each one is global.">
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {kills.map((f) => <KillSwitchRow key={f.name} f={f} busy={busy === f.name} onFlip={(enabled) => setAsk({ flag: f, enabled })} />)}
                </ul>
              </Section>
            </>
          );
        }}
      </Async>
      <Dialog open={!!ask} onOpenChange={(v) => { if (!v && !busy) setAsk(null); }}>
        <DialogContent>
          {ask && (
            <>
              <DialogHeader>
                <DialogTitle>Turn {FLAG_INFO[ask.flag.name].label.toLowerCase()} {ask.enabled ? "on" : "off"} for everyone?</DialogTitle>
                <DialogDescription>{ask.enabled ? FLAG_INFO[ask.flag.name].on : FLAG_INFO[ask.flag.name].off}</DialogDescription>
              </DialogHeader>
              <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-foreground">
                {ask.enabled ? "Everything that was kept while it was off is back as it was." : "Nothing is deleted. Switching it back on restores everything exactly as it was."}
                {ask.flag.scope === "workspace" && " Workspaces with their own setting keep it."}
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsk(null)} disabled={!!busy}>Cancel</Button>
                <Button variant={ask.enabled ? "default" : "destructive"} disabled={!!busy} onClick={() => void flipGlobal(ask.flag, ask.enabled)}>
                  {ask.enabled ? <Power /> : <PowerOff />} {busy ? "Saving…" : ask.enabled ? "Yes, turn it on" : "Yes, turn it off"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

const changed = (f: OwnerFlag) => (f.updatedAt ? `Changed ${ago(f.updatedAt)} by ${f.updatedBy}` : "Never changed: on by default");

function FeatureCard({ f, busy, onFlip, children }: { f: OwnerFlag; busy: boolean; onFlip: (enabled: boolean) => void; children?: React.ReactNode }) {
  const info = FLAG_INFO[f.name];
  const look = LOOK[f.name] ?? { icon: Power, chip: "bg-accent/15 text-accent-text", edge: "border-l-accent" };
  const Icon = look.icon;
  const id = `feature-${f.name}`;
  return (
    <li className={cn("min-w-0 rounded-xl border border-l-4 border-border bg-card p-4", f.enabled ? look.edge : "border-l-danger/60")} data-flag={f.name}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", f.enabled ? look.chip : "bg-text-base/[0.06] text-text-muted")} aria-hidden><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
            <span className="min-w-0 break-words">{info.label}</span>
            <Badge variant={f.enabled ? "success" : "destructive"}>{f.enabled ? "On" : "Off"}</Badge>
            <Badge variant={f.scope === "workspace" ? "info" : "secondary"}>{f.scope === "workspace" ? <><Users /> Per workspace</> : <><Globe /> Global</>}</Badge>
          </label>
          <p className="mt-1 text-sm text-muted-foreground">{f.enabled ? info.on : info.off}</p>
          <p className="mt-1 text-xs text-muted-foreground/80">{changed(f)}</p>
        </div>
        <Switch id={id} className="mt-1.5" checked={f.enabled} disabled={busy} onCheckedChange={onFlip} aria-label={`${info.label} for everyone: ${f.enabled ? "on" : "off"}`} />
      </div>
      {children}
    </li>
  );
}

function KillSwitchRow({ f, busy, onFlip }: { f: OwnerFlag; busy: boolean; onFlip: (enabled: boolean) => void }) {
  const info = FLAG_INFO[f.name];
  const id = `kill-${f.name}`;
  return (
    <li className="flex items-start gap-3 p-4" data-flag={f.name}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium text-foreground">
          <span className="min-w-0 break-words">{info.label}</span>
          <Badge variant={f.enabled ? "success" : "destructive"}>{f.enabled ? "On" : "Off"}</Badge>
        </label>
        <p className="mt-1 text-sm text-muted-foreground">{f.enabled ? info.on : info.off}</p>
        {info.pending && <p className="mt-1 text-xs text-muted-foreground/80">{info.pending}</p>}
        <p className="mt-1 text-xs text-muted-foreground/80">{changed(f)}</p>
      </div>
      <Switch id={id} className="mt-1" checked={f.enabled} disabled={busy} onCheckedChange={onFlip} aria-label={`${info.label}: ${f.enabled ? "on" : "off"}`} />
    </li>
  );
}

type Setting = "on" | "off" | "inherit";

/** A workspace-scoped toggle's per-workspace settings: search, then on / off / follow the global switch, applied at once. */
function WorkspaceOverrides({ flag, data }: { flag: OwnerFlag; data: OwnerFlags }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const info = FLAG_INFO[flag.name];
  const own = useMemo(() => new Map(data.overrides.filter((o) => o.flag === flag.name).map((o) => [o.workspaceId, o])), [data.overrides, flag.name]);
  // Workspaces with their own setting first, then by name; filtered by the search (name or id).
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.workspaces
      .filter((w) => !needle || w.name.toLowerCase().includes(needle) || w.id.toLowerCase().includes(needle))
      .sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)) || a.name.localeCompare(b.name));
  }, [data.workspaces, own, q]);

  const set = async (w: { id: string; name: string }, to: Setting) => {
    const enabled = to === "inherit" ? null : to === "on";
    setBusy(w.id);
    try {
      const r = await apiFetch<OwnerFlags>(`${FLAGS_PATH}/${flag.name}/workspaces/${encodeURIComponent(w.id)}`, { method: "PUT", json: { enabled } });
      prime(FLAGS_PATH, r);
      const name = w.name || "That workspace";
      toast.success(enabled === null
        ? `${name} follows the global switch again (${flag.enabled ? "on" : "off"}).`
        : `${info.label} ${enabled ? "on" : "off"} for ${name}. It applies within a few seconds.`);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(null); }
  };

  const ownCount = own.size;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-medium text-foreground">Per workspace</h4>
        <p className="text-xs text-muted-foreground">{ownCount ? `${ownCount} with their own setting` : "Every workspace follows the global switch"}</p>
      </div>
      {data.workspaces.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No workspace has scouted here yet, so there's none to set.</p>
      ) : (
        <>
          <label className="relative mt-3 block">
            <span className="sr-only">Search workspaces</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search workspaces" className="pl-9" />
          </label>
          <ul className="mt-2 divide-y divide-border">
            {shown.slice(0, LIST_MAX).map((w) => {
              const o = own.get(w.id);
              const value: Setting = o ? (o.enabled ? "on" : "off") : "inherit";
              const effective = o ? o.enabled : flag.enabled;
              return (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5" data-workspace={w.id}>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-sm font-medium text-foreground">{w.name || "Unnamed workspace"}</p>
                    <p className={cn("text-xs", effective ? "text-success" : "text-danger")}>{effective ? "On" : "Off"}{o ? " (its own setting)" : " (follows global)"}</p>
                  </div>
                  <ToggleGroup type="single" value={value} disabled={busy === w.id} aria-label={`${info.label} for ${w.name || "this workspace"}`}
                    onValueChange={(v) => { if (v && v !== value) void set(w, v as Setting); }} className="shrink-0">
                    <ToggleGroupItem value="on" size="sm">On</ToggleGroupItem>
                    <ToggleGroupItem value="off" size="sm">Off</ToggleGroupItem>
                    <ToggleGroupItem value="inherit" size="sm">Global</ToggleGroupItem>
                  </ToggleGroup>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No workspace matches “{q.trim()}”.</p>}
          {shown.length > LIST_MAX && <p className="mt-2 text-xs text-muted-foreground">{shown.length - LIST_MAX} more: search to find one.</p>}
        </>
      )}
    </div>
  );
}
