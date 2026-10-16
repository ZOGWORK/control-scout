// Entry photos (docs/r2-photos.md): shapes and limits shared by the server and the web app.

/** A photo on a workspace scout entry, as the entry carries it. */
export interface EntryPhoto {
  /** The photo's id (the last part of its object key). */
  id: string;
  bytes: number;
  /** Who added it (shared account id) and their name in the workspace. */
  addedByAccountId: number;
  addedByName: string;
  /** ms */
  createdAt: number;
  /** The event ended (or the owner freed the space): the image is gone, the entry's text stays. */
  expired: boolean;
}

export const PHOTO_LIMITS = {
  /** Photos on one entry (expired ones don't count). */
  perEntry: 6,
  /** One upload, after compression on the device (a 1600 px JPEG is usually well under 1 MB). */
  maxBytes: 4_000_000,
  /** The long edge after compression, and the JPEG quality. */
  maxEdge: 1600,
  quality: 0.8,
} as const;

/** What a refused upload says when photo storage is at the soft cap. */
export const STORAGE_FULL = "Photo storage is full — ask your admin to free space";

/** Storage levels (bytes: 10^9 per GB, the cautious reading of R2's 10 GB free tier). */
export type StorageLevel = "ok" | "notice" | "warning" | "full";

/** An alert for the owner, kept until resolved (owner_alerts). Task 14's inbox turns these into inbox items. */
export interface OwnerAlert { id: number; kind: string; level: "info" | "warning"; title: string; body: string; createdAt: string; resolvedAt: string | null }

/** GET /api/owner/storage */
export interface OwnerStorage {
  /** R2 env set on this server. */
  configured: boolean;
  /** The photos switch (owner portal). */
  enabled: boolean;
  /** Stored and reserved (uploads in progress) bytes. */
  usedBytes: number;
  photos: number;
  limitBytes: number; noticeBytes: number; warningBytes: number; softCapBytes: number;
  level: StorageLevel;
  events: { season: number; eventCode: string; eventName: string | null; eventEnd: string | null; photos: number; bytes: number; expiresAt: number | null }[];
  /** The last nightly run (or one started here). */
  lastRun: { at: string; usedBytes: number; bucketBytes: number | null; bucketObjects: number | null; expired: number; removed: number; orphans: number; failures: number } | null;
  alert: OwnerAlert | null;
}
