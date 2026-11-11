// Usernames (docs/contributors.md): every account gets one, introduced gently. Viewing never needs one; adding a
// match video, liking, reporting and getting verified do, with the account's actual name (the credit "Video by …").
//
// Once per sign-in, an account with no username is asked (the dialog below, "Introducing usernames"); "Browse first"
// lets it carry on with nothing blocked, and Home then shows the same words as a banner until it's dismissed too. Both
// come back at the next sign-in. A contributing action calls ensure(): with no username or name, the dialog opens and
// the action waits for it (refused when it's closed unset). There is no deadline: nothing ever locks an account out.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AtSign, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/overlay";
import { Button } from "./ui/button";
import { FieldError, Input, Label } from "./ui/basic";
import { usePersonal, type AccountUser } from "../lib/personal";
import { apiFetch } from "../lib/api";
import { myTeamsOf } from "../lib/myTeams";
import { creditLine, NAME_MAX, USERNAME_MAX, USERNAME_PROBLEM_TEXT, usernameProblem } from "../shared/username";

/** What the dialog is opened for: the sign-in introduction, a brand-new account finishing sign-up, or an action. */
type Mode = "intro" | "signup" | "required";

interface AccountSetupApi {
  /** Signed in with both a username and an actual name. */
  ready: boolean;
  /** Before a contributing action: true when the account has both (asking for them first if not). */
  ensure(why?: string): Promise<boolean>;
  /** Open the dialog (Settings, the Home banner). */
  open(): void;
}
const Ctx = createContext<AccountSetupApi>({ ready: false, ensure: async () => false, open: () => {} });
export const useAccountSetup = () => useContext(Ctx);

/** An account missing either: the username, or the actual name (display name). */
export const needsSetup = (u: AccountUser | null): boolean => !!u && (!u.username || !u.displayName?.trim());

// Per sign-in, on this device: "prompted" (asked; Home shows the banner) or "done" (the banner dismissed too).
const PHASE_KEY = "cs-username-intro";
type Phase = "prompted" | "done";
const phaseKey = (u: AccountUser) => `${u.id}:${u.session ?? "-"}`;
function readPhase(u: AccountUser): Phase | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PHASE_KEY) ?? "null") as { k?: string; p?: Phase } | null;
    return raw?.k === phaseKey(u) ? raw.p ?? null : null;
  } catch { return memoryPhase.get(phaseKey(u)) ?? null; }
}
const memoryPhase = new Map<string, Phase>();
function writePhase(u: AccountUser, p: Phase) {
  memoryPhase.set(phaseKey(u), p);
  try { localStorage.setItem(PHASE_KEY, JSON.stringify({ k: phaseKey(u), p })); } catch { /* blocked: kept for this page view */ }
  window.dispatchEvent(new Event(PHASE_EVENT));
}
const PHASE_EVENT = "cs-username-phase";

/** Created in the last 15 minutes: it's finishing sign-up, not being introduced to a new thing. */
const isNew = (u: AccountUser) => Date.now() - Date.parse(u.createdAt) < 15 * 60_000;

