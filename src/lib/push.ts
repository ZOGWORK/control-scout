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

/** The server's push settings, kept a minute (the owner can switch push on or off, or the keys can change). */
const CONFIG_TTL_MS = 60_000;
let config: { at: number; value: Promise<PushConfig> } | null = null;
function pushConfig(fresh = false): Promise<PushConfig> {
  if (fresh || !config || Date.now() - config.at > CONFIG_TTL_MS) {
    const value = apiFetch<PushConfig>("/api/push/config");
    const entry = { at: Date.now(), value };
    config = entry;
    value.catch(() => { if (config === entry) config = null; });
  }
  return config.value;
}

/** The current status (asks nothing of the user). */
export async function readPushStatus(signedIn: boolean): Promise<PushStatus> {
  const support = pushSupport();
  if (support !== "ok") return support;
  if (Notification.permission === "denied") return "denied";
  const c = await pushConfig().catch(() => null);
  if (!c?.available) return "unavailable";
  const reg = await registration();
  if (!reg) return "no-worker";
  if (!signedIn) return "signed-out";
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (!sub || Notification.permission !== "granted") return "off";
  const r = await apiFetch<{ subscribed: boolean }>("/api/push/subscriptions/check", { method: "POST", json: { endpoint: sub.endpoint } }).catch(() => null);
  // Unknown (offline): the browser's subscription stands.
  return !r || r.subscribed ? "on" : "off";
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
  const c = await pushConfig(true);
  if (!c.available || !c.publicKey) return "unavailable";
  const reg = await registration();
  if (!reg) return "no-worker";
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another key (the server's keys changed) can't receive: start over.
  const want = keyBytes(c.publicKey), had = sub?.options.applicationServerKey;
  if (sub && had && !sameBytes(new Uint8Array(had), want)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await apiFetch("/api/push/subscriptions", { method: "POST", json: sub.toJSON() });
  return "on";
}

/**
 * Can push reach this device right now? Checked before the in-tab alerts step aside (alerts.tsx), so they never stop
 * while push can't deliver: the owner switched it off, the keys went, permission was revoked, or the server dropped
 * this device's subscription. Read from the browser's subscription and the server each time, never from a saved
 * flag. Offline (the server can't say): the browser's subscription stands.
 */
export async function pushDeliversHere(): Promise<boolean> {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  const reg = await registration(0);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return false; // the usual case: never turned on, and no request made
  try {
    const c = await pushConfig();
    if (!c.available) return false;
    return (await apiFetch<{ subscribed: boolean }>("/api/push/subscriptions/check", { method: "POST", json: { endpoint: sub.endpoint } })).subscribed;
  } catch (e) {
    // Signed out (401): no account to push for. Anything else (offline): assume it still works.
    return (e as { status?: number }).status !== 401;
  }
}

/** Turn push off for this device: forget it on the server, then unsubscribe in the browser. */
export async function disablePush(): Promise<PushStatus> {
  const reg = pushSupport() === "ok" ? await registration() : null;
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    // The browser first, so it works with the server unreachable, push switched off or no one signed in: an
    // unsubscribed endpoint answers "gone" to the next push, and the server then deletes it anyway.
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await apiFetch("/api/push/subscriptions", { method: "DELETE", json: { endpoint } }).catch(() => {});
  }
  return "off";
}

/** Does this browser hold a push subscription for the site (whatever the server's state)? Settings keeps a way to
 *  remove it whenever it does. */
export async function hasLocalSubscription(): Promise<boolean> {
  if (pushSupport() !== "ok") return false;
  const reg = await registration(0);
  return !!(await reg?.pushManager.getSubscription().catch(() => null));
}

/** Signing out: this device stops getting the account's pushes (best effort, before the session ends). Whatever the
 *  server's push state right now: a subscription that exists is the account's, so it goes, even while push is off. */
export async function dropPushOnSignOut(): Promise<void> {
  if (pushSupport() !== "ok") return;
  const reg = await registration(0);
  if (!(await reg?.pushManager.getSubscription().catch(() => null))) return;
  await disablePush().catch(() => {});
}
