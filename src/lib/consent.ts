// Consent for optional storage/processing. Essential storage (sign-in session,
// preferences, offline data) needs no consent and is always on; the only
// optional thing is anonymous usage statistics. The choice lives on this device
// in localStorage ("cs-consent"); a browser privacy signal (Global Privacy
// Control or Do Not Track) counts as "no" and is never overridden.
import { useCallback, useSyncExternalStore } from "react";

export const CONSENT_KEY = "cs-consent";
export type Consent = { analytics: boolean; at: string; v: 1 };

const EVENT = "cs-consent-change";
// Fallback when localStorage is blocked, so a click still hides the banner.
let memory: Consent | null = null;

/** True when the browser asks sites not to track (GPC or DNT = "1"). */
export function privacySignal(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const win = typeof window === "undefined" ? undefined : (window as Window & { doNotTrack?: string });
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.msDoNotTrack === "1" || win?.doNotTrack === "1";
}

function readRaw(): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function parse(raw: string | null): Consent | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Consent>;
    return c && c.v === 1 && typeof c.analytics === "boolean" ? { analytics: c.analytics, at: String(c.at ?? ""), v: 1 } : null;
  } catch { return null; }
}

/** The stored choice, or null when none has been made (or it's unreadable). */
export function readConsent(): Consent | null { return parse(readRaw()); }

/** Store a choice and tell every useConsent() on the page. */
export function setAnalyticsConsent(analytics: boolean): void {
  const c: Consent = { analytics, at: new Date().toISOString(), v: 1 };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(c)); } catch { /* storage blocked: the choice lasts this page view */ memory = c; }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** The one check analytics code calls before sending anything. */
export function hasAnalyticsConsent(): boolean {
  if (privacySignal()) return false;
  return (readConsent() ?? memory)?.analytics === true;
}

/** Whether the first-visit banner should ask: no stored choice and no privacy signal. */
export function needsConsentChoice(): boolean {
  return !privacySignal() && !readConsent() && !memory;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === CONSENT_KEY) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onStorage); };
}
// A string snapshot so React compares by value (a parsed object would be new every read).
const snapshot = () => `${privacySignal() ? 1 : 0}|${readRaw() ?? (memory ? JSON.stringify(memory) : "")}`;

export type ConsentState = {
  /** Analytics may run (a "yes" stored and no privacy signal). */
  analytics: boolean;
  /** A choice has been made (stored) — or the browser's privacy signal made it. */
  decided: boolean;
  /** The browser sends GPC / DNT: analytics stays off and can't be turned on here. */
  signal: boolean;
  setAnalytics: (on: boolean) => void;
};

export function useConsent(): ConsentState {
  const snap = useSyncExternalStore(subscribe, snapshot, () => "0|");
  const signal = snap.startsWith("1");
  const stored = parse(snap.slice(2));
  const setAnalytics = useCallback((on: boolean) => setAnalyticsConsent(on), []);
  return { analytics: !signal && stored?.analytics === true, decided: signal || !!stored, signal, setAnalytics };
}
