// Web push on this device (docs/push.md): Settings › Notifications turns it on and off. Permission is only
// ever asked from a tap on "Turn on notifications", never on load. The subscription is stored on the
// server for the signed-in account; the service worker (src/sw.template.js) shows what arrives.
import { apiFetch } from "./api";
import type { PushConfig } from "../shared/push";

/** Where this device stands, each with one line of explanation in the settings UI. */
export type PushStatus =
  | "checking"
  /** No Push API in this browser. */
  | "unsupported"
  /** iPhone / iPad Safari outside an installed web app: push needs Control Scout on the Home Screen. */
  | "ios-install"
  /** No service worker here (development builds don't register one). */
  | "no-worker"
  /** The server has no VAPID keys, or the owner switched push off. */
  | "unavailable"
  | "signed-out"
  /** The browser's permission for this site is "Block". */
  | "denied"
  | "off"
  | "on";

/** Set while this device has a working subscription: in-tab alerts (alerts.tsx) step aside so nothing arrives twice. */
const ON_KEY = "cs-push-on";
export const pushOnHere = () => { try { return localStorage.getItem(ON_KEY) === "1"; } catch { return false; } };
const markOn = (on: boolean) => { try { if (on) localStorage.setItem(ON_KEY, "1"); else localStorage.removeItem(ON_KEY); } catch { /* storage blocked */ } };

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || (navigator as { standalone?: boolean }).standalone === true;

/** What the browser itself allows, before asking anyone anything. */
export function pushSupport(): "ok" | "unsupported" | "ios-install" {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") return "unsupported";
  return "ok";
}

/** The service worker's registration. On a first visit it may still be registering (main.tsx registers it
 *  after load): wait a few seconds for it before saying there is none (a development build never has one). */
async function registration(waitMs = 5000): Promise<ServiceWorkerRegistration | null> {
  try {
    const now = await navigator.serviceWorker.getRegistration();
    if (now) return now;
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
  } catch { return null; }
}

let config: Promise<PushConfig> | null = null;
function pushConfig(): Promise<PushConfig> {
  config ??= apiFetch<PushConfig>("/api/push/config").catch((e) => { config = null; throw e; });
  return config;
}

/** The current status (asks nothing of the user). */
export async function readPushStatus(signedIn: boolean): Promise<PushStatus> {
  const support = pushSupport();
  if (support !== "ok") return support;
  if (Notification.permission === "denied") { markOn(false); return "denied"; }
  const c = await pushConfig().catch(() => null);
  if (!c?.available) return "unavailable";
  const reg = await registration();
  if (!reg) return "no-worker";
  if (!signedIn) return "signed-out";
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub || Notification.permission !== "granted") { markOn(false); return "off"; }
  const r = await apiFetch<{ subscribed: boolean }>("/api/push/subscriptions/check", { method: "POST", json: { endpoint: sub.endpoint } }).catch(() => null);
  // Unknown (offline): trust this device's own record.
  const on = r ? r.subscribed : pushOnHere();
  markOn(on);
  return on ? "on" : "off";
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Turn push on for this device. Call only from a tap: it asks for the browser's permission first. */
export async function enablePush(): Promise<PushStatus> {
  const support = pushSupport();
  if (support !== "ok") return support;
  // First, while the tap still counts as a user gesture (Safari requires it).
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off"; // dismissed: nothing changes, they can tap again
  const c = await pushConfig();
  if (!c.available || !c.publicKey) return "unavailable";
  const reg = await registration();
  if (!reg) return "no-worker";
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's keys changed) can't receive: start over.
  const want = keyBytes(c.publicKey), had = sub?.options.applicationServerKey;
  if (sub && had && !sameBytes(new Uint8Array(had), want)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await apiFetch("/api/push/subscriptions", { method: "POST", json: sub.toJSON() });
  markOn(true);
  return "on";
}

/** Turn push off for this device: forget it on the server, then unsubscribe in the browser. */
export async function disablePush(): Promise<PushStatus> {
  markOn(false);
  const reg = pushSupport() === "ok" ? await registration() : null;
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    await apiFetch("/api/push/subscriptions", { method: "DELETE", json: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/** Signing out: this device stops getting the account's pushes (best effort, before the session ends). */
export async function dropPushOnSignOut(): Promise<void> {
  if (!pushOnHere()) return;
  await disablePush().catch(() => {});
}
