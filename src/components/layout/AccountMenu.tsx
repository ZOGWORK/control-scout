// The account controls at the foot of the sidebar (and of the phone's menu sheet), Control Point style.
// Signed in: one row with the avatar and its status dot, the name over the sync status ("Online" only when
// it is), and Settings / Sign out icon buttons; the avatar opens the account panel above it. Signed out: a
// "Sign in" button that opens the sign-in panel (not a dialog: nothing behind it is blocked, and it closes on
// Esc or a click elsewhere) with email code, Google / Discord / GitHub (run by Control Point) and Control
// Point. When a sign-in finds an existing Control Point account, a short "merging your accounts" screen
// plays and that account's shortlist joins this one. Right after an email is proven, it says whether that
// address already has a Control Point account (and its teams). That's only ever said to the signed-in
// owner, so it can't be used to probe someone else's email.
//
// The sidebar and the menu sheet each draw a footer, so the panel's state (open, the email step, a merge)
// lives once in AccountProvider and both read it: only one of them is on screen at a time.
import { createContext, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AnimatePresence } from "motion/react";
import { m } from "../motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, ExternalLink, KeyRound, LogIn, LogOut, Mail, Settings, UserRound } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { SIGNED_IN, usePersonal, type AccountUser, type SyncStatus } from "../../lib/personal";
import { OtpInput } from "../arc/otp-input/otp-input";
import { Button } from "../ui/button";
import { Input } from "../ui/basic";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { MergeScreen, ProviderButtons, useShortlistMerge } from "./AccountMerge";

const SYNC_LABEL: Record<string, string> = { synced: "Synced", syncing: "Syncing…", offline: "Offline: will sync", error: "Sync error: will retry", local: "This device only" };

/** The footer row's status line and dot. "Online" only while syncing works; a device that can't reach the account reads "Offline". */
const STATUS: Record<SyncStatus, { label: string; dot: string }> = {
  synced: { label: "Online", dot: "bg-success" },
  syncing: { label: "Syncing…", dot: "bg-success" },
  offline: { label: "Offline", dot: "bg-text-muted" },
  error: { label: "Sync error", dot: "bg-warning" },
  local: { label: "Connecting…", dot: "bg-text-muted" },
};

interface EmailFlow { email: string; sent: boolean }

interface AccountPanelApi {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** The email-code step lives here, not in the panel: closing the panel mid-sign-in keeps the code you were sent. */
  flow: EmailFlow;
  setFlow: Dispatch<SetStateAction<EmailFlow>>;
  /** A sign-in that found an existing Control Point account: the merge screen plays in the panel. */
  merging: AccountUser | null;
  added: number | null;
  endMerge: () => void;
}

const AccountPanelContext = createContext<AccountPanelApi | null>(null);

export function useAccountPanel(): AccountPanelApi {
  const api = useContext(AccountPanelContext);
  if (!api) throw new Error("useAccountPanel needs an AccountProvider");
  return api;
}

