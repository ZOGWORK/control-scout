// Settings: account, appearance, tracking, notifications, offline & data,
// scouting data, privacy, about.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Bell, Database, Download, ExternalLink, KeyRound, Link2, LogOut, Mail, Monitor, Moon, Palette, Shield, Sun, Upload, User, X } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useMeta, useTitle } from "../lib/meta";
import { usePersonal, type AccountUser, type AuthProviders } from "../lib/personal";
import { clearLocalScouting, localScoutEntries, saveScoutEntry, type ScoutEntry } from "../lib/scouting";
import { clearRecordings, fmtBytes } from "../lib/recordings";
import { downloadCsv } from "../lib/csv";
import { PageHeader } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge, Input, Label } from "../components/ui/basic";
import { Switch, ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { OtpInput } from "../components/arc/otp-input/otp-input";
import { HoldToConfirm } from "../components/arc/hold-to-confirm/hold-to-confirm";
import { ago } from "../lib/format";
import { packStatus } from "../lib/packs";

function Card({ id, icon: Icon, title, description, children }: { id: string; icon: typeof User; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="size-4 text-accent" />{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  useTitle("Settings");
  useEffect(() => { if (location.hash) document.querySelector(location.hash)?.scrollIntoView(); }, []);
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        <Account />
        <Appearance />
        <Tracking />
        <Notifications />
        <OfflineData />
        <ScoutingData />
        <Privacy />
        <About />
      </div>
    </div>
  );
}

// --- Account -----------------------------------------------------------------

function Account() {
  const { user, providers, sync, signOut, signedIn } = usePersonal();
  return (
    <Card id="account" icon={User} title="Account" description="Browsing, search and predictions never need an account. Sign in only to sync My Team, tracking, shortlist, saved predictions, video links and scouting notes across devices.">
      {!providers ? <div className="skeleton h-20 rounded-xl" /> : user ? <SignedIn user={user} sync={sync} onSignOut={signOut} /> : <SignIn providers={providers} onSignedIn={signedIn} />}
    </Card>
  );
}

function SignIn({ providers, onSignedIn }: { providers: AuthProviders; onSignedIn: (u: AccountUser) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!providers.email && !providers.google && !providers.controlPoint) return <p className="text-sm text-muted-foreground">Sign-in isn't set up on this server. Everything still works on this device.</p>;
  const start = async () => {
    setBusy(true); setError(null);
    try { await apiFetch("/api/auth/email/start", { method: "POST", json: { email } }); setSent(true); toast.success(`Code sent to ${email}`); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const verify = async (c: string) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ user: AccountUser }>("/api/auth/email/verify", { method: "POST", json: { email, code: c } });
      await onSignedIn(r.user);
      toast.success("Signed in — this device's data is now in your account");
    } catch (e: any) { setError(e.message); setCode(""); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-md space-y-4">
      {providers.email && (!sent ? (
        <form onSubmit={(e) => { e.preventDefault(); start(); }} className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <div className="flex gap-2">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="h-10" />
            <Button type="submit" disabled={busy || !email}><Mail /> Send code</Button>
          </div>
          <p className="text-xs text-muted-foreground">We email a 6-digit code. No password to remember.</p>
        </form>
      ) : (
        <div className="space-y-3">
          <OtpInput label={`Code sent to ${email}`} description="It expires in 10 minutes." value={code} onChange={(v) => { setCode(v); if (v.length === 6) verify(v); }} autoFocus disabled={busy} error={error ?? undefined} />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setSent(false); setCode(""); setError(null); }}>Use a different email</Button>
            <Button variant="ghost" size="sm" onClick={start} disabled={busy}>Send a new code</Button>
          </div>
        </div>
      ))}
      {error && !sent && <p className="text-sm text-destructive">{error}</p>}
      {providers.google && <Button variant="secondary" asChild><a href="/api/auth/google/start">Continue with Google</a></Button>}
      {providers.controlPoint && (
        <div className="space-y-1.5">
          <Button variant="secondary" asChild><a href="/api/auth/control-point/start"><KeyRound /> Continue with Control Point</a></Button>
          <p className="text-xs text-muted-foreground">One account for both apps: use your Control Point sign-in, or sign in here with the same email and it's the same account.</p>
        </div>
      )}
    </div>
  );
}

