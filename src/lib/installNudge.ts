// The add-to-home-screen nudge (src/components/layout/InstallNudge.tsx): the
// browser's install offer, held until the nudge asks for it, and the record of
// what this device answered. The rules, in full, are in docs/settings.md
// ("Add-to-home-screen nudge"):
//
// - Shown at most once per calendar day (local time): showing it writes the
//   day, so a reload, a new tab or ignoring it never brings it back that day.
// - Never again after "No thanks", the ×, Esc, or a "Cancel" in the browser's
//   own install dialog (`dismissed`). Ignoring it (leaving the page it's on,
//   closing the tab) is not a dismissal: it can come back the next day.
// - Never when the app is installed: running from the home screen
//   (display-mode standalone and friends, or iOS's navigator.standalone), the
//   `appinstalled` event (remembered as `installed`), or
//   navigator.getInstalledRelatedApps() finding it.
// - Only when the browser offers an install (`beforeinstallprompt`), or on iOS
//   Safari, which never does: there it's a short "Share, then Add to Home
//   Screen" hint, and any answer ends it for good (Safari can't tell a page
//   that it was added, so "Got it" has to count as done).
//
// `cs-install` is Tier 3 (device-only, DEVICE_ONLY_KEYS): whether one device
// was installed says nothing about another.
import { useSyncExternalStore } from "react";

export const INSTALL_KEY = "cs-install";
/**
 * Automation opt-in, like the tour's: browsers driven by tools never get the nudge, so
 * screenshots and audits stay clean. "1" lets one see it (`npm run shots -- --install`).
 */
export const INSTALL_DEMO_KEY = "cs-install-demo";

export interface InstallRecord {
  v: 1;
  /** The local calendar day ("2026-10-16") it was last shown. */
  lastShown?: string;
  /** When it was turned down for good. */
  dismissed?: string;
  /** When this browser installed the app (the appinstalled event, or an accepted prompt). */
  installed?: string;
}

/** Chrome's install offer (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

// The record when saving failed (storage blocked or full): it still holds for this page's lifetime.
let memory: InstallRecord | null = null;

function parse(raw: string | null): InstallRecord {
  if (!raw) return { v: 1 };
  try {
    const r = JSON.parse(raw) as Partial<InstallRecord>;
    if (!r || r.v !== 1) return { v: 1 };
    const out: InstallRecord = { v: 1 };
    if (typeof r.lastShown === "string") out.lastShown = r.lastShown;
    if (typeof r.dismissed === "string") out.dismissed = r.dismissed;
    if (typeof r.installed === "string") out.installed = r.installed;
    return out;
  } catch { return { v: 1 }; }
}

/** What this device answered so far. */
export function readInstall(): InstallRecord {
  if (memory) return memory;
  try { return parse(localStorage.getItem(INSTALL_KEY)); } catch { return { v: 1 }; }
}

function write(patch: Partial<Omit<InstallRecord, "v">>): InstallRecord {
  const r: InstallRecord = { ...readInstall(), ...patch, v: 1 };
  memory = r;
  try { localStorage.setItem(INSTALL_KEY, JSON.stringify(r)); memory = null; } catch { /* storage blocked: kept for this page view */ }
  emit();
  return r;
}

/** The local calendar day, "YYYY-MM-DD". */
export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const markShown = (now: Date = new Date()) => write({ lastShown: dayKey(now) });
export const markDismissed = (now: Date = new Date()) => write({ dismissed: now.toISOString() });
export const markInstalled = (now: Date = new Date()) => write({ installed: now.toISOString() });

/** True when the record rules it out on `now`'s day (already shown today, turned down, or installed). */
export function ruledOut(r: InstallRecord, now: Date = new Date()): boolean {
  return !!r.dismissed || !!r.installed || r.lastShown === dayKey(now);
}

/** Running as the installed app: from the home screen or an app window. */
export function runningInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]
    .some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches === true);
}

/** The app is installed according to getInstalledRelatedApps (manifest related_applications); false where unsupported. */
export async function relatedAppInstalled(): Promise<boolean> {
  const nav = navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };
  if (typeof nav.getInstalledRelatedApps !== "function") return false;
  try { return (await nav.getInstalledRelatedApps()).length > 0; } catch { return false; }
}

/** iPhone/iPad Safari (iPadOS reports a Mac with touch). Other iOS browsers' share menus differ: they get nothing. */
export function isIosSafari(nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator): boolean {
  const ua = nav.userAgent ?? "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|Instagram|FBAN|FBAV|Line\//.test(ua);
}

/** The automation opt-in (`cs-install-demo` = "1"). */
export function installDemo(): boolean {
  try { return localStorage.getItem(INSTALL_DEMO_KEY) === "1"; } catch { return false; }
}

// The browser's offer, held from the moment it arrives (often before React has mounted).
let offer: BeforeInstallPromptEvent | null = null;
let version = 0;
const listeners = new Set<() => void>();
function emit() { version++; for (const l of [...listeners]) l(); }
let capturing = false;

/**
 * Listen for the browser's install offer from page start: keep it (and stop the browser's
 * own mini-infobar) so the nudge can use it, and note an install however it happened.
 */
export function captureInstallPrompt(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offer = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    markInstalled();
  });
  // Answered in another tab: this one follows.
  window.addEventListener("storage", (e) => { if (e.key === null || e.key === INSTALL_KEY) { memory = null; emit(); } });
}

/** The offer, if the browser made one and it hasn't been used. */
export function installOffer(): BeforeInstallPromptEvent | null { return offer; }

/** Use the offer (it works once): shows the browser's install dialog and records the answer. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = offer;
  if (!e) return "unavailable";
  offer = null;
  emit();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") markInstalled(); else markDismissed();
    return outcome;
  } catch { return "unavailable"; }
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const snapshot = () => version;

/** Re-renders when the offer or the record changes. */
export function useInstallState(): { offer: BeforeInstallPromptEvent | null; record: InstallRecord } {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return { offer, record: readInstall() };
}

/** Tests only. */
export function resetInstallForTests(): void {
  offer = null;
  memory = null;
  try { localStorage.removeItem(INSTALL_KEY); } catch { /* storage blocked */ }
  emit();
}
