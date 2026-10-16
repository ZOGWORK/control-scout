// Sharing a matchup's card (src/components/ShareMatch.tsx): the phone's own
// share sheet with the image attached where the browser can do that, else the
// image is downloaded. The link always goes along (the page it names unfurls
// into the same card).
import { shareFileName, shareImagePath, sharePagePath, type ShareCardQuery } from "../shared/share";

/** How long a fetched card is reused: long enough for one share (opening the panel fetches it, the tap
 *  uses it), short enough that coming back later gets the card for the latest data. */
export const CARD_FILE_TTL_MS = 5 * 60_000;

/** The card's PNG as a File (reused for a few minutes per address; a failed fetch is retried next time). */
const files = new Map<string, { at: number; p: Promise<File> }>();
export function cardFile(q: ShareCardQuery): Promise<File> {
  const path = shareImagePath(q);
  const hit = files.get(path);
  let p = hit && Date.now() - hit.at < CARD_FILE_TTL_MS ? hit.p : undefined;
  if (!p) {
    // Revalidated with the server (its ETag makes an unchanged card a cheap 304), never taken stale from the HTTP cache.
    p = fetch(path, { cache: "no-cache" }).then(async (r) => {
      if (!r.ok) {
        const msg = await r.json().then((j: { error?: string }) => j.error, () => null).catch(() => null);
        throw new Error(msg || "Couldn't make the image just now.");
      }
      return new File([await r.blob()], shareFileName(q), { type: "image/png" });
    });
    const entry = { at: Date.now(), p };
    files.delete(path);
    files.set(path, entry);
    p.catch(() => { if (files.get(path) === entry) files.delete(path); });
    if (files.size > 8) files.delete(files.keys().next().value!);
  }
  return p;
}

/** The page link for a matchup, on this site's origin. */
export const shareUrl = (q: ShareCardQuery) => `${location.origin}${sharePagePath(q)}`;

/** The share sheet can take this image (navigator.share with files). */
export function canShareFiles(file?: File): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try { return navigator.canShare({ files: [file ?? new File([], "card.png", { type: "image/png" })] }); } catch { return false; }
}

/** Save a file through a temporary download link. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export type ShareOutcome = "shared" | "cancelled" | "downloaded";

/**
 * Share the card: the share sheet with the image (and the link in its text) where supported,
 * otherwise (no navigator.share, no file support, or the sheet failed) a download.
 */
export async function shareCard(q: ShareCardQuery, text: string): Promise<ShareOutcome> {
  const file = await cardFile(q);
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: "Control Scout prediction", text: `${text}\n${shareUrl(q)}` });
      return "shared";
    } catch (e) {
      // Closing the sheet isn't a failure. Anything else (no permission, a target that refused) falls back to a download.
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  downloadFile(file);
  return "downloaded";
}