function SignedIn({ user, sync, onSignOut }: { user: AccountUser; sync: string; onSignOut: () => Promise<void> }) {
  const [name, setName] = useState(user.displayName ?? "");
  const { clearLocal } = usePersonal();
  const saveName = async () => { await apiFetch("/api/me", { method: "PATCH", json: { displayName: name } }).then(() => toast.success("Saved"), (e) => toast.error(e.message)); };
  const del = async () => {
    try { await apiFetch("/api/me", { method: "DELETE", json: { confirm: "DELETE" } }); clearLocal(); await onSignOut(); toast.success("Account deleted"); }
    catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="space-y-4">
      {user.controlPointLinked && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Link2 className="size-3.5" /> One account with Control Point: the same email works on tryctrlpoint.org.</p>}
      <p className="text-sm">Signed in as <span className="font-medium">{user.email}</span> <Badge variant={sync === "synced" ? "success" : sync === "error" || sync === "offline" ? "destructive" : "secondary"} className="ml-1">{sync === "synced" ? "Synced" : sync === "syncing" ? "Syncing…" : sync === "offline" ? "Offline — will sync" : sync === "error" ? "Sync error — will retry" : sync}</Badge></p>
      <div className="flex max-w-md gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" aria-label="Display name" className="h-10" maxLength={60} />
        <Button variant="secondary" onClick={saveName}>Save</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => onSignOut().then(() => toast("Signed out — your data stays on this device"))}><LogOut /> Sign out</Button>
        <HoldToConfirm label="Hold to delete account" confirmedLabel="Deleted" tone="danger" onConfirm={del} />
      </div>
      <p className="text-xs text-muted-foreground">Deleting removes your account and everything synced to it (tracking, shortlist, scouting notes, video links). Recordings on this device are separate — clear them under Offline & data.</p>
    </div>
  );
}

// --- Appearance ---------------------------------------------------------------

function Appearance() {
  const { state, update } = usePersonal();
  const s = state.settings;
  return (
    <Card id="appearance" icon={Palette} title="Appearance">
      <div className="flex flex-wrap items-center gap-6">
        <div className="space-y-1.5"><p className="text-sm">Theme</p>
          <ToggleGroup type="single" value={s.theme} onValueChange={(v) => { if (v) update("settings", (x) => ({ ...x, theme: v as typeof s.theme })); }} aria-label="Theme">
            <ToggleGroupItem value="dark"><Moon className="size-3.5" /> Dark</ToggleGroupItem><ToggleGroupItem value="light"><Sun className="size-3.5" /> Light</ToggleGroupItem><ToggleGroupItem value="system"><Monitor className="size-3.5" /> System</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-3">
          <Switch id="ambient" checked={s.ambient !== false} onCheckedChange={(v) => update("settings", (x) => ({ ...x, ambient: v }))} />
          <div><Label htmlFor="ambient">Animated background</Label><p className="text-xs text-muted-foreground">Slowly drifting grid and a light that follows your pointer. Always still if your device asks for reduced motion.</p></div>
        </div>
        <div className="space-y-1.5"><p className="text-sm">Density</p>
          <ToggleGroup type="single" value={s.density} onValueChange={(v) => { if (v) update("settings", (x) => ({ ...x, density: v as typeof s.density })); }} aria-label="Density">
            <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem><ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </Card>
  );
}

// --- Tracking -----------------------------------------------------------------