export function AccountSetupProvider({ children }: { children: ReactNode }) {
  const { user } = usePersonal();
  const [mode, setMode] = useState<Mode | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const waiting = useRef<((ok: boolean) => void)[]>([]);
  const userRef = useRef(user);
  userRef.current = user;
  const settle = (ok: boolean) => { const w = waiting.current; waiting.current = []; w.forEach((f) => f(ok)); };

  // Once per sign-in: an account with no username is introduced to them (never on the owner's console or a bare page).
  useEffect(() => {
    if (!user || user.username || mode) return;
    if (readPhase(user)) return;
    if (/^\/(owner|pit)(\/|$)/i.test(window.location.pathname)) return;
    const t = setTimeout(() => setMode(isNew(user) ? "signup" : "intro"), 600);
    return () => clearTimeout(t);
  }, [user, mode]);

  const ensure = useCallback((reason?: string) => {
    const u = userRef.current;
    if (!u) return Promise.resolve(false);
    if (!needsSetup(u)) return Promise.resolve(true);
    setWhy(reason ?? null);
    setMode("required");
    return new Promise<boolean>((resolve) => { waiting.current.push(resolve); });
  }, []);
  const open = useCallback(() => { if (userRef.current) { setWhy(null); setMode("required"); } }, []);
  const close = (saved: boolean) => {
    const u = userRef.current;
    // The introduction closed unset: Home's banner reminds until it's dismissed; set: nothing more to say.
    if (u && (mode === "intro" || mode === "signup")) writePhase(u, saved ? "done" : "prompted");
    if (u && saved) writePhase(u, "done");
    setMode(null);
    settle(saved);
  };
  const api = useMemo<AccountSetupApi>(() => ({ ready: !!user && !needsSetup(user), ensure, open }), [user, ensure, open]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {user && mode && <SetupDialog user={user} mode={mode} why={why} onClose={close} />}
    </Ctx.Provider>
  );
}

const COPY: Record<Mode, { title: string; body: string; dismiss: string }> = {
  intro: {
    title: "Introducing usernames",
    body: "Add your username today to keep using everything in Control Scout. It's your handle when you add match videos, like or report one. It's never shown on your videos: your actual name is.",
    dismiss: "Browse first",
  },
  signup: {
    title: "Finish signing up",
    body: "Your actual name, then a username. The name is what shows on match videos you add; the username is your handle and is never shown on them.",
    dismiss: "Browse first",
  },
  required: {
    title: "Add a username to continue",
    body: "Adding match videos, liking, reporting and getting verified need a username and your actual name. Your username is never shown on your videos; your actual name is.",
    dismiss: "Not now",
  },
};

