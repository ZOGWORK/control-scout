// Web push (docs/push.md), shared by the server and the web app: what a device sends to subscribe,
// what a push carries, and the rules for when one is sent. The server decides who gets what
// (server/push/push.ts); the service worker shows it (src/sw.template.js).

/** What a push is about. One sent-log row per (subscription, kind, subject), so each is sent once. */
export type PushKind = "match" | "upset" | "start";

/** A match reminder goes out once the match's scheduled start is this close (or closer). */
export const PUSH_LEAD_MS = 15 * 60_000;
/** …but not when it's closer than this: by then a reminder is noise (the schedule was published late). */
export const PUSH_MIN_LEAD_MS = 60_000;
/** An upset is our pre-match call (the live ledger) at or above this, for the side that then lost. */
export const UPSET_THRESHOLD = 0.65;
/** Upsets scored longer ago than this are old news: never pushed (e.g. after a server restart). */
export const UPSET_FRESH_MS = 30 * 60_000;
/** At most this many pushes per subscription in any 24 hours; the rest are logged as skipped. */
export const PUSH_DAILY_LIMIT = 20;
/** Subscriptions kept per account (devices); a new one beyond this replaces the least recently used. */
export const PUSH_MAX_PER_ACCOUNT = 10;

/** What a push's payload holds (JSON, encrypted to the device). `url` is a path in this app. */
export interface PushPayload { title: string; body: string; url: string; tag: string }

/** GET /api/push/config */
export interface PushConfig {
  /** True when the server has VAPID keys and the owner hasn't switched push off. */
  available: boolean;
  /** The VAPID public key (base64url) the browser subscribes with; null when unavailable. */
  publicKey: string | null;
}

/** POST /api/push/subscriptions: PushSubscription.toJSON() as the browser gives it. */
export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** The browsers' push services. The server POSTs to a subscription's endpoint, so only these hosts are accepted:
 *  never an address a user picked (an internal service, say). Chrome/Edge (FCM, WNS), Firefox (Mozilla), Safari (Apple). */
export const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;

/** Validate a browser subscription (null when unusable). The endpoint must be an https URL on a known push
 *  service (PUSH_HOSTS); the keys are
 *  a P-256 public key (65 bytes) and a 16-byte auth secret, base64url as PushSubscription.toJSON() gives them. */
export function cleanSubscription(v: unknown): PushSubscriptionInput | null {
  const o = v as Partial<PushSubscriptionInput> | null;
  if (!o || typeof o !== "object" || typeof o.endpoint !== "string" || !o.keys || typeof o.keys !== "object") return null;
  const { endpoint } = o, { p256dh, auth } = o.keys as Partial<PushSubscriptionInput["keys"]>;
  if (endpoint.length > 1000 || typeof p256dh !== "string" || typeof auth !== "string") return null;
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !PUSH_HOSTS.test(u.hostname)) return null;
  } catch { return null; }
  const bytes = (s: string) => (B64URL.test(s) ? Math.floor((s.replace(/=+$/, "").length * 3) / 4) : -1);
  if (bytes(p256dh) !== 65 || bytes(auth) !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** The browser family of a User-Agent string, and nothing more ("Chrome on Android"): enough to tell
 *  devices apart in a list, never a fingerprint. */
export function uaFamily(ua: string | null | undefined): string {
  const s = ua ?? "";
  const os = /iPhone|iPad|iPod/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : null;
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\/|CriOS/.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : null;
  if (!browser && !os) return "Unknown browser";
  return browser && os ? `${browser} on ${os}` : (browser ?? `Browser on ${os}`);
}

/** The event page, opened on one match. */
export const matchUrl = (season: number, code: string, key: string) => `/events/${season}/${encodeURIComponent(code)}?tab=matches&match=${encodeURIComponent(key)}`;
export const eventUrl = (season: number, code: string) => `/events/${season}/${encodeURIComponent(code)}`;

/** Is this a path in this app (what a notification may open)? Never another origin. */
export const safePushUrl = (u: unknown): string => (typeof u === "string" && /^\/(?!\/)[^\s\\]*$/.test(u) ? u : "/");
