// The first-visit onboarding: four short steps in a locked dialog. 1 what Control Scout is, 2 pick your team (it
// becomes My team, so Home leads with its next match), 3 search answers plain questions, 4 where the main places are.
// Who gets it and its record: src/lib/onboarding.ts.
//
// Locked: while it shows, Skip (top right, the same place on every step) is the only way out besides finishing.
// Escape, clicks or taps on the backdrop or anywhere outside, focus leaving, the page's shortcuts (Ctrl/⌘ K, "/"),
// pull to refresh and a route change all leave it where it is. The page behind is inert; there's no close button
// and no swipe to close. A reload brings it back on the same step.
//
// When: on Home, after the privacy choice, once the page has painted and gone idle, and only while no other
// first-run surface is up (src/lib/firstRun.ts). Never to crawlers or automated browsers (cs-onboarding-demo opts in).
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Dialog as D } from "radix-ui";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ClipboardList, ListOrdered, Loader2, Search, Sparkles, Star, Trophy, Users, Zap, type LucideIcon } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { BrandMark } from "../layout/Shell";
import { apiFetch } from "../../lib/api";
import { isAutomated } from "../../lib/automation";
import { useConsent } from "../../lib/consent";
import { claimFirstRun, releaseFirstRun, useFirstRunHolder } from "../../lib/firstRun";
import { usePersonal } from "../../lib/personal";
import { endOnboarding, moveOnboarding, onboardingDemo, ONBOARDING_STEPS, openOnboarding, startsOn, useOnboardingRecord, usesTheApp } from "../../lib/onboarding";

const SLOT = "onboarding";
/** After the page has painted and gone idle, wait this long before opening (no flash on a quick bounce). */
export const ONBOARDING_DELAY_MS = 600;

/** Runs `cb` once the page has loaded and the browser is idle. */
function whenIdle(cb: () => void): () => void {
  let cancel = () => {};
  const idle = () => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(cb, { timeout: 1500 }); cancel = () => w.cancelIdleCallback?.(id); }
    else { const id = window.setTimeout(cb, 200); cancel = () => window.clearTimeout(id); }
  };
  if (document.readyState === "complete") idle();
  else { window.addEventListener("load", idle, { once: true }); cancel = () => window.removeEventListener("load", idle); }
  return () => cancel();
}

/** Decides whether it shows, starts it for a new visitor, and keeps its record. */
export function Onboarding() {
  const loc = useLocation();
  const { decided } = useConsent();
  const { state, user, providers, syncReady } = usePersonal();
  const rec = useOnboardingRecord();
  const holder = useFirstRunHolder();
  const automated = isAutomated() && !onboardingDemo();
  // Signed in, this device knows the account's teams only once its first sync has worked: until then an empty state
  // isn't proof of a new visitor.
  const settled = providers !== null && (!user || syncReady);
  const free = holder === null || holder === SLOT;
  const open = rec?.status === "open";
  const onOwner = loc.pathname.replace(/\/+$/, "") === "/owner";
  const show = open && decided && !automated && !onOwner && free;

  // A new visitor on Home: open it once the page has settled.
  const startable = rec === null && decided && !automated && settled && free && startsOn(loc.pathname) && !usesTheApp(state, user);
  useEffect(() => {
    if (!startable) return;
    let timer = 0;
    const stop = whenIdle(() => { timer = window.setTimeout(() => { if (claimFirstRun(SLOT)) openOnboarding(); }, ONBOARDING_DELAY_MS); });
    return () => { stop(); window.clearTimeout(timer); };
  }, [startable]);

  // Hold the first-run slot while it shows; give it back when it ends.
  useEffect(() => {
    if (show) claimFirstRun(SLOT);
    else releaseFirstRun(SLOT);
  }, [show]);
  useEffect(() => () => releaseFirstRun(SLOT), []);

  if (!show || !rec) return null;
  return <OnboardingDialog step={rec.step} />;
}

/** Where the dialog sits on a phone: the visible part of the screen, so the keyboard never pushes Skip off it. */
function useVisibleViewport(): { top: number; height: number } | null {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const read = () => setVv((p) => (p && p.top === v.offsetTop && p.height === v.height ? p : { top: v.offsetTop, height: v.height }));
    read();
    v.addEventListener("resize", read);
    v.addEventListener("scroll", read);
    return () => { v.removeEventListener("resize", read); v.removeEventListener("scroll", read); };
  }, []);
  return vv;
}

const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=true]");