function SetupDialog({ user, mode, why, onClose }: { user: AccountUser; mode: Mode; why: string | null; onClose: (saved: boolean) => void }) {
  const { refreshUser } = usePersonal();
  const team = myTeamsOf(user).teams[0]?.teamNumber ?? null;
  const [name, setName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [userErr, setUserErr] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), user: useId(), nameErr: useId(), userErr: useId() };
  const hasUsername = !!user.username;
  // As it's typed: a quiet check that it's free (and two or three free ones when it isn't).
  useEffect(() => {
    if (hasUsername) return;
    const u = username.trim();
    setSuggest([]);
    if (!u || usernameProblem(u) === "format") return;
    const t = setTimeout(() => {
      apiFetch<{ ok: boolean; error?: string; suggestions?: string[] }>(`/api/me/username/check?u=${encodeURIComponent(u)}${team ? `&team=${team}` : ""}`)
        .then((r) => { if (!r.ok) { setUserErr(r.error ?? null); setSuggest(r.suggestions ?? []); } }, () => {});
    }, 400);
    return () => clearTimeout(t);
  }, [username, hasUsername, team]);
  const save = async () => {
    setNameErr(null); setUserErr(null);
    const n = name.trim(), u = username.trim();
    let bad = false;
    if (!n) { setNameErr("Add your actual name: it's the credit on videos you add."); bad = true; }
    const p = hasUsername ? null : usernameProblem(u);
    if (!hasUsername && (!u || p)) { setUserErr(u ? USERNAME_PROBLEM_TEXT[p!] : "Pick a username."); bad = true; }
    if (bad) return;
    setBusy(true);
    try {
      if (n !== (user.displayName ?? "")) await apiFetch("/api/me", { method: "PATCH", json: { displayName: n } });
      if (!hasUsername) {
        try { await apiFetch("/api/me/username", { method: "PUT", json: { username: u, team } }); }
        catch (e: any) {
          const body = e?.body as { error?: string; suggestions?: string[] } | undefined;
          setUserErr(body?.error ?? e?.message ?? "That username couldn't be saved.");
          setSuggest(body?.suggestions ?? []);
          return;
        }
      }
      await refreshUser();
      onClose(true);
    } catch (e: any) {
      setNameErr(`Not saved. ${e?.message ?? ""}`.trim());
    } finally { setBusy(false); }
  };
  const c = COPY[mode];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className="max-w-md" data-testid="username-prompt">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AtSign className="size-5 text-accent-text" aria-hidden />{c.title}</DialogTitle>
          <DialogDescription>{why ? `${why} ` : ""}{c.body}</DialogDescription>
        </DialogHeader>
        <form id="account-setup" className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="space-y-1.5">
            <Label htmlFor={ids.name}>Your actual name</Label>
            <Input id={ids.name} value={name} maxLength={NAME_MAX} autoComplete="name" placeholder="e.g. Alex Rivera" className="h-11 text-base sm:h-10 sm:text-sm"
              onChange={(e) => { setName(e.target.value); setNameErr(null); }} aria-invalid={nameErr ? true : undefined} aria-describedby={nameErr ? ids.nameErr : undefined} />
            <FieldError id={ids.nameErr}>{nameErr}</FieldError>
            {name.trim() && <p className="text-xs text-text-muted" data-testid="credit-preview">Videos you add will show as: <span className="font-medium text-text-base">{creditLine(name.trim())}</span></p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={ids.user}>Username</Label>
            {hasUsername ? <p className="text-sm">@{user.username}</p> : (
              <>
                <Input id={ids.user} value={username} maxLength={USERNAME_MAX} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="letters, numbers, _" className="h-11 text-base sm:h-10 sm:text-sm"
                  onChange={(e) => { setUsername(e.target.value.replace(/\s/g, "")); setUserErr(null); }} aria-invalid={userErr ? true : undefined} aria-describedby={userErr ? ids.userErr : undefined} />
                <FieldError id={ids.userErr}>{userErr}</FieldError>
                {suggest.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted" data-testid="username-suggestions">
                    Free: {suggest.map((s) => <button key={s} type="button" className="rounded-md border border-line px-2 py-1 font-mono text-text-base hover:bg-text-base/[0.06] pointer-coarse:min-h-11" onClick={() => { setUsername(s); setUserErr(null); setSuggest([]); }}>{s}</button>)}
                  </div>
                )}
                <p className="text-xs text-text-muted">3–20 letters, numbers or underscores. Only you and the site owner see it.</p>
              </>
            )}
          </div>
        </form>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onClose(false)}>{c.dismiss}</Button>
          <Button type="submit" form="account-setup" disabled={busy}>{busy ? "Saving…" : hasUsername ? "Save name" : "Add a username"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Home's reminder (only Home): for a signed-in account with no username that closed the introduction this sign-in. */
export function UsernameBanner() {
  const { user } = usePersonal();
  const { open } = useAccountSetup();
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); window.addEventListener(PHASE_EVENT, f); return () => window.removeEventListener(PHASE_EVENT, f); }, []);
  if (!user || user.username || readPhase(user) !== "prompted") return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent/[0.08] p-3 sm:items-center" role="region" aria-label="Introducing usernames" data-testid="username-banner">
      <AtSign className="mt-0.5 size-5 shrink-0 text-accent-text sm:mt-0" aria-hidden />
      <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">Introducing usernames:</span> add your username today to keep using everything in Control Scout. It's your handle for adding match videos; your videos show your actual name.</p>
      <div className="flex shrink-0 items-center gap-1 max-sm:flex-col max-sm:items-end">
        <Button size="sm" onClick={open}>Add a username</Button>
        <Button size="sm" variant="ghost" onClick={() => writePhase(user, "done")} aria-label="Not now: hide until next sign-in"><X className="sm:hidden" aria-hidden /><span className="max-sm:sr-only">Not now</span></Button>
      </div>
    </div>
  );
}
