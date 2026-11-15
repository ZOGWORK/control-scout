// Am I online, and on what: the words of the network screens, the full version's (src/components/settings/
// NetworkSection.tsx, through src/lib/networkAdvice.ts) and Lite's (server/lite/network.ts) alike. One source, so the
// two can never say different things about the same connection. Pure, unit tested (src/lib/networkAdvice.test.ts).
import { seasonLabel } from "./format";

/** Is there internet: "yes" (this server answered the check), "portal" (something else answered: a sign-in page),
 *  "no" (nothing answered), "unknown" (not checked yet). src/lib/connection.ts decides it. */
export type Internet = "yes" | "no" | "portal" | "unknown";
/** What the browser says the device is on. */
export type ConnectionType = "wifi" | "cellular" | "none" | "unknown";

/** The status at the top: a heading, and a line under it when the heading alone doesn't say what to do. */
export interface Status { title: string; detail: string | null }

/** Is the Wi-Fi actually giving internet? From the connection's facts: `internet` (the real check), `online`
 *  (navigator.onLine), `type`, and `raw` (navigator.connection.type, which tells a cable apart from Wi-Fi). */
export function statusSentence(s: { internet: Internet; online: boolean; type: ConnectionType }, raw?: string | null): Status {
  if (s.internet === "yes") return { title: "You're online", detail: null };
  if (s.internet === "portal") {
    // Something other than our server answered: the device has a network, but it's a sign-in page, not the internet.
    const wifi = s.type === "wifi" && raw !== "ethernet";
    return {
      title: wifi ? "Connected to Wi-Fi, but no internet" : "Connected to a network, but no internet",
      detail: `${wifi ? "This Wi-Fi" : "This network"} isn't giving internet. It's likely waiting at a sign-in page: open any website to sign in.`,
    };
  }
  if (s.internet === "no") {
    // The browser says it's on a network, yet nothing answered the check.
    if (s.online) return { title: "Connected, but nothing is getting through", detail: "Your device says it's on a network, but nothing answered. Your downloads still work." };
    return { title: "You're offline", detail: null };
  }
  return { title: "Checking your connection…", detail: null };
}

/** The connection in plain words. `raw` is navigator.connection.type, which tells a cable apart from Wi-Fi. */
export function connectionLabel(type: ConnectionType, raw?: string | null): string {
  if (type === "none") return "None";
  if (type === "cellular") return "Mobile data";
  if (type === "wifi") return raw === "ethernet" ? "Cable" : "Wi-Fi";
  return "Your browser doesn't say";
}

/** Bytes as people read them: "640 KB", "12.4 MB", "1.20 GB". */
export const fmtBytes = (b: number) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : b < 1e9 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e9).toFixed(2)} GB`);

/** The pack list's sizes, as much of it as these lines need (src/lib/packs.ts PackManifest, server/packs Manifest). */
export interface PackSizes { full: { seasons: number[]; bytes: number }[]; lite: { bytes: number } | null }

/** How much a download uses, one line each: the events downloaded here (up to two), then from the pack list the
 *  current season, every season, and the offline predictions. */
export function sizeLines(m: PackSizes | null, season: number, events: { name: string; bytes: number }[]): string[] {
  const lines: string[] = [];
  for (const e of events.slice(0, 2)) lines.push(`Downloading ${e.name} used ${fmtBytes(e.bytes)}.`);
  if (!m) return lines;
  const current = m.full.find((f) => f.seasons.includes(season));
  if (current) lines.push(`The whole ${seasonLabel(season)} season uses ${fmtBytes(current.bytes)}.`);
  if (m.full.length > 1) lines.push(`Every season (${m.full.length}) uses ${fmtBytes(m.full.reduce((n, f) => n + f.bytes, 0))}.`);
  if (m.lite) lines.push(`Offline predictions use ${fmtBytes(m.lite.bytes)}.`);
  return lines;
}

/** The internet itself, one row's worth: is what the device is connected to actually giving internet? */
export function internetLabel(internet: Internet, online: boolean): string {
  if (internet === "yes") return "Working";
  if (internet === "portal") return "Not yet: likely a sign-in page";
  if (internet === "no") return online ? "Nothing is getting through" : "None";
  return "Checking…";
}

// The controls, each choice with its name and the one line saying what it does before it's picked. `unknownNet`: this
// browser can't tell Wi-Fi from mobile data (every iPhone); the update policy then counts it as Wi-Fi
// (src/lib/offline/updatePolicy.ts), and the words say so.
export type DownloadNetwork = "wifi" | "any";
export type UpdateChoice = "auto" | "ask";

/** What the Lite switch does. */
export const LITE_LINE = "Opens the text-only Lite version of pages that have one. Turn off any time.";

/** "Mobile data counts against your plan: …", with the real sizes when the pack list is known. */
export function mobileWarning(m: PackSizes | null, season: number): string {
  const current = m?.full.find((f) => f.seasons.includes(season));
  return current
    ? `Mobile data counts against your plan: the whole ${seasonLabel(season)} season is ${fmtBytes(current.bytes)}${m?.lite ? `, offline predictions ${fmtBytes(m.lite.bytes)}` : ""}.`
    : "Mobile data counts against your plan: a season can be tens of MB.";
}

export function downloadChoices(unknownNet: boolean, warning: string): { value: DownloadNetwork; name: string; line: string }[] {
  return [
    { value: "wifi", name: "Wi-Fi only", line: unknownNet
      ? "This browser can't tell Wi-Fi from mobile data, so automatic updates may still use mobile data. To be sure, choose Never update automatically."
      : "Nothing downloads on mobile data unless you tap Download yourself." },
    { value: "any", name: "Wi-Fi and mobile data", line: warning },
  ];
}

export function updateChoices(network: DownloadNetwork, unknownNet: boolean): { value: UpdateChoice; name: string; line: string }[] {
  return [
    { value: "auto", name: network === "any" || unknownNet ? "Update packs automatically" : "Update packs automatically on Wi-Fi",
      line: network === "any" ? "Updates download by themselves, on Wi-Fi or mobile data."
        : unknownNet ? "Updates download by themselves. This browser can't tell Wi-Fi from mobile data, so that may include mobile data."
        : "Updates download by themselves when you're on Wi-Fi." },
    { value: "ask", name: "Never update automatically (I'll tap Update)", line: "You get a note when an update is out; nothing downloads until you tap Update." },
  ];
}
