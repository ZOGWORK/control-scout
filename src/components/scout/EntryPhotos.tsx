// Photos on a workspace scout entry (docs/r2-photos.md): a strip of lazy-loaded
// thumbnails, an add button where the entry can be edited, and a fullscreen
// viewer (swipe or arrow keys between photos, remove if you may). Hidden
// entirely when photos are off (R2 not configured, or the owner's switch).
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, ImageOff, ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../ui/overlay";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { agoShort } from "../../lib/format";
import { usePersonal } from "../../lib/personal";
import { canRemovePhoto, photoErrorMessage, photoSrc, removeEntryPhoto, uploadEntryPhoto, usePhotosAvailable } from "../../lib/photos";
import type { ScoutEntry } from "../../lib/scouting";
import { PHOTO_LIMITS, type EntryPhoto } from "../../shared/photos";

export type PhotoViewer = { accountId?: number; role?: "admin" | "member" } | null;

/** You, in this entry's workspace: your shared account id (when the server sends it) and role. */
function useMe(space: string | null): PhotoViewer {
  const { user } = usePersonal();
  const cp = user?.controlPoint;
  if (space == null || !cp) return null;
  return { accountId: cp.accountId, role: cp.workspaces?.find((w) => w.id === space)?.role };
}

/** The photo strip. `editable`: show the add button (the entry form). */
export function EntryPhotos({ entry, editable = false, className }: { entry: ScoutEntry; editable?: boolean; className?: string }) {
  const available = usePhotosAvailable();
  const me = useMe(entry.workspaceId);
  const [open, setOpen] = useState<number | null>(null);
  const [uploading, setUploading] = useState(0);
  // The last upload's failure stays under the strip (the toast goes after a few seconds).
  const [error, setError] = useState<string | null>(null);
  if (!available || entry.workspaceId == null) return null;
  const photos = (entry.photos ?? []).filter((p) => !p.expired);
  const expired = (entry.photos ?? []).length - photos.length;
  if (!editable && !photos.length && !expired) return null;
  const synced = !!entry.authorAccountId; // on the server: photos attach to its copy
  const room = PHOTO_LIMITS.perEntry - photos.length - uploading;

  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, Math.max(0, room));
    if (files && files.length > list.length) toast(`An entry holds up to ${PHOTO_LIMITS.perEntry} photos, so only ${list.length} will be added.`);
    setError(null);
    for (const f of list) {
      setUploading((n) => n + 1);
      try { await uploadEntryPhoto(entry, f); }
      catch (e) { const msg = photoErrorMessage(e); setError(msg); toast.error(msg); }
      finally { setUploading((n) => n - 1); }
    }
  };

  return (
    <div className={cn("min-w-0", className)}>
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
        {photos.map((p, i) => (
          <li key={p.id} className="shrink-0">
            <button type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1} of ${photos.length}, added by ${p.addedByName || "a member"}`}
              className="block size-16 overflow-hidden rounded-lg border border-border bg-muted sm:size-20">
              <Thumb space={entry.workspaceId!} photo={p} />
            </button>
          </li>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <li key={`up-${i}`} className="grid size-16 shrink-0 place-items-center rounded-lg border border-dashed border-border sm:size-20" aria-label="Uploading a photo">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </li>
        ))}
        {editable && synced && room > 0 && <li className="shrink-0"><AddPhoto onFiles={add} /></li>}
      </ul>
      {expired > 0 && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageOff className="size-3.5" aria-hidden />{expired === 1 ? "Photo expired" : `${expired} photos expired`} · photos are removed 2 days after the event
        </p>
      )}
      {editable && error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
      {editable && !synced &&<p className="text-xs text-muted-foreground">Save and sync this entry, then add photos.</p>}
      {open != null && photos.length > 0 && (
        <PhotoViewerDialog entry={entry} photos={photos} index={Math.min(open, photos.length - 1)} me={me} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function Thumb({ space, photo }: { space: string; photo: EntryPhoto }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="grid size-full place-items-center text-muted-foreground" title="Photo unavailable"><ImageOff className="size-5" aria-hidden /></span>;
  return <img src={photoSrc(space, photo.id)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="size-full object-cover" />;
}

function AddPhoto({ onFiles }: { onFiles: (f: FileList | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => input.current?.click()}
        className="grid size-16 place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-accent/60 hover:text-accent sm:size-20">
        <span className="flex flex-col items-center gap-0.5 text-[11px]"><ImagePlus className="size-5" aria-hidden />Add photo</span>
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} aria-label="Add photos" />
    </>
  );
}

function PhotoViewerDialog({ entry, photos, index, me, onIndex, onClose }: {
  entry: ScoutEntry; photos: EntryPhoto[]; index: number; me: PhotoViewer; onIndex: (i: number) => void; onClose: () => void;
}) {
  const p = photos[index];
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  useEffect(() => { setConfirming(false); }, [p?.id]);
  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);
  // Swipe: a horizontal drag of 40 px or more moves to the next or previous photo.
  const start = useRef<{ x: number; y: number } | null>(null);
  const down = (e: ReactPointerEvent) => { start.current = { x: e.clientX, y: e.clientY }; };
  const up = (e: ReactPointerEvent) => {
    const s = start.current; start.current = null;
    if (!s || photos.length < 2) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };
  const remove = async () => {
    setRemoving(true);
    try {
      await removeEntryPhoto(entry, p.id);
      toast.success("Photo removed");
      if (photos.length <= 1) onClose(); else onIndex(Math.min(index, photos.length - 2));
    } catch (e) { toast.error(photoErrorMessage(e)); }
    finally { setRemoving(false); setConfirming(false); }
  };
  if (!p) return null;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent showClose={false} aria-describedby={undefined}
        onKeyDown={(e) => { if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); }}
        className="inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white">
        <DialogTitle className="sr-only">Photo {index + 1} of {photos.length}, team {entry.team}</DialogTitle>
        <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm" style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}>
          <DialogDescription className="min-w-0 truncate text-white/80">
            <span className="font-mono">{entry.team}</span> · {index + 1} / {photos.length} · {p.addedByName || "A member"} · {agoShort(p.createdAt)}
          </DialogDescription>
          <DialogClose className="grid size-11 shrink-0 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="size-5" /></DialogClose>
        </div>
        <div className="relative min-h-0 flex-1 touch-pan-y select-none" onPointerDown={down} onPointerUp={up}>
          <img key={p.id} src={photoSrc(entry.workspaceId!, p.id)} alt={`Photo of team ${entry.team}, added by ${p.addedByName || "a member"}`} draggable={false}
            className="absolute inset-0 size-full object-contain" />
          {photos.length > 1 && (
            <>
              <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronLeft className="size-6" /></button>
              <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white hover:bg-black/70"><ChevronRight className="size-6" /></button>
            </>
          )}
        </div>
        {canRemovePhoto(entry, p, me) && (
          <div className="flex items-center justify-end gap-2 px-3 py-2" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
            {confirming ? (
              <>
                <span className="mr-auto text-sm text-white/80">Remove this photo for everyone?</span>
                <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setConfirming(false)} disabled={removing}>Keep</Button>
                <Button variant="destructive" onClick={() => void remove()} disabled={removing}>{removing ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove</Button>
              </>
            ) : (
              <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setConfirming(true)}><Trash2 /> Remove photo</Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
