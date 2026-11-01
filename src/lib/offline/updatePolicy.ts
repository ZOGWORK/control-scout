// When a saved season has a newer release: what happens, decided from the person's two settings (ask first or
// download automatically; Wi-Fi only or Wi-Fi and mobile data), the connection and the release. Pure, unit
// tested; updateWatcher.tsx runs it, updateStore.ts keeps what it decided.
//
// The connection comes from the Network Information API (navigator.connection.type and saveData), which only
// some browsers have: Chrome on Android says "wifi" or "cellular", desktop Chrome has the object but no type,
// Safari and iOS have none of it. Updates download by themselves unless the person chose "Ask me": known mobile
// data on Wi-Fi only, or Data Saver, waits quietly for a better connection rather than asking. Where the browser
// doesn't say (every iPhone), it counts as Wi-Fi: asking on every update there was the nag people disliked.
import type { Settings } from "../../shared/personal";
import { constrained, type ConnectionInfo } from "../packPolicy";
import { seasonLabel } from "../format";
import { fmtBytes } from "../recordings";

export type UpdateMode = NonNullable<Settings["offlineUpdates"]>;
export type UpdateNetwork = NonNullable<Settings["offlineNetwork"]>;

/** The two settings, with their defaults: download automatically, Wi-Fi only. */
export function updatePrefs(s: Pick<Settings, "offlineUpdates" | "offlineNetwork"> | null | undefined): { mode: UpdateMode; network: UpdateNetwork } {
  return { mode: s?.offlineUpdates === "ask" ? "ask" : "auto", network: s?.offlineNetwork === "any" ? "any" : "wifi" };
}

/** What the browser says about the connection: Wi-Fi (or wired), mobile data, or nothing useful. */
export type NetKind = "wifi" | "cellular" | "unknown";

export function netKind(c: ConnectionInfo | null | undefined): NetKind {
  const t = c?.type;
  if (t === "wifi" || t === "ethernet") return "wifi";
  // Metered or tethered links count as mobile data.
  if (t === "cellular" || t === "wimax" || t === "bluetooth") return "cellular";
  return "unknown"; // no API (Safari, iOS), no type (desktop Chrome), "other", "unknown"
}

/** A saved season with a newer release (the parts the decision and the prompt need). */
export interface SeasonUpdate { season: number; sha256: string; bytes: number }

/** One season's release: "2025:<sha256>". Later, the pop-up and automatic retries are all tracked per release,
 *  so updating or removing one season never brings back (or retries early) another's. */
export const updateId = (u: Pick<SeasonUpdate, "season" | "sha256">) => `${u.season}:${u.sha256}`;

/** The pending updates as one string (null: none): changes whenever any of them does. */
export function releaseKey(updates: SeasonUpdate[]): string | null {
  if (!updates.length) return null;
  return [...updates].sort((a, b) => a.season - b.season).map(updateId).join(",");
}

/**
 * none: nothing to do (no update, offline, or "Later" for every one of them).
 * wait: an update is out but this connection isn't for it (mobile data on Wi-Fi only, or Data Saver on):
 *   no prompt, no download until it is.
 * prompt: ask (inbox item, plus one pop-up per release); only for someone who chose "Ask me".
 * download: download it now, no question.
 */
export type UpdateAction = "none" | "wait" | "prompt" | "download";

export interface UpdateInput {
  mode: UpdateMode;
  network: UpdateNetwork;
  connection: ConnectionInfo | null | undefined;
  online: boolean;
  /** updateId of each update out now (none: nothing to do). */
  pending: string[];
  /** Releases answered "Later" (updateIds). */
  later: string[];
}

export function decideUpdate(i: UpdateInput): UpdateAction {
  if (!i.pending.length || !i.online) return "none";
  const kind = netKind(i.connection);
  const saveData = i.connection?.saveData === true;
  if (i.network === "wifi" && kind === "cellular") return "wait";
  if (i.mode === "auto") return saveData ? "wait" : "download"; // an unknown connection counts as Wi-Fi
  return i.pending.every((id) => i.later.includes(id)) ? "none" : "prompt";
}

/** Should the pop-up show? Once per release: only for a release it hasn't shown for and that wasn't answered "Later". */
export function shouldPopUp(action: UpdateAction, pending: string[], shown: string[], later: string[]): boolean {
  return action === "prompt" && pending.some((id) => !shown.includes(id) && !later.includes(id));
}

/** May the lite pack (offline predictions, about 1.6 MB) download by itself on this connection? Same network
 *  setting: never on mobile data when Wi-Fi only. Where the browser doesn't say, it still does: it's small and
 *  has no prompt, and it's what makes predictions work at a venue (the Download page says so). */
export function liteAllowed(network: UpdateNetwork, c: ConnectionInfo | null | undefined): boolean {
  if (constrained(c)) return false;
  return !(network === "wifi" && netKind(c) === "cellular");
}

/** "2025–26", "2025–26 and 2024–25", "2025–26, 2024–25 and 2023–24". */
export const seasonList = (u: Pick<SeasonUpdate, "season">[]) => {
  const names = u.map((x) => seasonLabel(x.season));
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/** The question: "Offline data for 2025–26 has an update (41.9 MB)." */
export function updateQuestion(u: SeasonUpdate[]): string {
  const size = fmtBytes(u.reduce((n, x) => n + x.bytes, 0));
  return `Offline data for ${seasonList(u)} ${u.length === 1 ? "has an update" : "have updates"} (${size}).`;
}

/** The Download page's line about updates: what the settings do on this connection, in plain words. */
export function updateStatus(mode: UpdateMode, network: UpdateNetwork, c: ConnectionInfo | null | undefined): string {
  const kind = netKind(c);
  const on = network === "any" ? "on Wi-Fi and mobile data" : "on Wi-Fi";
  const base = mode === "auto" ? `Updates download automatically ${on}.` : `You'll be asked when an update is out (downloads ${on}).`;
  if (network === "wifi" && kind === "cellular") return `${base} You're on mobile data now, so updates wait for Wi-Fi.`;
  if (mode === "auto" && c?.saveData) return `${base} Data Saver is on, so updates wait until it's off.`;
  return base;
}
