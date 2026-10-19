// Settings, laid out like Control Point's: a section list on the left (a chip
// row on phones), the section's name as the page title, and titled groups of
// rows (label + explanation on the left, the control on the right). Sections
// are addressed by ?section= so anything can deep-link; old #anchors still
// land on the right one. Esc leaves, like Control Point.
//
// Two kinds of settings (docs/settings.md): Personal (yours, synced with your account, and the only
// ones that set your view, inside a workspace too) and Workspace (shared by a Control Point
// workspace, changed by its admins; shown only to its members).
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown, ArrowUp, BellRing, Bug, ClipboardList, Download, ExternalLink, HardDriveDownload, Info, KeyRound, Link2, LogOut, Mail, Monitor, Moon, Palette,
  Star, Sun, Upload, UserRound, Users, X,
  Megaphone,
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { useMeta, useTitle } from "../lib/meta";
import { usePersonal, type AccountUser, type AuthProviders } from "../lib/personal";
import { resetConsent, useConsent } from "../lib/consent";
import { resetTour } from "../lib/tour";
import { resetInstall } from "../lib/installNudge";
import { clearLocalScouting, localScoutEntries, SCOUT_CHANGED } from "../lib/scouting";
import { applyScoutImport, downloadJson, importMessage, importRows, planKey, previewScoutImport, scoutExportJson, type DuplicatePolicy, type ImportPreview } from "../lib/scoutImport";
import { ImportPreviewDialog } from "../components/settings/ImportPreviewDialog";
import { isoOrBlank } from "../shared/scoutEntry";
import { clearRecordings, fmtBytes } from "../lib/recordings";
import { downloadCsv } from "../lib/csv";
import { manualReport, sendReport } from "../lib/errorReporting";
import { useFlag } from "../lib/flags";
import { REPORT_LIMITS } from "../shared/errorReport";
import { INBOX_CATEGORIES, INBOX_CATEGORY_INFO, INBOX_TOGGLE, inboxCategoryOn } from "../shared/inbox";
import { UPSET_THRESHOLD } from "../shared/push";
import { PushDevice } from "../components/settings/PushDevice";
import { PageHeader } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge, FieldError, Input, Textarea } from "../components/ui/basic";
import { Switch, ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { OtpInput } from "../components/arc/otp-input/otp-input";
import { HoldToConfirm } from "../components/arc/hold-to-confirm/hold-to-confirm";
import { cn } from "../components/cn";
import { ago, seasonLabel } from "../lib/format";
import { packStatus } from "../lib/packPolicy";
import { useSavedSeasons } from "../lib/offline/saved";
import { workspacesOf } from "../lib/scoutSpace";
import { Group, Row } from "../components/settings/rows";
import { WorkspaceSection } from "../components/settings/WorkspaceSection";
import { openWhatsNew } from "../components/WhatsNew";
import { currentRelease } from "../lib/changelog";

type SectionId = "profile" | "appearance" | "tracking" | "notifications" | "offline" | "scouting" | "privacy" | "workspace" | "about";
type SectionGroup = "Personal" | "Workspace" | "About";
interface SectionDef { id: SectionId; label: string; hint: string; icon: ComponentType<{ className?: string }>; group: SectionGroup }

const ALL_SECTIONS: SectionDef[] = [
  { id: "profile", label: "Profile", hint: "Sign in to sync, your name, your account", icon: UserRound, group: "Personal" },
  { id: "appearance", label: "Appearance", hint: "Theme, background, density", icon: Palette, group: "Personal" },
  { id: "tracking", label: "My team & tracking", hint: "Your team, and the teams and events you follow", icon: Star, group: "Personal" },
  { id: "notifications", label: "Notifications", hint: "Push and match alerts for your teams", icon: BellRing, group: "Personal" },
  { id: "offline", label: "Offline data", hint: "Packs, cache and recordings on this device", icon: HardDriveDownload, group: "Personal" },
  { id: "scouting", label: "Scouting data", hint: "Export, import and clear your notes", icon: ClipboardList, group: "Personal" },
  { id: "privacy", label: "Account & privacy", hint: "What lives where, and how to remove it", icon: KeyRound, group: "Personal" },
  { id: "workspace", label: "Workspace", hint: "Shared by your Control Point workspace: defaults, template, entry policy", icon: Users, group: "Workspace" },
  { id: "about", label: "About", hint: "Data sources, engine and credits", icon: Info, group: "About" },
];
/** Old in-page anchors (#account …) → sections. */
const HASHES: Record<string, SectionId> = { account: "profile", appearance: "appearance", tracking: "tracking", notifications: "notifications", offline: "offline", scouting: "scouting", privacy: "privacy", about: "about" };

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  // The Workspace section: only for members of a Control Point workspace, while workspace scouting is on.
  const { user } = usePersonal();
  const workspaceScouting = useFlag("workspaceScouting");
  const inWorkspace = workspaceScouting && workspacesOf(user).list.length > 0;
  const SECTIONS = inWorkspace ? ALL_SECTIONS : ALL_SECTIONS.filter((s) => s.id !== "workspace");
  const loc = useLocation();
  const hash = loc.hash.replace(/^#/, "");
  const fromHash = Object.prototype.hasOwnProperty.call(HASHES, hash) ? HASHES[hash] : undefined;
  const requested = params.get("section") as SectionId | null;
  const active: SectionId = SECTIONS.some((s) => s.id === requested) ? requested! : fromHash ?? "profile";
  const current = SECTIONS.find((s) => s.id === active)!;
  useTitle(`Settings · ${current.label}`);
  const go = (id: SectionId) => setParams((x) => { const n = new URLSearchParams(x); n.set("section", id); n.delete("signin"); return n; }, { replace: true });

  // Esc leaves Settings (back where you came from), unless a field, dialog,
  // menu or a search box (its field, results or clear button) has it.
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox], [data-search-box]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) return;
      const idx = (window.history.state as { idx?: number } | null)?.idx;
      if (typeof idx === "number" && idx > 0) navigate(-1); else navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  // Phones: keep the active chip in view in the scrolling row.
  const navRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>("[aria-current=page]");
    if (el && window.matchMedia?.("(max-width: 1023px)").matches) el.scrollIntoView({ block: "nearest", inline: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [active]);

  return (
    <div>
      <PageHeader eyebrow="Settings" title={current.label} description={current.hint} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start">
          <ul ref={navRef} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            {SECTIONS.map((s, i) => {
              const on = s.id === active;
              const showGroup = i === 0 || SECTIONS[i - 1].group !== s.group;
              return (
                <li key={s.id} className="shrink-0">
                  {showGroup && <p className={cn("mb-1 hidden px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:block", i === 0 ? "mt-0" : "mt-5")}>{s.group}</p>}
                  <button
                    type="button" onClick={() => go(s.id)} aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:rounded-full max-lg:border max-lg:border-border",
                      on ? "text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {on && <motion.span layoutId="settings-active" className="absolute inset-0 rounded-lg bg-muted max-lg:rounded-full" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                    <s.icon className={cn("relative size-4 shrink-0", on && "text-accent")} />
                    <span className="relative whitespace-nowrap font-medium">{s.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={active} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
              {active === "profile" && <Profile signinFailed={params.get("signin") === "failed"} />}
              {active === "appearance" && <Appearance />}
              {active === "tracking" && <Tracking />}
              {active === "notifications" && <Notifications />}
              {active === "offline" && <OfflineData />}
              {active === "scouting" && <ScoutingData />}
              {active === "privacy" && <Privacy onOpen={go} />}
              {active === "workspace" && <WorkspaceSection />}
              {active === "about" && <About />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** A server or network error as a sentence to put in a message. */
const sentence = (m: unknown) => { const t = typeof m === "string" && m.trim() ? m.trim() : "Something went wrong"; return /[.!?]$/.test(t) ? t : `${t}.`; };

// --- Profile ---------------------------------------------------------------------

function Profile({ signinFailed }: { signinFailed: boolean }) {
  const { user, providers, sync, signOut, signedIn } = usePersonal();
  if (!providers) return <div className="skeleton h-48 rounded-xl" />;
  return (
    <div>
      {signinFailed && !user && <p className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground">That sign-in didn't go through. Try again, or use your email.</p>}
      {user ? <SignedIn user={user} sync={sync} onSignOut={signOut} /> : <SignIn providers={providers} onSignedIn={signedIn} />}
    </div>
  );
}

const BENEFITS = ["My team and the teams and events you track", "Your shortlist and saved predictions", "Scouting notes and video links", "Your settings, on every device"];

function SignIn({ providers, onSignedIn }: { providers: AuthProviders; onSignedIn: (u: AccountUser) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      toast.success("Signed in. This device's data is now in your account");
    } catch (e: any) { setError(e.message); setCode(""); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-accent/30 bg-card p-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-accent opacity-15 blur-3xl" />
        <p className="relative font-display text-xl font-semibold text-foreground">Keep your scouting everywhere</p>
        <p className="relative mt-1 max-w-xl text-sm text-muted-foreground">Browsing, search and predictions never need an account. Sign in only to keep these in sync across your devices:</p>
        <ul className="relative mt-4 grid gap-2 sm:grid-cols-2">
          {BENEFITS.map((b) => <li key={b} className="flex items-start gap-2 text-sm text-foreground"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />{b}</li>)}
        </ul>
      </div>
      {!providers.email && !providers.google && !providers.controlPoint ? <p className="text-sm text-muted-foreground">Sign-in isn't set up on this server. Everything still works on this device.</p> : (
        <Group title="Sign in" description="No password: we email you a 6-digit code.">
          {providers.email && (
            <Row label="Email" description={sent ? `We sent a code to ${email}. It expires in 10 minutes.` : "Your email is used only to send sign-in codes."} stack>
              {!sent ? (
                <form onSubmit={(e) => { e.preventDefault(); start(); }} className="flex max-w-md gap-2">
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" className="h-10" />
                  <Button type="submit" disabled={busy || !email}><Mail /> Send code</Button>
                </form>
              ) : (
                <div className="max-w-md space-y-3">
                  <OtpInput label="Code" value={code} onChange={(v) => { setCode(v); if (v.length === 6) verify(v); }} autoFocus disabled={busy} error={error ?? undefined} />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => { setSent(false); setCode(""); setError(null); }}>Use a different email</Button>
                    <Button variant="ghost" size="sm" onClick={start} disabled={busy}>Send a new code</Button>
                  </div>
                </div>
              )}
              {error && !sent && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </Row>
          )}
          {providers.google && (
            <Row label="Google" description="Use your Google account instead.">
              <Button variant="secondary" asChild><a href="/api/auth/google/start">Continue with Google</a></Button>
            </Row>
          )}
          {providers.controlPoint && (
            <Row label="Control Point" description="One account for both apps: use your Control Point sign-in, or sign in here with the same email and it's the same account.">
              <Button variant="secondary" asChild><a href="/api/auth/control-point/start"><KeyRound /> Continue with Control Point</a></Button>
            </Row>
          )}
        </Group>
      )}
    </div>
  );
}

const SYNC_LABEL: Record<string, string> = { synced: "Synced", syncing: "Syncing…", offline: "Offline: will sync", error: "Sync error: will retry", local: "This device only" };

function SignedIn({ user, sync, onSignOut }: { user: AccountUser; sync: string; onSignOut: () => Promise<void> }) {
  // The name as last saved (kept across section switches via the account object we update).
  const [saved, setSaved] = useState(user.displayName ?? "");
  const [name, setName] = useState(saved);
  const dirty = name.trim() !== saved;
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveName = async () => {
    setNameErr(null);
    setSavingName(true);
    try {
      await apiFetch("/api/me", { method: "PATCH", json: { displayName: name } });
      const next = name.trim();
      setSaved(next);
      user.displayName = next || null; // the shared account object: switching sections shows the saved name
      toast.success("Saved");
    } catch (e: any) {
      setNameErr(`Your name wasn't saved. ${sentence(e?.message)} Try again.`);
      nameInput.current?.focus();
    } finally { setSavingName(false); }
  };
  return (
    <div>
      <Group title="Details" description="How you appear in Control Scout.">
        <Row label="Display name" htmlFor="display-name" stack>
          <form onSubmit={(e) => { e.preventDefault(); saveName(); }} noValidate className="max-w-md">
            <div className="flex gap-2">
              <Input ref={nameInput} id="display-name" value={name} onChange={(e) => { setName(e.target.value); setNameErr(null); }} placeholder="Your name" className="h-10" maxLength={60}
                aria-invalid={nameErr ? true : undefined} aria-describedby={nameErr ? "display-name-error" : undefined} />
              <Button type="submit" disabled={!dirty || savingName}>Save changes</Button>
            </div>
            <FieldError id="display-name-error">{nameErr}</FieldError>
          </form>
        </Row>
      </Group>
      <Group title="Account facts">
        <Row label="Email" description="Used to sign in."><span className="text-sm text-foreground">{user.email}</span></Row>
        {user.controlPointLinked && <Row label="Control Point" description="One account with Control Point: the same email works on tryctrlpoint.org."><Badge variant="success"><Link2 /> Linked</Badge></Row>}
        <Row label="Sync" description="Your data follows you to every device you sign in on.">
          <Badge variant={sync === "synced" ? "success" : sync === "error" || sync === "offline" ? "destructive" : "secondary"}>{SYNC_LABEL[sync] ?? sync}</Badge>
        </Row>
        <Row label="Member since"><span className="text-sm text-muted-foreground">{new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span></Row>
      </Group>
      <Group title="Session">
        <Row label="Sign out" description="Your data stays on this device and in your account.">
          <Button variant="outline" onClick={() => onSignOut().then(() => toast("Signed out. Your data stays on this device"))}><LogOut /> Sign out</Button>
        </Row>
      </Group>
    </div>
  );
}

// --- Appearance --------------------------------------------------------------------

function Appearance() {
  const { state, update } = usePersonal();
  const s = state.settings;
  return (
    <div>
      <Group title="Display" description="Yours alone, on every device, inside a workspace's scout space too.">
        <Row label="Theme" description="System follows your device's light or dark setting.">
          <ToggleGroup type="single" value={s.theme} onValueChange={(v) => { if (v) update("settings", (x) => ({ ...x, theme: v as typeof s.theme })); }} aria-label="Theme">
            <ToggleGroupItem value="dark"><Moon className="size-3.5" /> Dark</ToggleGroupItem>
            <ToggleGroupItem value="light"><Sun className="size-3.5" /> Light</ToggleGroupItem>
            <ToggleGroupItem value="system"><Monitor className="size-3.5" /> System</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Density" description="Compact fits more on screen: tighter spacing in lists and tables.">
          <ToggleGroup type="single" value={s.density} onValueChange={(v) => { if (v) update("settings", (x) => ({ ...x, density: v as typeof s.density })); }} aria-label="Density">
            <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
            <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Group>
      <Group title="Background" description="This page's own background is the preview.">
        <Row label="Animated background" htmlFor="ambient" description="A slowly drifting grid and a light that follows your pointer. Always still if your device asks for reduced motion.">
          <Switch id="ambient" checked={s.ambient !== false} onCheckedChange={(v) => update("settings", (x) => ({ ...x, ambient: v }))} />
        </Row>
      </Group>
    </div>
  );
}

// --- My team & tracking ---------------------------------------------------------------

function Tracking() {
  const { state, update, set } = usePersonal();
  const move = (arr: number[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; };
  return (
    <div>
      <Group title="My team" description="Your team's next matches, odds and alerts are front and centre.">
        <Row label={state.myTeam ? <Link to={`/teams/${state.myTeam}`} className="font-mono hover:underline">{state.myTeam}</Link> : "No team yet"} description={state.myTeam ? "Shown on My team and first in search." : "Pick your team to get its dashboard and match alerts."}>
          {state.myTeam ? <Button variant="outline" size="sm" onClick={() => set("myTeam", null)}>Clear</Button> : <Button size="sm" asChild><Link to="/my-team">Pick my team</Link></Button>}
        </Row>
        {state.myTeam && (
          <Row label="Followed team dashboard" description="Next matches with predictions, recent results and your tracked teams, for the team you follow.">
            <Button variant="outline" size="sm" asChild><Link to="/my-team">Open</Link></Button>
          </Row>
        )}
      </Group>
      <Group title={`Tracked teams (${state.tracked.teams.length})`} description="Tracked teams show up on the My Team dashboard and come first in search. Order them however you like.">
        {!state.tracked.teams.length ? <Row label="None yet" description="Press Track on any team page." /> : state.tracked.teams.map((t, i) => (
          <div key={t} className="flex items-center gap-1 border-b border-border px-4 py-2.5 last:border-b-0">
            <Link to={`/teams/${t}`} className="flex-1 font-mono text-sm hover:underline">{t}</Link>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${t} up`} disabled={i === 0} onClick={() => update("tracked", (x) => ({ ...x, teams: move(x.teams, i, -1) }))}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${t} down`} disabled={i === state.tracked.teams.length - 1} onClick={() => update("tracked", (x) => ({ ...x, teams: move(x.teams, i, 1) }))}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${t}`} onClick={() => update("tracked", (x) => ({ ...x, teams: x.teams.filter((n) => n !== t) }))}><X /></Button>
          </div>
        ))}
      </Group>
      <Group title={`Tracked events (${state.tracked.events.length})`}>
        {!state.tracked.events.length ? <Row label="None yet" description="Press Track event on any event page." /> : state.tracked.events.map((ref) => {
          const [s, c] = ref.split(":");
          return (
            <div key={ref} className="flex items-center gap-1 border-b border-border px-4 py-2.5 last:border-b-0">
              <Link to={`/events/${s}/${c}`} className="flex-1 font-mono text-sm hover:underline">{c} <span className="text-muted-foreground">{s}</span></Link>
              <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${c}`} onClick={() => update("tracked", (x) => ({ ...x, events: x.events.filter((e) => e !== ref) }))}><X /></Button>
            </div>
          );
        })}
      </Group>
    </div>
  );
}

// --- Notifications ---------------------------------------------------------------------

function Notifications() {
  const { state, update, user } = usePersonal();
  const n = state.settings.notify;
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const ask = async () => { if (typeof Notification !== "undefined") setPerm(await Notification.requestPermission()); };
  const toggle = (k: "myTeamMatches" | "trackedTeams" | "upsets" | "eventStart", label: string, hint: string) => (
    <Row label={label} description={hint} htmlFor={`n-${k}`}>
      <Switch id={`n-${k}`} checked={n[k]} onCheckedChange={(v) => update("settings", (x) => ({ ...x, notify: { ...x.notify, [k]: v } }))} />
    </Row>
  );
  return (
    <div>
      <PushDevice signedIn={!!user} onPermission={setPerm} />
      <Group title="In a tab" description="While Control Scout is open in a tab, alerts are checked every 5 minutes. With browser permission they pop up even when the tab is in the background; otherwise they appear inside the app. A device with push on gets them by push instead.">
        <Row label="Browser notifications" description={perm === "denied" ? "Blocked: change it in your browser's site settings." : perm === "unsupported" ? "This browser doesn't support notifications." : "Lets alerts pop up outside the tab."}>
          <div className="flex items-center gap-2">
            <Badge variant={perm === "granted" ? "success" : perm === "denied" ? "destructive" : "secondary"}>{perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked" : perm === "unsupported" ? "Unavailable" : "Not asked yet"}</Badge>
            {perm === "default" && <Button size="sm" onClick={ask}>Allow</Button>}
          </div>
        </Row>
      </Group>
      <Group title="What to alert me about" description="Yours alone: a workspace never changes them. They apply to push and to alerts in a tab.">
        {toggle("myTeamMatches", "My team's matches", "Before your team's next scheduled match, with the odds: 15 minutes ahead by push, up to 30 in a tab")}
        {toggle("trackedTeams", "Tracked teams' matches", "The same, for teams you track")}
        {toggle("upsets", "Upsets", `When the favourite loses at an event you follow (one you track, or one your teams are at). By push: our pre-match call gave the losing side ${Math.round(UPSET_THRESHOLD * 100)}% or more`)}
        {toggle("eventStart", "Event start", "When an event you follow gets under way: its first result, or its first scheduled match time")}
      </Group>
      <InboxToggles />
    </div>
  );
}

/** The notification inbox's per-kind switches (the bell, top right). A kind switched off makes no items at all. */
function InboxToggles() {
  const { state, update, user } = usePersonal();
  const n = state.settings.notify;
  const kinds = INBOX_CATEGORIES.filter((c) => !INBOX_CATEGORY_INFO[c].ownerOnly || user?.isOwner);
  return (
    <Group title="Notification inbox" description={user
      ? "What the bell at the top right collects for you, from every workspace you're in. Read state syncs across your devices."
      : "Sign in to get the bell at the top right: assignments, changes to your entries and news from your workspaces."}>
      {kinds.map((c) => {
        const key = INBOX_TOGGLE[c], info = INBOX_CATEGORY_INFO[c];
        return (
          <Row key={c} label={info.label} description={info.hint} htmlFor={`n-${key}`}>
            <Switch id={`n-${key}`} checked={inboxCategoryOn(n, c)} onCheckedChange={(v) => update("settings", (x) => ({ ...x, notify: { ...x.notify, [key]: v } }))} />
          </Row>
        );
      })}
    </Group>
  );
}

// --- Offline data ---------------------------------------------------------------------------

function OfflineData() {
  const [est, setEst] = useState<{ usage?: number; quota?: number } | null>(null);
  const pack = packStatus();
  const saved = useSavedSeasons();
  useEffect(() => { navigator.storage?.estimate?.().then(setEst, () => setEst({})); }, [saved]);
  const remove = (season: number) => import("../lib/offline/seasons").then((s) => s.removeSeason(season)).then(() => toast(`${seasonLabel(season)} removed from this device`), (e) => toast.error(e.message));
  return (
    <div>
      <Group title="Saved seasons" description={<>A saved season's team pages, event pages and search work on this device with no connection, showing the data as of its release. <Link to="/download" className="underline">Save a season</Link></>}>
        {saved.length ? saved.map((s) => (
          <Row key={s.season} label={seasonLabel(s.season)}
            description={`${fmtBytes(s.bytes)} · saved ${ago(new Date(s.savedAt).toISOString())}${s.dataAsOf ? ` · results up to ${new Date(s.dataAsOf).toLocaleDateString()}` : ""}`}>
            <Button variant="outline" size="sm" onClick={() => remove(s.season)}><X /> Remove</Button>
          </Row>
        )) : (
          <Row label="None saved yet" description="Save a season before an event to browse it with no wifi.">
            <Button variant="outline" size="sm" asChild><Link to="/download"><HardDriveDownload /> Save a season</Link></Button>
          </Row>
        )}
      </Group>
      <Group title="Offline pack" description={<>Packs let predictions run on this device with no connection, e.g. at a venue with no signal. <Link to="/download" className="underline">Download page</Link></>}>
        <Row label="Lite pack on this device" description={pack ? `Version ${pack.version} · ${fmtBytes(pack.bytes)} · saved ${ago(new Date(pack.savedAt).toISOString())}` : "None saved yet."}>
          <Button variant="outline" size="sm" asChild><Link to="/download"><Download /> {pack ? "Check for updates" : "Get the pack"}</Link></Button>
        </Row>
        <Row label="Storage used by this site" description="Cached pages, packs, saved seasons and recordings.">
          <span className="text-sm tabular-nums text-foreground">{est?.usage != null ? `${fmtBytes(est.usage)}${est.quota ? ` of ${fmtBytes(est.quota)}` : ""}` : "—"}</span>
        </Row>
      </Group>
      <Group title="Clean up">
        <Row label="Cached data" description="Pages and data saved for offline use. They're downloaded again when needed.">
          <Button variant="outline" size="sm" onClick={() => { if ("caches" in window) caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => toast.success("Cached data cleared")); else toast("Nothing cached"); }}>Clear cached data</Button>
        </Row>
        <Row label="Recordings" description="Match videos recorded in the app live only on this device.">
          <Button variant="outline" size="sm" onClick={() => clearRecordings().then(() => toast.success("Recordings deleted from this device"), (e) => toast.error(e.message))}>Delete all recordings</Button>
        </Row>
      </Group>
    </div>
  );
}

// --- Scouting data ------------------------------------------------------------------------------

function ScoutingData() {
  const exportJson = () => downloadJson("control-scout-scouting.json", scoutExportJson());
  const exportCsv = () => downloadCsv("control-scout-scouting", localScoutEntries().filter((e) => !e.deleted).map((e) => ({ season: e.season, team: e.team, event: e.eventCode, match: e.matchLabel, kind: e.kind, notes: e.notes, updated: isoOrBlank(e.updatedAt), ...e.data })));
  // Every row is checked before anything is stored (src/lib/scoutImport.ts). Audit E3: a chosen file opens a preview
  // first (ImportPreviewDialog); only Import writes, and the message counts only what was saved.
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ key: number; open: boolean; name: string; rows: unknown[]; preview: ImportPreview } | null>(null);
  // Closing keeps the last preview mounted (closed) so the dialog animates out; the next file gets a fresh one (key).
  const closePreview = () => setPending((p) => p && { ...p, open: false });
  const importJson = (file: File) => {
    file.text().then((t) => {
      const rows = importRows(t);
      if (!rows) { toast.error("That file isn't a Control Scout scouting export"); return; }
      if (!rows.length) { toast.error("That file has no scouting entries to import."); return; }
      setPending((p) => ({ key: (p?.key ?? 0) + 1, open: true, name: file.name, rows, preview: previewScoutImport(rows) }));
    }).catch(() => toast.error("Couldn't read that file"));
  };
  // Keep the preview true to the device while it's open (a sync or another tab can change entries meanwhile).
  const previewOpen = !!pending?.open;
  useEffect(() => {
    if (!previewOpen) return;
    const refresh = () => setPending((p) => p && p.open ? { ...p, preview: previewScoutImport(p.rows) } : p);
    window.addEventListener(SCOUT_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(SCOUT_CHANGED, refresh); window.removeEventListener("storage", refresh); };
  }, [previewOpen]);
  const runImport = (policy: DuplicatePolicy) => {
    if (!pending?.open) return;
    // Sorted again against the device as it is now. If that would add or replace anything the scout didn't see,
    // nothing is written: the dialog shows the new preview (with its backup offer) to review again.
    const now = previewScoutImport(pending.rows);
    if (planKey(now, policy) !== planKey(pending.preview, policy)) {
      setPending({ ...pending, preview: now });
      toast.warning("Entries on this device changed while you were reviewing. Nothing was imported: check the updated preview, then import again.");
      return;
    }
    closePreview(); // first, so the saves below don't refresh a preview that's closing
    const m = importMessage(applyScoutImport(now, policy));
    toast[m.tone](m.text, m.tone === "success" ? undefined : { duration: 15_000 });
  };
  // Live count: re-read whenever scouting data changes (import, clear, edits elsewhere).
  const [count, setCount] = useState(() => localScoutEntries().filter((e) => !e.deleted).length);
  useEffect(() => {
    const refresh = () => setCount(localScoutEntries().filter((e) => !e.deleted).length);
    window.addEventListener("cs-scout-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("cs-scout-changed", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  return (
    <div>
      <Group title="Your notes" description="Scouting notes are private to you.">
        <Row label="Entries on this device"><span className="text-sm tabular-nums text-foreground">{count}</span></Row>
        <Row label="Export" description="JSON keeps everything for re-importing; CSV opens in a spreadsheet.">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportJson}><Download /> Export JSON</Button>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download /> Export CSV</Button>
          </div>
        </Row>
        <Row label="Import" description="A JSON export from Control Scout, from any device. You'll see what it holds before anything changes.">
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload /> Import JSON</Button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden data-scout-import=""
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importJson(f); }} />
        </Row>
        <Row label="Clear on this device" description="Removes the notes stored on this device. Notes synced to your account stay there.">
          <Button variant="outline" size="sm" onClick={() => { clearLocalScouting(); toast("Scouting notes cleared from this device"); }}>Clear</Button>
        </Row>
      </Group>
      {pending && <ImportPreviewDialog key={pending.key} open={pending.open} fileName={pending.name} preview={pending.preview} onCancel={closePreview} onImport={runImport} />}
    </div>
  );
}

// --- Account & privacy ------------------------------------------------------------------------

function Privacy({ onOpen }: { onOpen: (id: SectionId) => void }) {
  const { clearLocal, user, signOut } = usePersonal();
  const consent = useConsent();
  // The hold button's done state follows the request: it resets (and the error shows under it) if deleting fails.
  const [deleted, setDeleted] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const delBox = useRef<HTMLDivElement>(null);
  const del = async () => {
    setDelErr(null);
    setDeleted(true);
    try { await apiFetch("/api/me", { method: "DELETE", json: { confirm: "DELETE" } }); clearLocal(); await signOut(); toast.success("Account deleted"); }
    catch (e: any) {
      setDeleted(false);
      setDelErr(`Couldn't confirm that your account was deleted. ${sentence(e?.message)} Check your account before trying again.`);
      delBox.current?.querySelector("button")?.focus();
    }
  };
  return (
    <div>
      <Group title="What lives where">
        <Row label="Public data" description="Teams, events, matches and predictions, from FIRST and FTC Scout. No account involved." />
        <Row label="On this device" description="My team, tracking, shortlist, settings, saved predictions, scouting notes, video links, and every recording you make. Recordings never leave the device." />
        <Row label="In your account" description="Signed in only: the same list minus recordings. Your email is used only to send sign-in codes." />
        <Row label="Only on this device, never sent" description="Which scout space you last opened, list or grid view, and the list of entries waiting to sync (the entries themselves go up when you're back online)." />
        <Row label="Shared with a workspace" description="Workspace members only: the workspace's scout entries, its template and its defaults for new entries, which its admins set. Your own settings stay yours." />
        <Row label="Never" description="No ads, no third-party trackers, no selling data. Anonymous usage stats only if you allow them." />
        <Row label="Privacy policy" description="The details: cookies, storage, sign-in and your choices."><Button variant="outline" size="sm" asChild><Link to="/privacy">Read it</Link></Button></Row>
      </Group>
      <Group title="Privacy choices">
        <Row label="Essential storage" description="Sign-in, preferences and offline data, kept so the app works.">
          <Badge>Always on</Badge>
        </Row>
        <Row label="Anonymous usage statistics" htmlFor="consent-analytics"
          description={consent.signal
            ? "Off: your browser sends a Global Privacy Control or Do Not Track signal, and Control Scout respects it."
            : <>Counts page views with no cookies, no IDs and no IP address. <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link></>}>
          <Switch id="consent-analytics" checked={consent.analytics} disabled={consent.signal} onCheckedChange={consent.setAnalytics} />
        </Row>
      </Group>
      <Group title="Remove data">
        <Row label="Clear all local data" description={user ? "Wipes this device. Your account data is untouched." : "Wipes everything Control Scout stored on this device."}>
          <Button variant="outline" size="sm" onClick={() => { clearLocal(); clearLocalScouting(); try { localStorage.clear(); } catch { /* storage unavailable */ } resetConsent(); resetTour(); resetInstall(); toast.success("Local data cleared"); }}>Clear</Button>
        </Row>
        {user ? (
          <Row label="Delete account" description="Removes your account and everything synced to it: tracking, shortlist, scouting notes, video links. Recordings on this device are separate (Offline data).">
            <div ref={delBox}>
              <HoldToConfirm label="Hold to delete account" confirmedLabel="Deleted" tone="danger" onConfirm={del} confirmed={deleted} aria-describedby={delErr ? "delete-account-error" : undefined} />
              <FieldError id="delete-account-error" className="max-w-xs">{delErr}</FieldError>
            </div>
          </Row>
        ) : (
          <Row label="Account" description="You're not signed in, so there's no account data.">
            <Button variant="ghost" size="sm" onClick={() => onOpen("profile")}>Sign in</Button>
          </Row>
        )}
      </Group>
    </div>
  );
}

// --- About ------------------------------------------------------------------------------------

const BUG_MIN = 10;

/** "Report a bug": the visitor's words, sanitized, plus the last error this page load hit (src/lib/errorReporting.ts). */
function ReportBug() {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const ready = text.trim().length >= BUG_MIN && !sending;
  const send = () => {
    if (!ready) return;
    setSending(true);
    void sendReport(manualReport(text)).then((r) => {
      setSending(false);
      if (r === "sent") { setText(""); toast.success("Thanks, your report is on its way to the developers"); }
      else if (r === "limited") toast("You've sent several reports this hour. Please try again later");
      else toast.error("Couldn't send the report just now. Try again in a moment");
    });
  };
  return (
    <Row label="Report a bug" htmlFor="bug-report" stack
      description={<>Say what went wrong. We send your words with the app version, your browser and the last error this visit hit, if any. Never your notes or personal details, so leave names and contact details out.</>}>
      <Textarea id="bug-report" rows={3} maxLength={REPORT_LIMITS.description} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: the odds tab on an event page stays blank" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-muted-foreground">{text.length}/{REPORT_LIMITS.description}</span>
        <Button variant="secondary" size="sm" className="max-sm:h-10" disabled={!ready} onClick={send}><Bug /> {sending ? "Sending…" : "Send report"}</Button>
      </div>
    </Row>
  );
}

const APP_RELEASE = currentRelease();

function About() {
  const meta = useMeta();
  // Error reports switched off by the owner: no bug report box (the contact form below still works).
  const reportsOn = useFlag("errorReporting");
  return (
    <div>
      <Group title="This app">
        <Row label="What's new" description={`Every release of Control Scout, newest first.${APP_RELEASE ? ` This is v${APP_RELEASE}.` : ""}`}>
          <Button variant="outline" size="sm" onClick={openWhatsNew}><Megaphone /> What's new</Button>
        </Row>
        <Row label="Prediction engine" description="Shared with Control Point, so the numbers match."><span className="font-mono text-sm text-foreground">v{meta?.engineVersion ?? "…"}</span></Row>
        <Row label="Data updated" description="Synced from FIRST; every 15 minutes on event days."><span className="text-sm text-foreground">{ago(meta?.dataAsOf)}</span></Row>
        <Row label="How predictions work"><Button variant="outline" size="sm" asChild><Link to="/methodology">Read it</Link></Button></Row>
        {reportsOn && <ReportBug />}
        <Row label="FAQ" description="Quick answers about the data, predictions, scouting, offline use and privacy."><Button variant="outline" size="sm" asChild><Link to="/faq">Read the FAQ</Link></Button></Row>
        <Row label="Contact" description="Report a bug or wrong data, suggest a feature, or ask a question."><Button variant="outline" size="sm" asChild><Link to="/contact">Contact us</Link></Button></Row>
      </Group>
      <Group title="Control Point">
        <Row label="Manage your team" description="Control Point is the team workspace: members, tasks, attendance and more.">
          <Button variant="outline" size="sm" asChild><a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener">Open Control Point <ExternalLink /></a></Button>
        </Row>
      </Group>
      <p className="text-xs text-muted-foreground">Match data © <a className="underline" href="https://ftc-events.firstinspires.org" target="_blank" rel="noreferrer noopener">FIRST</a> (FIRST Events API), with <a className="underline" href="https://ftcscout.org" target="_blank" rel="noreferrer noopener">FTC Scout</a> as a fallback source. FTC Control Scout is not affiliated with or endorsed by FIRST®. FIRST Tech Challenge is a registered trademark of FIRST.</p>
    </div>
  );
}