function Tracking() {
  const { state, update, set } = usePersonal();
  const move = (arr: number[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  return (
    <Card id="tracking" icon={User} title="My team & tracking" description="Tracked teams and events show up on the My Team dashboard and come first in search.">
      <p className="text-sm">My team: {state.myTeam ? <><Link to={`/teams/${state.myTeam}`} className="font-mono font-medium hover:underline">{state.myTeam}</Link> <Button variant="ghost" size="sm" onClick={() => set("myTeam", null)}>Clear</Button></> : <Link to="/my-team" className="underline">pick one</Link>}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">Tracked teams ({state.tracked.teams.length})</p>
          {!state.tracked.teams.length ? <p className="text-sm text-muted-foreground">None — press Track on a team page.</p> : (
            <ul className="space-y-1">{state.tracked.teams.map((t, i) => (
              <li key={t} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
                <Link to={`/teams/${t}`} className="flex-1 font-mono hover:underline">{t}</Link>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${t} up`} onClick={() => update("tracked", (x) => ({ ...x, teams: move(x.teams, i, -1) }))}><ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Move ${t} down`} onClick={() => update("tracked", (x) => ({ ...x, teams: move(x.teams, i, 1) }))}><ArrowDown /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${t}`} onClick={() => update("tracked", (x) => ({ ...x, teams: x.teams.filter((n) => n !== t) }))}><X /></Button>
              </li>
            ))}</ul>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">Tracked events ({state.tracked.events.length})</p>
          {!state.tracked.events.length ? <p className="text-sm text-muted-foreground">None — press Track event on an event page.</p> : (
            <ul className="space-y-1">{state.tracked.events.map((ref) => { const [s, c] = ref.split(":"); return (
              <li key={ref} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
                <Link to={`/events/${s}/${c}`} className="flex-1 font-mono hover:underline">{c} <span className="text-muted-foreground">{s}</span></Link>
                <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${c}`} onClick={() => update("tracked", (x) => ({ ...x, events: x.events.filter((e) => e !== ref) }))}><X /></Button>
              </li>
            ); })}</ul>
          )}
        </div>
      </div>
    </Card>
  );
}

// --- Notifications ------------------------------------------------------------

function Notifications() {
  const { state, update } = usePersonal();
  const n = state.settings.notify;
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const ask = async () => { if (typeof Notification !== "undefined") setPerm(await Notification.requestPermission()); };
  const row = (k: keyof typeof n, label: string, hint: string) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <div><Label htmlFor={`n-${k}`}>{label}</Label><p className="text-xs text-muted-foreground">{hint}</p></div>
      <Switch id={`n-${k}`} checked={n[k]} onCheckedChange={(v) => update("settings", (x) => ({ ...x, notify: { ...x.notify, [k]: v } }))} />
    </div>
  );
  return (
    <Card id="notifications" icon={Bell} title="Notifications" description="Alerts arrive while Control Scout is open in a browser tab (checked every 5 minutes; no background push yet). With browser permission they pop up even when the tab is in the background; otherwise they appear inside the app.">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        Browser permission: <Badge variant={perm === "granted" ? "success" : "secondary"}>{perm}</Badge>
        {perm === "default" && <Button size="sm" variant="secondary" onClick={ask}>Allow notifications</Button>}
        {perm === "denied" && <span className="text-xs text-muted-foreground">Blocked — change it in your browser's site settings.</span>}
      </div>
      <div className="divide-y divide-border">
        {row("myTeamMatches", "My team's matches", "30 minutes before your team's next scheduled match, with the odds")}
        {row("trackedTeams", "Tracked teams' matches", "Same, for teams you track")}
        {row("upsets", "Upsets", "When a tracked team wins a match it was predicted to lose (or loses one it was favoured in)")}
        {row("eventStart", "Event start", "The morning a tracked event starts")}
      </div>
    </Card>
  );
}

// --- Offline & data -------------------------------------------------------------

function OfflineData() {
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const pack = packStatus();
  useEffect(() => { navigator.storage?.estimate?.().then(setEst, () => setEst({})); }, []);
  return (
    <Card id="offline" icon={Database} title="Offline & data" description={<>Offline packs let predictions run on this device with no connection. <Link to="/download" className="underline">Download page</Link></>}>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-muted-foreground">Lite pack on this device</dt><dd className="font-medium">{pack ? `${pack.version} · ${fmtBytes(pack.bytes)} · saved ${ago(new Date(pack.savedAt).toISOString())}` : "None"}</dd></div>
        <div><dt className="text-muted-foreground">Storage used by this site</dt><dd className="font-medium">{est?.usage != null ? `${fmtBytes(est.usage)}${est.quota ? ` of ${fmtBytes(est.quota)} available` : ""}` : "—"}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild><Link to="/download"><Download /> Check for updates</Link></Button>
        <Button variant="outline" size="sm" onClick={() => { if ("caches" in window) caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => toast.success("Cached data cleared")); else toast("Nothing cached"); }}>Clear cached data</Button>
        <Button variant="outline" size="sm" onClick={() => clearRecordings().then(() => toast.success("Recordings deleted from this device"), (e) => toast.error(e.message))}>Delete all recordings on this device</Button>
      </div>
    </Card>
  );
}