/** The account toggle on screen (the sidebar's, or the menu sheet's when it's open), for Escape to return to. */
function shownToggle(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-account-toggle]")];
  return all.find((el) => el.getClientRects().length > 0) ?? all.at(-1) ?? null;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user, syncReady } = usePersonal();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  // Close on navigation, Esc, or a click outside every account footer.
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.("[data-account-box]")) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); shownToggle()?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const [flow, setFlow] = useState<EmailFlow>({ email: "", sent: false });
  const [merging, setMerging] = useState<AccountUser | null>(null);
  // What to merge, one per sign-in (`seq`), kept after the screen finishes so a slow sync still gets the shortlist in.
  const [mergeTarget, setMergeTarget] = useState<{ user: AccountUser; seq: number } | null>(null);
  const seq = useRef(0);
  const startMerge = (u: AccountUser) => { setMerging(u); setMergeTarget({ user: u, seq: ++seq.current }); setOpen(true); };
  // Every explicit sign-in (this panel, Settings, …) announces itself; an existing Control Point account merges.
  useEffect(() => {
    const on = (e: Event) => { const u = (e as CustomEvent<AccountUser>).detail; if (u?.controlPoint?.member) startMerge(u); };
    window.addEventListener(SIGNED_IN, on);
    return () => window.removeEventListener(SIGNED_IN, on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Signed out, or a different account: a pending merge belongs to the old one, so drop it.
  useEffect(() => {
    if (mergeTarget && user?.id !== mergeTarget.user.id) { setMergeTarget(null); setMerging(null); setAdded(null); }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The shortlist merge runs here (always mounted, so closing the panel can't skip it), once this
  // device's data is the account's: the added teams then sync and aren't overwritten by the first pull.
  const mergeShortlist = useShortlistMerge();
  const [added, setAdded] = useState<number | null>(null);
  const mergedFor = useRef<number | null>(null); // the sign-in (seq) already merged
  useEffect(() => {
    // Only into the account that signed in (never another one signed in since), once per sign-in.
    if (!mergeTarget || !syncReady || user?.id !== mergeTarget.user.id || mergedFor.current === mergeTarget.seq) return;
    mergedFor.current = mergeTarget.seq;
    const n = mergeShortlist(mergeTarget.user.controlPoint?.shortlist ?? []);
    setAdded(n);
    if (!merging && n) toast.success(`${n} team${n === 1 ? "" : "s"} from your Control Point shortlist added`);
  }, [mergeTarget, syncReady, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back from Google / Discord / GitHub / Control Point (?signin=ok): open the panel, merging if there's an account to merge.
  const nav = useNavigate();
  const back = new URLSearchParams(loc.search).get("signin");
  useEffect(() => {
    if (back !== "ok" || !user) return;
    setOpen(true);
    if (user.controlPoint?.member) startMerge(user);
    const q = new URLSearchParams(loc.search); q.delete("signin");
    nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : "" }, { replace: true });
  }, [back, user]); // eslint-disable-line react-hooks/exhaustive-deps
  const endMerge = () => { setMerging(null); setAdded(null); };
  return <AccountPanelContext.Provider value={{ open, setOpen, flow, setFlow, merging, added, endMerge }}>{children}</AccountPanelContext.Provider>;
}

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60";

/** The icon rail shows a control's name in a tooltip beside it. */
function Tip({ on, label, children }: { on: boolean; label: string; children: ReactNode }) {
  if (!on) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function Avatar({ initial, dot }: { initial: string; dot: string }) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent-text">
      {initial}
      <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-secondary", dot)} aria-hidden />
    </span>
  );
}

/**
 * `place`: "sidebar" (the full sidebar: one row, the panel opens above it), "rail" (the icon rail: the avatar
 * and Settings stacked, names in tooltips, the panel opens beside it) or "sheet" (the phone's menu sheet).
 * `onNavigate`: called by every link in it (Settings, Account settings, a team), even to the page already open.
 */
export function AccountFooter({ place, onNavigate }: { place: "sidebar" | "rail" | "sheet"; onNavigate?: () => void }) {
  const { user, sync, offlineAccount, signOut } = usePersonal();
  const { open, setOpen, flow, setFlow, merging, added, endMerge } = useAccountPanel();
  const panelId = useId();
  const rail = place === "rail";
  const name = user ? user.displayName || user.email || "Your account" : "";
  const status = offlineAccount ? STATUS.offline : STATUS[sync] ?? STATUS.local;
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const leave = () => { setOpen(false); onNavigate?.(); };
  const signOutNow = () => signOut().then(() => { setOpen(false); toast("Signed out. Your data stays on this device"); });
  const toggle = { "data-account-toggle": "", onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-controls": panelId };
  const settings = (
    <Tip on={rail} label="Settings">
      <Link to="/settings" onClick={leave} aria-label="Settings" className={iconButton}><Settings className="size-[18px]" /></Link>
    </Tip>
  );
  return (
    // While the panel is open it owns Escape, so the menu sheet around it stays open (src/components/ui/overlay.tsx).
    <div data-account-box data-slot="account-panel" data-esc-owner={open ? "" : undefined} className="relative">
      {rail ? (
        <div className="flex flex-col items-center gap-1">
          {settings}
          <Tip on label={user ? `${name}: ${status.label}` : "Sign in"}>
            <button type="button" {...toggle} aria-label={user ? `Account: ${name}` : "Sign in"}
              className={cn("flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60", user ? "hover:bg-text-base/[0.06]" : "text-text-muted hover:bg-text-base/[0.06] hover:text-text-base")}>
              {user ? <Avatar initial={initial} dot={status.dot} /> : <LogIn className="size-[18px]" />}
            </button>
          </Tip>
        </div>
      ) : (
        // The same height signed in or out, so nothing moves when you sign in.
        <div className="flex h-11 items-center gap-1">
          {user ? (
            <button type="button" {...toggle} aria-label={`Account: ${name}`}
              className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 text-left outline-none hover:bg-text-base/[0.05] focus-visible:ring-2 focus-visible:ring-ring/60">
              <Avatar initial={initial} dot={status.dot} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium leading-tight">{name}</span>
                <span className="block truncate text-xs leading-tight text-text-muted">{status.label}</span>
              </span>
            </button>
          ) : (
            <Button type="button" variant="outline" size="sm" {...toggle} className="h-9 flex-1"><LogIn /> Sign in</Button>
          )}
          {settings}
          {user && <button type="button" onClick={signOutNow} aria-label="Sign out" className={iconButton}><LogOut className="size-[18px]" /></button>}
        </div>
      )}
      <AnimatePresence>
      {open && (
        <m.div id={panelId} role="region" aria-label={user ? "Your account" : "Sign in"} key="panel"
          initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }} style={{ transformOrigin: "bottom left" }}
          className={cn("absolute z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]",
            place === "rail" ? "bottom-0 left-full ml-3 w-96" : place === "sidebar" ? "bottom-full left-0 mb-2 w-96" : "inset-x-0 bottom-full mb-2")}>
          {merging ? <MergeScreen user={merging} added={added} onDone={endMerge} />
            : user ? <SignedInPanel user={user} onClose={leave} onSignOut={signOutNow} />
            : <SignInPanel flow={flow} setFlow={setFlow} />}
        </m.div>
      )}
      </AnimatePresence>
    </div>
  );
}

function SignInPanel({ flow, setFlow }: { flow: EmailFlow; setFlow: Dispatch<SetStateAction<EmailFlow>> }) {
  const { providers, signedIn } = usePersonal();
  const { email, sent } = flow;
  const setEmail = (v: string) => setFlow({ email: v, sent: false });
  const setSent = (v: boolean) => setFlow((f) => ({ ...f, sent: v }));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!providers) return <div className="skeleton h-32 rounded-lg" />;
  const via = providers.via ?? [];
  const any = providers.email || providers.google || providers.controlPoint || via.length > 0;
  const start = async () => {
    setBusy(true); setError(null);
    const asked = email;
    // Only if the address is still the one asked for: a late reply never overwrites a newer email.
    try { await apiFetch("/api/auth/email/start", { method: "POST", json: { email: asked } }); setFlow((f) => (f.email === asked ? { email: asked, sent: true } : f)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const verify = async (c: string) => {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ user: AccountUser }>("/api/auth/email/verify", { method: "POST", json: { email, code: c } });
      await signedIn(r.user); // the panel switches to the signed-in view, with the Control Point result
      setFlow({ email: "", sent: false }); // signedIn announced the sign-in: the merge (if any) starts from that
      if (!r.user.controlPoint?.member) toast.success("Signed in. This device's data is now in your account");
    } catch (e: any) { setError(e.message); setCode(""); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="font-display text-base font-semibold">Sign in</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Optional. Keeps my team, tracked teams, shortlist and scouting notes on all your devices. One account with Control Point.</p>
      </div>
      {!any ? <p className="text-sm text-muted-foreground">Sign-in isn't set up on this server. Everything still works on this device.</p> : (
        <>
          {providers.email && (!sent ? (
            <form onSubmit={(e) => { e.preventDefault(); start(); }} className="space-y-2">
              <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" className="h-10" autoFocus />
              <Button type="submit" className="w-full" disabled={busy || !email}><Mail /> Email me a code</Button>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Enter the 6-digit code sent to <span className="text-foreground">{email}</span>.</p>
              <OtpInput label="Code" value={code} onChange={(v) => { setCode(v); if (v.length === 6) verify(v); }} autoFocus disabled={busy} error={error ?? undefined} />
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => { setSent(false); setCode(""); setError(null); }}>Different email</Button>
                <Button variant="ghost" size="sm" onClick={start} disabled={busy}>New code</Button>
              </div>
            </div>
          ))}
          {(providers.google || providers.controlPoint || via.length > 0) && (
            <div className="space-y-2">
              {providers.email && <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">or</p>}
              <ProviderButtons via={via} />
              {providers.controlPoint && <Button variant="secondary" className="w-full" asChild><a href="/api/auth/control-point/start"><KeyRound /> Continue with Control Point</a></Button>}
              {providers.google && !via.includes("google") && <Button variant="secondary" className="w-full" asChild><a href="/api/auth/google/start">Continue with Google</a></Button>}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">New here? Any of these creates your account. Already use Control Point? Sign in the same way: it's the same account, and your teams and shortlist come with it.</p>
        </>
      )}
    </div>
  );
}

function SignedInPanel({ user, onClose, onSignOut }: { user: AccountUser; onClose: () => void; onSignOut: () => void }) {
  const { sync } = usePersonal();
  const cp = user.controlPoint;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><UserRound className="size-5" /></span>
        <div className="min-w-0">
          <p className="truncate font-medium">{user.displayName || user.email}</p>
          {user.displayName && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          <p className="text-[11px] text-muted-foreground">{SYNC_LABEL[sync] ?? sync}</p>
        </div>
      </div>
      {cp ? (
        <div className={cn("rounded-lg border p-3 text-sm", cp.member ? "border-success/40 bg-success/[0.06]" : "border-border")}>
          {cp.member ? (
            <>
              <p className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-4 text-success" /> Control Point account found</p>
              <p className="mt-1 text-xs text-muted-foreground">It's the same account: this email signs in to both apps.</p>
              {cp.teams.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {cp.teams.map((t) => <li key={`${t.teamNumber}:${t.name}`}>{t.teamNumber ? <Link to={`/teams/${t.teamNumber}`} onClick={onClose} className="font-mono font-semibold hover:underline">{t.teamNumber}</Link> : null} {t.name}</li>)}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="font-medium">No Control Point account yet</p>
              <p className="mt-1 text-xs text-muted-foreground">This email works there too: sign in to Control Point with it and it's the same account.</p>
            </>
          )}
          <a href={cp.url} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline">Open Control Point <ExternalLink className="size-3" /></a>
        </div>
      ) : user.controlPointLinked ? <p className="text-xs text-muted-foreground">Linked with Control Point.</p> : null}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" asChild><Link to="/settings?section=profile" onClick={onClose}><Settings /> Account settings</Link></Button>
        <Button variant="ghost" size="sm" onClick={onSignOut}><LogOut /> Sign out</Button>
      </div>
    </div>
  );
}
