// Entry photos on the device (docs/r2-photos.md, server/scout/photos.ts):
// compress, upload straight to storage, record, remove.
//
// Compression: every photo is decoded and drawn onto a canvas at most 1600 px
// on its long edge, then encoded as a JPEG at quality 0.8. Re-encoding through
// the canvas keeps only pixels: EXIF (GPS position, camera serial, time) never
// leaves the device. The phone's orientation is applied first, so the result is
// upright without its EXIF orientation tag. Event wifi is bad: a 12 MP phone
// photo of several MB becomes a few hundred KB.
import { apiFetch, ApiError } from "./api";
import { useServerFlag } from "./flags";
import { adoptServerEntry, type ScoutEntry } from "./scouting";
import { PHOTO_LIMITS } from "../shared/photos";

/** Photos on (R2 configured and the switch on), as the server last said. Off until it has answered. */
export const usePhotosAvailable = () => useServerFlag("photos");

/** The size to draw a w×h image at so its long edge is at most `max` (never enlarged; whole pixels, at least 1). */
export function fitWithin(w: number, h: number, max: number = PHOTO_LIMITS.maxEdge): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Does this JPEG carry an EXIF block (APP1 "Exif")? Walks the segment headers up to the image data. */
export function jpegHasExif(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return false;
    const marker = b[i + 1];
    if (marker === 0xda || marker === 0xd9) return false; // start of scan / end: no more metadata
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return true; // "Exif"
    i += 2 + len;
  }
  return false;
}

interface Drawable { width: number; height: number; close?: () => void }
export interface CompressDeps {
  /** Decode the file, upright (EXIF orientation applied). */
  decode: (file: Blob) => Promise<Drawable>;
  /** Draw it at width×height and encode a JPEG. */
  encode: (img: Drawable, width: number, height: number, quality: number) => Promise<Blob>;
}

const browserDeps: CompressDeps = {
  decode: async (file) => {
    if (typeof createImageBitmap === "function") {
      try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fall back to an <img> (older Safari) */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } finally { URL.revokeObjectURL(url); }
  },
  encode: (img, width, height, quality) => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("no canvas")); return; }
    ctx.fillStyle = "#fff"; // a transparent PNG gets white, not black
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img as CanvasImageSource, 0, 0, width, height);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality);
  }),
};

export class PhotoError extends Error {}

/** The photo, re-encoded: ≤1600 px, JPEG ~0.8 (lower if it's still too big), no EXIF. */
export async function compressPhoto(file: Blob, deps: CompressDeps = browserDeps): Promise<Blob> {
  let img: Drawable;
  try { img = await deps.decode(file); } catch { throw new PhotoError("That file isn't a photo this device can read."); }
  try {
    const { width, height } = fitWithin(img.width, img.height);
    if (!width) throw new PhotoError("That file isn't a photo this device can read.");
    for (const q of [PHOTO_LIMITS.quality, 0.7, 0.55]) {
      const out = await deps.encode(img, width, height, q);
      if (out.size <= PHOTO_LIMITS.maxBytes) return out;
    }
    throw new PhotoError("This photo is too large even after compressing it. Try another.");
  } finally { img.close?.(); }
}

/** Where an entry's photo is shown from (the server checks membership, then redirects to a short-lived link). */
export const photoSrc = (space: string, photoId: string) => `/api/scout/photos/${encodeURIComponent(photoId)}?workspaceId=${encodeURIComponent(space)}`;

/**
 * Add a photo to a synced workspace entry: compress, reserve (the server checks membership, the
 * 6-photo limit and storage), PUT straight to storage, then record it. The entry comes back with
 * the photo and replaces the device's copy; other members get it live.
 */
export async function uploadEntryPhoto(entry: ScoutEntry, file: Blob, deps?: CompressDeps): Promise<ScoutEntry> {
  const space = entry.workspaceId;
  if (space == null) throw new PhotoError("Photos are for workspace entries.");
  const jpeg = await compressPhoto(file, deps);
  const slot = await apiFetch<{ photoId: string; uploadUrl: string; headers: Record<string, string> }>("/api/scout/photos/presign", {
    method: "POST", json: { workspaceId: space, entryUuid: entry.uuid, bytes: jpeg.size },
  });
  let put: Response;
  try { put = await fetch(slot.uploadUrl, { method: "PUT", headers: slot.headers, body: jpeg }); }
  catch { throw new PhotoError("The upload didn't go through. Check the connection and try again."); }
  if (!put.ok) throw new PhotoError("Photo storage refused the upload. Try again.");
  const done = await apiFetch<{ entry: ScoutEntry | null }>(`/api/scout/photos/${slot.photoId}/complete`, { method: "POST", json: { workspaceId: space } });
  if (done.entry) adoptServerEntry(space, done.entry);
  return done.entry ?? entry;
}

/** Remove a photo (the server deletes the image, then its record). */
export async function removeEntryPhoto(entry: ScoutEntry, photoId: string): Promise<void> {
  const space = entry.workspaceId;
  if (space == null) return;
  const r = await apiFetch<{ entry: ScoutEntry | null }>(`/api/scout/photos/${encodeURIComponent(photoId)}?workspaceId=${encodeURIComponent(space)}`, { method: "DELETE" });
  if (r.entry) adoptServerEntry(space, r.entry);
}

/** A message for any failure above. */
export const photoErrorMessage = (e: unknown) =>
  e instanceof PhotoError || e instanceof ApiError ? (e as Error).message : "Something went wrong with the photo. Try again.";

/**
 * May you remove this photo? (the server's rule: who added it, the entry's author, or an admin).
 * `me.accountId` unknown (an older server): shown, and the server decides.
 */
export function canRemovePhoto(entry: ScoutEntry, photo: { addedByAccountId: number }, me: { accountId?: number; role?: "admin" | "member" } | null): boolean {
  if (!me?.role) return false;
  if (me.role === "admin" || me.accountId == null) return true;
  return photo.addedByAccountId === me.accountId || entry.authorAccountId === me.accountId;
}
