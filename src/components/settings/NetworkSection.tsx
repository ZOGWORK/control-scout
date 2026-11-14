// Settings › Network & offline (/settings#network, also /network): one screen that answers, top to bottom, am I
// online, on what, how much data this uses, should I use Lite, and what's downloaded; then the only copy of the
// controls (Lite on or off, which connections downloads use, automatic updates, clear cache). Plain words; every
// choice says what it does before it's picked. Pack management itself stays on the Download page (linked).
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { RadioGroup as RadioP } from "radix-ui";
import { Check, CheckCircle2, HardDriveDownload, RefreshCw, Snail, Trash2, Wifi, WifiOff, Zap } from "lucide-react";
import { checkInternet, useConnection } from "../../lib/connection";
import { adviseLite, connectionLabel, liteCookieOn, liteToggleHref, slowReason, statusSentence } from "../../lib/networkAdvice";
import { useDataUse } from "../../lib/dataUse";
import { useLiteReason } from "../../lib/liteSuggest";
import { useFlag } from "../../lib/flags";
import { useCurrentSeason } from "../../lib/meta";
import { agoSeconds, seasonLabel } from "../../lib/format";
import { clearRecordings, fmtBytes } from "../../lib/recordings";
import { packStatus } from "../../lib/packPolicy";
import { useSavedSeasons } from "../../lib/offline/saved";
import { useSavedBundles } from "../../lib/offline/bundleMeta";
import { bundleTime } from "../../shared/eventBundle";
import { fetchManifest, type PackManifest } from "../../lib/packs";
import { clearAppCache, planAppCache, type CachePlan } from "../../lib/offline/appCache";
import { useConnection as useNetInfo, useUpdatePrefs } from "../offline/UpdateSettings";
import type { UpdateMode, UpdateNetwork } from "../../lib/offline/updatePolicy";
import { updatedLabel } from "../ConnectionStatus";
import { Group, Row } from "./rows";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { cn } from "../cn";

/** Re-render every `ms` (the "checked 2 min ago" line). */
function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function NetworkSection() {
  const conn = useConnection();
  const net = useNetInfo();
  const used = useDataUse();
  const liteFlag = useFlag("venueLightMode");
  const slowSeen = useLiteReason() != null;
  const liteOn = liteCookieOn();
  const [checking, setChecking] = useState(false);
  useTick(15_000);
  const check = async () => { setChecking(true); try { await checkInternet(); } finally { setChecking(false); } };
  const advice = adviseLite({ internet: conn.internet, effectiveType: net?.effectiveType, saveData: conn.saveData, slowSeen, liteOn });
  const why = advice.kind === "slow" ? slowReason({ effectiveType: net?.effectiveType, saveData: conn.saveData, slowSeen }) : null;
  const tone = conn.internet === "yes" ? "ok" : conn.internet === "unknown" ? "wait" : conn.internet === "portal" ? "warn" : "off";
  const connected = conn.internet === "yes";
  const m = useManifest(connected);
  return (
    <div data-network-section="">
      <section aria-labelledby="net-status" className="mb-8 max-sm:mb-5 rounded-xl border border-border bg-card p-4 sm:p-5" data-net-status={conn.internet}>
        <div className="flex items-start gap-3">
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl",
            tone === "ok" ? "bg-success/15 text-success" : tone === "warn" ? "bg-warning/15 text-warning" : tone === "off" ? "bg-info/15 text-info" : "bg-muted text-muted-foreground")} aria-hidden>
            {tone === "ok" ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="net-status" aria-live="polite" className="font-display text-lg font-semibold leading-snug text-foreground">{statusSentence(conn.internet)}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{conn.checkedAt ? `Checked ${agoSeconds(new Date(conn.checkedAt).toISOString())}` : "Not checked yet"}</p>
          </div>
        </div>
        <Button variant="secondary" className="mt-3 h-11 w-full sm:w-auto" onClick={check} disabled={checking}>
          <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} /> {checking ? "Checking" : "Check again"}
        </Button>
      </section>

      <Group title="Right now">
        <Row label="Connection" description={conn.type === "unknown" ? "Some browsers (every iPhone) don't tell websites whether they're on Wi-Fi or mobile data." : conn.saveData ? "Data Saver is on in your browser." : undefined}>
          <span className="text-sm font-medium text-foreground" data-net-type={conn.type}>{connectionLabel(conn.type, net?.type)}</span>
        </Row>
        <Row label="Data used" description="Measured by your browser since you opened Control Scout. Files it already had count as nothing.">
          <span className="text-sm tabular-nums text-foreground" data-net-used>{used == null ? "Your browser doesn't say" : `This visit has used ${fmtBytes(used)}`}</span>
        </Row>
        <Row label="Should I use Lite?" description={<span data-net-advice={advice.kind}>{advice.text}{why ? ` ${why}` : ""}</span>}>
          {liteFlag && advice.action && (
            <Button variant={advice.action === "on" ? "default" : "outline"} className="h-11 sm:h-9" asChild>
              <a href={liteToggleHref(advice.action === "on")}>{advice.action === "on" ? <><Zap /> Turn on Lite</> : "Turn off Lite"}</a>
            </Button>
          )}
        </Row>
      </Group>

      <Downloads m={m} />
      <Controls m={m} liteFlag={liteFlag} liteOn={liteOn} connected={connected} />
      <CleanUp />
    </div>
  );
}