// --- Scouting data ----------------------------------------------------------------

function ScoutingData() {
  const exportJson = () => {
    const data = localScoutEntries().filter((e) => !e.deleted);
    const blob = new Blob([JSON.stringify({ format: "control-scout-scouting", version: 1, exportedAt: new Date().toISOString(), entries: data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "control-scout-scouting.json"; a.click();
  };
  const exportCsv = () => downloadCsv("control-scout-scouting", localScoutEntries().filter((e) => !e.deleted).map((e) => ({ season: e.season, team: e.team, event: e.eventCode, match: e.matchLabel, kind: e.kind, notes: e.notes, updated: new Date(e.updatedAt).toISOString(), ...e.data })));
  const importJson = (file: File) => {
    file.text().then((t) => {
      const d = JSON.parse(t);
      const list: ScoutEntry[] = Array.isArray(d) ? d : d.entries;
      let n = 0;
      for (const e of list ?? []) if (e?.uuid && e.team && e.season) { saveScoutEntry({ ...e }); n++; }
      toast.success(`Imported ${n} entries`);
    }).catch(() => toast.error("That file isn't a Control Scout scouting export"));
  };
  return (
    <Card id="scouting" icon={Upload} title="Scouting data" description="Your notes are private. Export them any time.">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={exportJson}><Download /> Export JSON</Button>
        <Button variant="outline" size="sm" onClick={exportCsv}><Download /> Export CSV</Button>
        <Button variant="outline" size="sm" asChild><label className="cursor-pointer"><Upload /> Import JSON<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} /></label></Button>
        <Button variant="outline" size="sm" onClick={() => { clearLocalScouting(); toast("Scouting notes cleared from this device"); }}>Clear on this device</Button>
      </div>
    </Card>
  );
}

// --- Privacy -------------------------------------------------------------------------

function Privacy() {
  const { clearLocal, user } = usePersonal();
  return (
    <Card id="privacy" icon={Shield} title="Privacy" description="What lives where.">
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li><span className="text-foreground">Public data</span> (teams, events, matches, predictions) — from FIRST and FTC Scout; no account involved.</li>
        <li><span className="text-foreground">On this device</span> — My Team, tracking, shortlist, settings, saved predictions, scouting notes, video links, and every recording you make. Recordings never leave the device.</li>
        <li><span className="text-foreground">In your account</span> (signed in only) — the same list minus recordings. Your email is used only to send sign-in codes.</li>
        <li>No ads, no trackers, no selling data.</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => { clearLocal(); clearLocalScouting(); try { localStorage.clear(); } catch { /* ignore */ } toast.success("Local data cleared"); }}>Clear all local data</Button>
        {user && <span className="self-center text-xs text-muted-foreground">Your account data is untouched — delete the account under Account.</span>}
      </div>
    </Card>
  );
}

// --- About ---------------------------------------------------------------------------

function About() {
  const meta = useMeta();
  return (
    <Card id="about" icon={ExternalLink} title="About">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Prediction engine</dt><dd>v{meta?.engineVersion ?? "…"} (shared with Control Point)</dd></div>
        <div><dt className="text-muted-foreground">Data updated</dt><dd>{ago(meta?.dataAsOf)}</dd></div>
      </dl>
      <p className="mt-3 text-sm text-muted-foreground">Match data © <a className="underline" href="https://ftc-events.firstinspires.org" target="_blank" rel="noreferrer noopener">FIRST</a> (FIRST Events API) with <a className="underline" href="https://ftcscout.org" target="_blank" rel="noreferrer noopener">FTC Scout</a> as a fallback source. FTC Control Scout is not affiliated with or endorsed by FIRST®. FIRST Tech Challenge is a registered trademark of FIRST.</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link to="/methodology" className="underline">How predictions work</Link>
        <a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline">Manage your team in Control Point <ExternalLink className="size-3" /></a>
      </div>
    </Card>
  );
}
