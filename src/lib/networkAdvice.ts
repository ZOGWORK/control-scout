// The words of the Network & offline screen (src/components/settings/NetworkSection.tsx), from the facts
// connection.ts and liteSuggest.ts have: am I online, on what, and should I use Lite. Pure, unit tested.
import type { ConnectionType, Internet } from "./connection";

/** The one sentence at the top: online, offline, or a Wi-Fi that isn't giving internet. */
export function statusSentence(internet: Internet): string {
  if (internet === "yes") return "You're online";
  if (internet === "no") return "You're offline";
  if (internet === "portal") return "This Wi-Fi isn't giving internet (it may need a sign-in page)";
  return "Checking your connection…";
}

/** The connection in plain words. `raw` is navigator.connection.type, which tells a cable apart from Wi-Fi. */
export function connectionLabel(type: ConnectionType, raw?: string | null): string {
  if (type === "none") return "None";
  if (type === "cellular") return "Mobile data";
  if (type === "wifi") return raw === "ethernet" ? "Cable" : "Wi-Fi";
  return "Your browser doesn't say";
}

/** The browser's own guess at the link's speed (navigator.connection.effectiveType): these are slow. */
const SLOW = new Set(["slow-2g", "2g", "3g"]);

export interface AdviceInput {
  internet: Internet;
  /** navigator.connection.effectiveType, where the browser has it (Chrome, Android). */
  effectiveType?: string | null;
  /** The browser's Data Saver. */
  saveData: boolean;
  /** This visit already saw pages crawl or requests fail (src/lib/liteSuggest.ts useLiteReason). */
  slowSeen: boolean;
  /** Lite is on (the cs-lite cookie). */
  liteOn: boolean;
}

export type AdviceKind = "checking" | "offline" | "portal" | "slow" | "fine";
/** The recommendation, and the one button it offers (Lite on or off), if any. */
export interface Advice { kind: AdviceKind; text: string; action: "on" | "off" | null }

/** Should I use Lite right now? Only from what the browser and this visit have shown, never a guess. */
export function adviseLite(i: AdviceInput): Advice {
  if (i.internet === "no") return { kind: "offline", text: "You're offline: your downloaded packs work; Lite needs a connection.", action: null };
  // A Wi-Fi sign-in page answers Lite's pages too, so Lite can't help until the Wi-Fi gives internet.
  if (i.internet === "portal") return { kind: "portal", text: "This Wi-Fi isn't giving internet: your downloaded packs work; Lite needs a working connection.", action: null };
  if (i.internet === "unknown") return { kind: "checking", text: "Checking your connection…", action: null };
  const slow = i.slowSeen || i.saveData || (!!i.effectiveType && SLOW.has(i.effectiveType));
  if (slow) {
    return i.liteOn
      ? { kind: "slow", text: "Your connection is slow: Lite is on, and loads a fraction of the data.", action: null }
      : { kind: "slow", text: "Your connection is slow: Lite loads a fraction of the data.", action: "on" };
  }
  return i.liteOn
    ? { kind: "fine", text: "Your connection is fine: the full app is best. You can turn Lite off.", action: "off" }
    : { kind: "fine", text: "Your connection is fine: the full app is best.", action: null };
}

/** Why it says slow, in plain words (the first reason that holds), or null. */
export function slowReason(i: Pick<AdviceInput, "effectiveType" | "saveData" | "slowSeen">): string | null {
  if (i.slowSeen) return "Pages on this visit loaded slowly or couldn't reach the server.";
  if (i.saveData) return "Data Saver is on in your browser.";
  if (i.effectiveType && SLOW.has(i.effectiveType)) return "Your browser says this connection is slow.";
  return null;
}

/** Is Lite on in this browser? (The cs-lite cookie the server sets at /lite/on: src/shared/themeTokens.ts.) */
export function liteCookieOn(cookie = typeof document === "undefined" ? "" : document.cookie): boolean {
  return cookie.split(";").some((c) => c.trim() === "cs-lite=1");
}

/** Where Lite's on and off links send you back to: this screen, as the full app (?lite=0, or Lite would open its own
 *  settings), the fragment kept by the browser across the redirect. */
export const liteToggleHref = (on: boolean) => `/lite/${on ? "on" : "off"}?next=${encodeURIComponent("/settings?lite=0")}#network`;
