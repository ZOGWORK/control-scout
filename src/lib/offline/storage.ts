// What the Offline page lists under "On this device": every pack with its size here (the lite pack, each
// saved season, each event pack), half-finished downloads apart (never shown as saved), one total, and the
// plain-words line for a newer release. Pure, unit tested.
import type { PackMeta } from "../packPolicy";
import type { SavedSeason } from "./saved";
import type { PartialDownload } from "./download";
import type { SavedBundle } from "../../shared/eventBundle";
import { seasonLabel } from "../../shared/format";
import { snapshotClock } from "../../shared/eventBundle";

export type DeviceKind = "lite" | "season" | "bundle";

export interface DeviceItem {
  key: string;
  kind: DeviceKind;
  /** "2025–26 season", "Predictions for every team", the event's name. */
  label: string;
  bytes: number;
  /** When the data is from (the server's last sync before the build). */
  dataAsOf: string | null;
  savedAt: number;
  season?: number;
  bundle?: SavedBundle;
}

export interface PausedItem {
  key: string;
  kind: DeviceKind;
  label: string;
  /** Bytes kept so far, of `total`. */
  have: number;
  total: number;
  pct: number;
  /** The whole file is here and checked; only saving it is left (a save that failed, or one under way). */
  verified: boolean;
  partial: PartialDownload;
}

/** Every saved pack: predictions first, then seasons (newest first), then event packs (soonest first). */
export function deviceItems(lite: PackMeta | null, seasons: SavedSeason[], bundles: SavedBundle[]): DeviceItem[] {
  const out: DeviceItem[] = [];
  if (lite) out.push({ key: "lite", kind: "lite", label: "Predictions for every team", bytes: lite.bytes, dataAsOf: lite.dataAsOf ?? lite.builtAt, savedAt: lite.savedAt });
  for (const s of [...seasons].sort((a, b) => b.season - a.season)) {
    out.push({ key: `season:${s.season}`, kind: "season", label: `${seasonLabel(s.season)} season`, bytes: s.bytes, dataAsOf: s.dataAsOf ?? s.builtAt, savedAt: s.savedAt, season: s.season });
  }
  for (const b of bundles) out.push({ key: `bundle:${b.season}:${b.code}`, kind: "bundle", label: b.name, bytes: b.bytes, dataAsOf: b.dataAsOf ?? b.builtAt, savedAt: b.savedAt, bundle: b });
  return out;
}

/** Half downloads worth resuming: season packs and the lite pack (an event pack is small: it simply starts again). */
export function pausedItems(partials: PartialDownload[], activeKeys: Set<string> = new Set()): PausedItem[] {
  return partials
    .filter((p) => (p.owner.kind === "season" || p.owner.kind === "lite") && !activeKeys.has(`${p.owner.kind}:${p.owner.id}`))
    .map((p) => ({ key: `${p.owner.kind}:${p.owner.id}`, kind: p.owner.kind, label: p.owner.label, have: p.have, total: p.bytes, pct: Math.floor((p.have / Math.max(1, p.bytes)) * 100), verified: !!p.verified, partial: p }));
}

/** Bytes on the device for these packs and half downloads. */
export const totalBytes = (items: Pick<DeviceItem, "bytes">[], paused: Pick<PausedItem, "have">[] = []) =>
  items.reduce((n, i) => n + i.bytes, 0) + paused.reduce((n, p) => n + p.have, 0);

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * What a newer release brings, in plain words: "Newer data from Nov 14, 9:02 AM · 214 new matches from 3 more
 * events". The counts only when both releases carry them (packs from 6.0.5 on); the time always.
 */
export function whatChanged(have: { dataAsOf: string | null; stats?: { matches: number; events: number } }, latest: { dataAsOf: string | null; builtAt?: string; stats?: { matches: number; events: number } }, now = new Date()): string {
  const at = latest.dataAsOf ?? latest.builtAt ?? null;
  const parts = [at ? `Newer data from ${snapshotClock(at, now)}` : "Newer data"];
  if (have.stats && latest.stats) {
    const m = latest.stats.matches - have.stats.matches;
    const e = latest.stats.events - have.stats.events;
    if (m > 0) parts.push(`${plural(m, "new match", "new matches")}${e > 0 ? ` from ${plural(e, "more event", "more events")}` : ""}`);
    else if (e > 0) parts.push(plural(e, "more event with results", "more events with results"));
  }
  return parts.join(" · ");
}

/** "Data from Nov 13, 8:09 PM". */
export const dataFrom = (iso: string | null, now = new Date()) => (iso ? `Data from ${snapshotClock(iso, now)}` : "Data time unknown");