/** The locked dialog and its four steps. */
export function OnboardingDialog({ step }: { step: number }) {
  const navigate = useNavigate();
  const { state, set } = usePersonal();
  const vv = useVisibleViewport();
  const titleId = useId();
  const bodyId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const teamInputRef = useRef<HTMLInputElement>(null);
  /** The team picked in step 2 (saved as My team on Next). */
  const [team, setTeam] = useState<TeamHit | null>(null);
  // Came back to step 2 with a team already saved: show it picked.
  const savedTeam = state.myTeam;
  /** The team this onboarding saved (not one the person already had): "I'm not on a team" takes back only this. */
  const savedHere = useRef<number | null>(null);

  // The page behind can't be reached at all: no clicks, taps, focus or screen reader (Radix also hides it).
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const had = root.hasAttribute("inert");
    root.setAttribute("inert", "");
    return () => { if (!had) root.removeAttribute("inert"); };
  }, []);

  // Keys the page listens for (Escape, Ctrl/⌘ K, "/") stop here first: nothing behind reacts, nothing closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const block = k === "escape" || ((e.ctrlKey || e.metaKey) && k === "k") || (k === "/" && !editable(e.target));
      if (!block) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

  // Each step: focus where the step is used (the team box on step 2, the main button elsewhere).
  useEffect(() => {
    const t = window.setTimeout(() => ((step === 1 && teamInputRef.current) || primaryRef.current)?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [step]);

  const go = useCallback((n: number) => { moveOnboarding(n); }, []);
  const skip = () => endOnboarding("skipped");
  const finish = () => {
    endOnboarding("finished");
    navigate("/");
    window.scrollTo({ top: 0 });
    // No team: straight into search, the way to everything.
    if (savedTeam == null) {
      window.setTimeout(() => {
        const input = [...document.querySelectorAll<HTMLInputElement>("[data-search-box] input")].find((el) => el.getClientRects().length > 0);
        input?.focus();
      }, 60);
    }
  };
  const saveTeamAndGo = () => {
    if (team && team.number !== savedTeam) { set("myTeam", team.number); savedHere.current = team.number; }
    go(2);
  };

  const last = step === ONBOARDING_STEPS - 1;
  const teamName = savedTeam != null ? (team?.number === savedTeam ? team.name : null) : null;

  let title: string;
  let body: ReactNode;
  let primary: { label: string; run: () => void };
  if (step === 0) {
    title = "Welcome to Control Scout";
    body = <StepWelcome />;
    primary = { label: "Next", run: () => go(1) };
  } else if (step === 1) {
    title = "Which team are you on?";
    body = <StepTeam inputRef={teamInputRef} picked={team} savedTeam={savedTeam} onPick={setTeam} onNone={() => { setTeam(null); if (savedHere.current != null && savedTeam === savedHere.current) { set("myTeam", null); savedHere.current = null; } go(2); }} onEnter={saveTeamAndGo} />;
    primary = { label: team ? `Save ${team.number} and continue` : "Next", run: saveTeamAndGo };
  } else if (step === 2) {
    title = "Ask anything";
    body = <StepSearch team={savedTeam} />;
    primary = { label: "Next", run: () => go(3) };
  } else {
    title = "Find your way";
    body = <StepPlaces />;
    primary = { label: savedTeam != null ? `Show ${teamName ?? `team ${savedTeam}`}` : "Start searching", run: finish };
  }

  return (
    <D.Root open modal onOpenChange={() => { /* only Skip and the last step close it */ }}>
      <D.Portal>
        <D.Overlay data-onboarding-backdrop="" className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-[2px]" />
        <D.Content
          data-onboarding="" data-onboarding-step={step + 1}
          aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={vv ? ({ "--ob-top": `${vv.top}px`, "--ob-h": `${vv.height}px` } as React.CSSProperties) : undefined}
          className={cn(
            "fixed z-[91] flex flex-col overflow-hidden border-line bg-elevated text-text-base shadow-2xl outline-none",
            // Phone: the whole visible screen (the keyboard shrinks it, the header stays on it).
            "inset-x-0 top-[var(--ob-top,0px)] h-[var(--ob-h,100dvh)] max-md:border-0",
            // Wider: a centred panel.
            "md:inset-x-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[min(640px,calc(100dvh-3rem))] md:w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border",
          )}
        >
          {/* Header: where you are, and Skip, in the same place on every step. */}
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:pt-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-text-muted" aria-hidden>Step {step + 1} of {ONBOARDING_STEPS}</p>
              <div className="mt-1.5 flex gap-1" aria-hidden>
                {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
                  <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-text-base/15")} />
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-[44px] min-w-[64px] shrink-0 px-3 text-sm" onClick={skip} data-onboarding-skip="">Skip</Button>
          </div>

          {/* The step. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
            <D.Title id={titleId} className="font-display text-xl font-semibold tracking-[-0.01em] text-text-base">
              <span className="sr-only">Step {step + 1} of {ONBOARDING_STEPS}: </span>{title}
            </D.Title>
            <D.Description asChild><div id={bodyId} className="mt-3">{body}</div></D.Description>
          </div>

          {/* Back and the main button. */}
          <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-3">
            {step > 0 && (
              <Button variant="secondary" className="h-[44px] md:h-10" onClick={() => go(step - 1)} data-onboarding-back=""><ArrowLeft /> Back</Button>
            )}
            <Button ref={primaryRef} className="ml-auto h-[44px] min-w-0 md:h-10" onClick={primary.run} data-onboarding-next="">
              <span className="truncate">{primary.label}</span>{!last && <ArrowRight />}
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Step 1: what this is, in one line and three things it does. */
function StepWelcome() {
  const tiles: { icon: LucideIcon; title: string; text: string; tone: string }[] = [
    { icon: Users, title: "Every team and event", text: "Stats, rankings and results, updated through event days.", tone: "bg-info/12 text-info-text" },
    { icon: Sparkles, title: "Win odds for any match", text: "Who's likely to win, and by how much.", tone: "bg-accent/15 text-accent-text" },
    { icon: ClipboardList, title: "Scouting at your event", text: "Notes and pick lists, on your phone.", tone: "bg-success/12 text-success-text" },
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <BrandMark className="size-10 shrink-0" />
        <p className="text-sm leading-relaxed text-text-muted">Free FTC stats, match odds and scouting. No account needed.</p>
      </div>
      <ul className="mt-4 grid gap-2">
        {tiles.map((t) => (
          <li key={t.title} className="flex items-start gap-3 rounded-xl border border-line bg-text-base/[0.02] p-3">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", t.tone)}><t.icon className="size-[18px]" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-base">{t.title}</span>
              <span className="block text-sm text-text-muted">{t.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TeamHit { number: number; name: string; place: string }

/** "4215 | Hypnotic Robotics" + "School · City, ST, USA" → number, name, place. */
function toTeam(h: { ref: string; title: string; subtitle?: string }): TeamHit | null {
  const number = Number(h.ref);
  if (!Number.isInteger(number) || number <= 0) return null;
  const name = h.title.replace(/^\s*\d+\s*\|\s*/, "").trim() || `Team ${number}`;
  const place = (h.subtitle ?? "").split(" · ").pop() ?? "";
  return { number, name, place };
}

/** Step 2: find your team by number or name. Next saves it as My team; "Not on a team" moves on without one. */
function StepTeam({ inputRef, picked, savedTeam, onPick, onNone, onEnter }: {
  inputRef: React.RefObject<HTMLInputElement | null>; picked: TeamHit | null; savedTeam: number | null;
  onPick: (t: TeamHit | null) => void; onNone: () => void; onEnter: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TeamHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const listId = useId();

  useEffect(() => {
    const query = q.trim();
    if (!query) { setHits([]); setBusy(false); setFailed(false); return; }
    const ctrl = new AbortController();
    setBusy(true);
    const t = window.setTimeout(() => {
      apiFetch<{ hits: { kind: string; ref: string; title: string; subtitle?: string }[] }>(`/api/search?q=${encodeURIComponent(query)}&kinds=team&limit=5`, { signal: ctrl.signal })
        .then((r) => { setHits(r.hits.filter((h) => h.kind === "team").map(toTeam).filter((x): x is TeamHit => x !== null)); setFailed(false); })
        .catch(() => { if (!ctrl.signal.aborted) { setHits([]); setFailed(true); } })
        .finally(() => { if (!ctrl.signal.aborted) setBusy(false); });
    }, 200);
    return () => { ctrl.abort(); window.clearTimeout(t); };
  }, [q]);

  const chosen = picked ?? (savedTeam != null ? { number: savedTeam, name: `Team ${savedTeam}`, place: "" } : null);

  return (
    <div>
      <p className="text-sm leading-relaxed text-text-muted">Pick it and Home leads with its next match and odds. It stays on this device; no account needed.</p>
      {chosen ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent/50 bg-accent/10 p-3" data-onboarding-team={chosen.number}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-black"><Star className="size-[18px] fill-current" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text-base">{chosen.number} · {chosen.name}</span>
            {chosen.place && <span className="block truncate text-xs text-text-muted">{chosen.place}</span>}
          </span>
          <Button variant="ghost" size="sm" className="h-[44px] shrink-0 md:h-9" onClick={() => { onPick(null); setQ(""); window.setTimeout(() => inputRef.current?.focus(), 0); }}>Change</Button>
        </div>
      ) : (
        <>
          <label className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-background px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
            <span className="sr-only">Team number or name</span>
            <input
              ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (hits[0]) onPick(hits[0]); else onEnter(); } }}
              inputMode="search" autoComplete="off" enterKeyHint="search" placeholder="Team number or name"
              role="combobox" aria-expanded={hits.length > 0} aria-controls={listId} aria-autocomplete="list"
              className="h-[48px] min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-text-muted md:h-11 md:text-sm"
            />
            {busy && <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" aria-hidden />}
          </label>
          <ul id={listId} role="listbox" aria-label="Teams" className="mt-2 grid gap-1">
            {hits.map((h) => (
              <li key={h.number} role="option" aria-selected={false}>
                <button type="button" onClick={() => onPick(h)} className="flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-text-base/[0.06] focus-visible:bg-text-base/[0.06] focus-visible:outline-none" data-onboarding-team-option={h.number}>
                  <span className="w-14 shrink-0 font-mono text-sm font-semibold text-accent-text">{h.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-base">{h.name}</span>
                    {h.place && <span className="block truncate text-xs text-text-muted">{h.place}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {failed && <p className="mt-2 text-sm text-text-muted" role="status">Search isn't answering right now. You can pick your team later on My team.</p>}
          {!busy && !failed && q.trim() !== "" && hits.length === 0 && <p className="mt-2 text-sm text-text-muted" role="status">No team matches that yet.</p>}
        </>
      )}
      <button type="button" onClick={onNone} className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium text-text-muted underline underline-offset-4 hover:text-text-base" data-onboarding-no-team="">
        I'm not on a team
      </button>
    </div>
  );
}

/** Step 3: search answers plain questions. Examples are shown, not run, so they can't leave the dialog. */
function StepSearch({ team }: { team: number | null }) {
  const examples: { icon: LucideIcon; text: string; tone: string }[] = team != null
    ? [
      { icon: CalendarDays, text: `${team} next match`, tone: "text-info-text" },
      { icon: Trophy, text: `${team} awards`, tone: "text-success-text" },
      { icon: Zap, text: "Best auto OPR", tone: "text-accent-text" },
    ]
    : [
      { icon: Trophy, text: "Who won Worlds", tone: "text-success-text" },
      { icon: Zap, text: "Best auto OPR", tone: "text-accent-text" },
      { icon: Users, text: "Top teams in California", tone: "text-info-text" },
    ];
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  return (
    <div>
      <p className="text-sm leading-relaxed text-text-muted">Search answers FTC questions in plain words, with the numbers right there. For example:</p>
      <ul className="mt-4 grid gap-2" aria-label="Example searches">
        {examples.map((x) => (
          <li key={x.text} className="flex items-center gap-3 rounded-full border border-line bg-text-base/[0.03] py-2 pl-3 pr-4 text-sm font-medium text-text-base">
            <x.icon className={cn("size-4 shrink-0", x.tone)} aria-hidden /> <span className="truncate">“{x.text}”</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 hidden text-sm text-text-muted md:block">
        Press <kbd className="rounded border border-line bg-text-base/[0.05] px-1.5 py-0.5 font-mono text-xs text-text-base">{mac ? "⌘" : "Ctrl"} K</kbd> on any page to search.
      </p>
      <p className="mt-4 text-sm text-text-muted md:hidden">The search box is at the top of every page.</p>
    </div>
  );
}

/** Step 4: the main places, and where they are on this screen. */
function StepPlaces() {
  const places: { icon: LucideIcon; name: string; text: string; tone: string }[] = [
    { icon: CalendarDays, name: "Events", text: "Schedules, results, live matches", tone: "text-info-text" },
    { icon: Users, name: "Teams", text: "Every team's stats", tone: "text-success-text" },
    { icon: ListOrdered, name: "Rankings", text: "Who's best this season", tone: "text-rose-500 dark:text-rose-300" },
    { icon: Sparkles, name: "Predict", text: "Odds for any match", tone: "text-accent-text" },
    { icon: Star, name: "My team", text: "Your team's next match", tone: "text-accent-text" },
    { icon: ClipboardList, name: "Scout", text: "Notes at your event", tone: "text-violet-500 dark:text-violet-300" },
  ];
  return (
    <div>
      <p className="text-sm leading-relaxed text-text-muted">
        <span className="md:hidden">They're in the bar along the bottom, and the menu at the top left.</span>
        <span className="max-md:hidden">They're in the menu on the left.</span>
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-2">
        {places.map((p) => (
          <li key={p.name} className="rounded-xl border border-line bg-text-base/[0.02] p-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-base"><p.icon className={cn("size-4 shrink-0", p.tone)} aria-hidden />{p.name}</span>
            <span className="mt-0.5 block text-xs leading-snug text-text-muted">{p.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-sm text-text-muted"><Check className="size-4 shrink-0 text-success-text" aria-hidden /> That's it. Settings can show this again.</p>
    </div>
  );
}
