// Sign-in extras for the account panel: the Google / Discord / GitHub buttons
// (Control Point runs those sign-ins for us, see docs/shared-accounts.md), and
// the short "merging your accounts" screen shown when the sign-in found an
// existing Control Point account. It also brings that account's shortlisted
// teams into this shortlist (added, never removed).
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { usePersonal, type AccountUser } from "../../lib/personal";
import { cn } from "../cn";

type Via = "google" | "discord" | "github";
const LABEL: Record<Via, string> = { google: "Google", discord: "Discord", github: "GitHub" };

function ProviderIcon({ p }: { p: Via }) {
  if (p === "google") return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
  if (p === "discord") return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.7.1 18.2a19.9 19.9 0 0 0 6 3l1.3-2a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.8-3.6-13.8ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" /></svg>
  );
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="currentColor" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" /></svg>
  );
}

/** "Continue with Google / Discord / GitHub": through Control Point, back to this page. */
export function ProviderButtons({ via }: { via: Via[] }) {
  if (!via.length) return null;
  const back = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
  return (
    <div className="grid grid-cols-3 gap-2">
      {via.map((p) => (
        <a key={p} href={`/api/auth/control-point/start?${new URLSearchParams({ via: p, back })}`} aria-label={`Continue with ${LABEL[p]}`} title={`Continue with ${LABEL[p]}`}
          className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-xs font-medium transition-colors hover:border-accent/50 hover:bg-accent/[0.06] focus-visible:ring-2 focus-visible:ring-ring/60 outline-none">
          <ProviderIcon p={p} /><span className="hidden sm:inline">{LABEL[p]}</span>
        </a>
      ))}
    </div>
  );
}

/** Add Control Point's shortlisted teams to this shortlist (once per sign-in). Returns how many were new. */
export function useShortlistMerge() {
  const { state, update } = usePersonal();
  return (incoming: number[]) => {
    const have = new Set(state.bookmarks);
    const add = incoming.filter((n) => !have.has(n));
    if (add.length) update("bookmarks", (b) => [...b, ...add.filter((n) => !b.includes(n))]);
    return add.length;
  };
}

const STEP_MS = 650;

/** The brief "merging accounts" screen: a few steps, then the signed-in view.
 *  `added`: how many shortlisted teams the merge brought in (null while it waits for sync). */
export function MergeScreen({ user, added, onDone }: { user: AccountUser; added: number | null; onDone: () => void }) {
  const cp = user.controlPoint;
  const shortlist = cp?.shortlist ?? [];
  const [step, setStep] = useState(0);
  // The parent re-renders while syncing; a ref keeps that from restarting the timers.
  const done = useRef(onDone);
  done.current = onDone;
  const steps = [
    `Found your Control Point account${cp?.teams.length ? ` (${cp.teams.map((t) => t.teamNumber ?? t.name).join(", ")})` : ""}`,
    "Linking it with Control Scout",
    shortlist.length ? (added == null ? `Bringing over ${shortlist.length} shortlisted team${shortlist.length === 1 ? "" : "s"}` : `Shortlist merged: ${added} new team${added === 1 ? "" : "s"} added`) : "Syncing your teams and settings",
  ];
  const last = steps.length - 1;
  // Sync slow or offline: don't hold the screen; the shortlist still merges once synced.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 4000); return () => clearTimeout(t); }, []);
  if (waited && added == null && shortlist.length) steps[last] = `Your ${shortlist.length} shortlisted team${shortlist.length === 1 ? "" : "s"} will merge once synced`;
  const ready = added != null || !shortlist.length || waited;
  useEffect(() => {
    if (step < last) { const t = setTimeout(() => setStep((s) => s + 1), STEP_MS); return () => clearTimeout(t); }
    if (ready) { const t = setTimeout(() => done.current(), STEP_MS + 300); return () => clearTimeout(t); }
  }, [step, last, ready]);
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <p className="font-display text-base font-semibold">Merging your accounts</p>
      <p className="text-xs text-muted-foreground">{user.email} is one account for Control Scout and Control Point.</p>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const done = i < step || (i === last && step === last && ready);
          const active = i === step && !done;
          return (
            <li key={i} className={cn("flex items-center gap-2 text-sm transition-opacity", i > step && "opacity-35")}>
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", done ? "bg-success/15 text-success" : "bg-accent/15 text-accent")}>
                {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              {s}
            </li>
          );
        })}
      </ol>
      <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${((step + (ready && step === last ? 1 : 0.5)) / steps.length) * 100}%` }} /></div>
    </div>
  );
}