/** What's downloaded (each pack, its size, its data time) and what a download costs, from the pack manifest. */
function Downloads({ m }: { m: PackManifest | null }) {
  const seasons = useSavedSeasons();
  const bundles = useSavedBundles();
  const lite = packStatus();
  const items = [
    ...bundles.map((b) => ({ key: `b:${b.season}:${b.code}`, name: b.name, bytes: b.bytes, at: bundleTime(b) })),
    ...seasons.map((s) => ({ key: `s:${s.season}`, name: `${seasonLabel(s.season)} season`, bytes: s.bytes, at: s.dataAsOf ?? new Date(s.savedAt).toISOString() })),
    ...(lite ? [{ key: "lite", name: "Offline predictions", bytes: lite.bytes, at: lite.builtAt }] : []),
  ];
  return (
    <Group title="Downloaded on this device" description={<>Downloads open with no connection. <Link to="/download" className="underline underline-offset-2">Manage downloads</Link></>}>
      {items.length ? (
        <ul aria-label="Downloads on this device">
          {items.map((i) => (
            <li key={i.key} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0">
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{i.name}</span>
                <span className="block text-xs text-muted-foreground">Data from {updatedLabel(i.at) || "unknown"}</span>
              </span>
              <span className="shrink-0 tabular-nums text-foreground">{fmtBytes(i.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-3 text-sm text-muted-foreground">Nothing downloaded yet. Download an event before you go, while you have a connection.</p>}
      <div className="border-t border-border px-4 py-3">
        <Button variant="outline" className="h-11 w-full sm:h-9 sm:w-auto" asChild><Link to="/download"><HardDriveDownload /> Manage downloads</Link></Button>
      </div>
      <Sizes m={m} />
    </Group>
  );
}

/** The pack manifest (sizes of every download), read once while there's internet. */
function useManifest(connected: boolean): PackManifest | null {
  const [m, setM] = useState<PackManifest | null>(null);
  useEffect(() => {
    if (!connected || m) return;
    let live = true;
    fetchManifest().then((x) => { if (live) setM(x); }, () => { /* sizes say they need a connection */ });
    return () => { live = false; };
  }, [connected, m]);
  return m;
}

export function sizeLines(m: PackManifest | null, season: number, events: { name: string; bytes: number }[]): string[] {
  const lines: string[] = [];
  for (const e of events.slice(0, 2)) lines.push(`Downloading ${e.name} used ${fmtBytes(e.bytes)}.`);
  if (!m) return lines;
  const current = m.full.find((f) => f.seasons.includes(season));
  if (current) lines.push(`The whole ${seasonLabel(season)} season uses ${fmtBytes(current.bytes)}.`);
  if (m.full.length > 1) lines.push(`Every season (${m.full.length}) uses ${fmtBytes(m.full.reduce((n, f) => n + f.bytes, 0))}.`);
  if (m.lite) lines.push(`Offline predictions use ${fmtBytes(m.lite.bytes)}.`);
  return lines;
}

function Sizes({ m }: { m: PackManifest | null }) {
  const season = useCurrentSeason();
  const bundles = useSavedBundles();
  const lines = sizeLines(m, season, bundles);
  return (
    <div className="border-t border-border px-4 py-3 text-sm" data-net-sizes>
      <p className="font-medium text-foreground">How much a download uses</p>
      <ul className="mt-1 space-y-0.5 text-muted-foreground">
        {lines.map((l) => <li key={l}>{l}</li>)}
        <li>Each event's size shows before you download it{m ? "" : "; the rest show when you're online"}.</li>
      </ul>
    </div>
  );
}

/** A choice of options, each saying what it does in one line before it's picked. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; name: string; line: ReactNode }[] }) {
  return (
    <RadioP.Root value={value} onValueChange={(v) => { const o = options.find((x) => x.value === v); if (o) onChange(o.value); }} aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <RadioP.Item key={o.value} value={o.value} aria-describedby={`net-${label}-${o.value}`.replace(/\W+/g, "-")}
            className={cn("flex min-h-11 flex-col gap-0.5 rounded-lg border bg-card p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              on ? "border-accent ring-1 ring-accent" : "border-border hover:border-muted-foreground/50")}>
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">{o.name}{on && <Check className="size-3.5 text-accent-text" aria-hidden />}</span>
            <span id={`net-${label}-${o.value}`.replace(/\W+/g, "-")} className="text-xs leading-snug text-muted-foreground">{o.line}</span>
          </RadioP.Item>
        );
      })}
    </RadioP.Root>
  );
}

function Controls({ m, liteFlag, liteOn, connected }: { m: PackManifest | null; liteFlag: boolean; liteOn: boolean; connected: boolean }) {
  const { mode, network, setMode, setNetwork } = useUpdatePrefs();
  const season = useCurrentSeason();
  const current = m?.full.find((f) => f.seasons.includes(season));
  const warning = current
    ? `Mobile data counts against your plan: the whole ${seasonLabel(season)} season is ${fmtBytes(current.bytes)}${m?.lite ? `, offline predictions ${fmtBytes(m.lite.bytes)}` : ""}.`
    : "Mobile data counts against your plan: a season can be tens of MB.";
  return (
    <Group title="Settings" description="Synced with your account when you're signed in.">
      {liteFlag && (
        <Row label="Lite" stack description="Opens the text-only Lite version of pages that have one. Turn off any time.">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-foreground" data-net-lite={liteOn ? "on" : "off"}>{liteOn ? "Lite is on" : "Lite is off"}</span>
            {connected ? (
              <Button variant={liteOn ? "outline" : "secondary"} className="h-11 sm:h-9" asChild>
                <a href={liteToggleHref(!liteOn)}>{liteOn ? "Turn off Lite" : <><Snail /> Turn on Lite</>}</a>
              </Button>
            ) : <span className="text-xs text-muted-foreground">Needs a connection to switch.</span>}
          </div>
        </Row>
      )}
      <Row label="Downloads" stack description="Which connections downloads and updates may use.">
        <Choice<UpdateNetwork> label="Downloads" value={network} onChange={setNetwork} options={[
          { value: "wifi", name: "Wi-Fi only", line: "Nothing downloads on mobile data unless you tap Download yourself." },
          { value: "any", name: "Wi-Fi and mobile data", line: warning },
        ]} />
      </Row>
      <Row label="Updates" stack description="When a newer copy of something you downloaded is out.">
        <Choice<UpdateMode> label="Updates" value={mode} onChange={setMode} options={[
          { value: "auto", name: network === "any" ? "Update packs automatically" : "Update packs automatically on Wi-Fi", line: network === "any" ? "Updates download by themselves, on Wi-Fi or mobile data." : "Updates download by themselves when you're on Wi-Fi." },
          { value: "ask", name: "Never update automatically (I'll tap Update)", line: "You get a note when an update is out; nothing downloads until you tap Update." },
        ]} />
      </Row>
    </Group>
  );
}

/** Clear cache (how much it frees, measured first), recordings, and the site's whole share of storage. */
function CleanUp() {
  const [plan, setPlan] = useState<CachePlan | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const measure = () => { planAppCache().then(setPlan, () => setPlan(null)); navigator.storage?.estimate?.().then(setEst, () => setEst({})); };
  useEffect(measure, []);
  const clear = async () => {
    setBusy(true);
    try {
      const n = await clearAppCache();
      setFreed(n);
      toast.success(`Freed ${fmtBytes(n)}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't clear the cache"); }
    finally { setBusy(false); measure(); }
  };
  const bytes = plan?.bytes ?? 0;
  return (
    <Group title="Clean up">
      <Row label="Clear cache" description={<>
        Removes old copies of the app's files. Your downloads, scouting notes and settings stay, and the app still opens offline.
        {freed != null && <span role="status" className="mt-1 flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" /> Freed {fmtBytes(freed)}</span>}
      </>}>
        <Button variant="outline" className="h-11 sm:h-9" onClick={clear} disabled={busy || plan === undefined || !bytes} data-net-clear>
          <Trash2 /> {plan === undefined ? "Measuring…" : plan === null ? "Nothing cached" : bytes ? `Clear ${fmtBytes(bytes)}` : "Nothing to clear"}
        </Button>
      </Row>
      <Row label="Recordings" description="Match videos recorded in the app live only on this device.">
        <Button variant="outline" className="h-11 sm:h-9" onClick={() => clearRecordings().then(() => toast.success("Recordings deleted from this device"), (e) => toast.error(e.message))}>Delete all recordings</Button>
      </Row>
      <Row label="Storage used by this site" description="Downloads, the app's files and recordings, all together.">
        <span className="text-sm tabular-nums text-foreground">{est?.usage != null ? `${fmtBytes(est.usage)}${est.quota ? ` of ${fmtBytes(est.quota)}` : ""}` : "Your browser doesn't say"}</span>
      </Row>
    </Group>
  );
}
