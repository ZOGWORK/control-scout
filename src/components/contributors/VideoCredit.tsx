// The one line under a match video someone added (docs/contributors.md): "Video by <actual name>", a small check when
// they're verified, a heart with the count (the only social action), and a three-dot menu: Report for a viewer, Edit
// and Remove for the person who added it. The same on every surface the video shows. There is no dislike and no
// comment anywhere. The badge comes from the server (verified now); a check typed into a name is just text.
import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Flag, Heart, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/overlay";
import { Button } from "../ui/button";
import { FieldError, Input, Textarea } from "../ui/basic";
import { toast } from "../ui/sonner";
import { usePersonal } from "../../lib/personal";
import { useAccountSetup } from "../AccountSetup";
import { useOpenSignIn } from "../layout/AccountMenu";
import { announceVideosChanged, editVideo, likeVideo, removeVideo, reportVideo } from "../../lib/contributors";
import { TEXT_MAX, VIDEO_REPORT_REASONS, VIDEO_REPORT_REASON_LABEL, type VideoReportReason } from "../../shared/contributors";
import { cn } from "../cn";

export interface CreditInfo { id: number; name: string; verified: boolean; profile: string | null; likes: number; liked: boolean; mine: boolean; tier?: "public" | "team" | "self" }

export function VerifiedMark({ className }: { className?: string }) {
  return <BadgeCheck className={cn("inline size-4 shrink-0 text-accent-text", className)} role="img" aria-label="Verified contributor" data-verified-badge />;
}

/** "Video by Parthiv ✓  ♥ 3  ⋯". `size`: sm under a tile, md under a player. */
export function VideoCredit({ c, size = "md", className }: { c: CreditInfo; size?: "sm" | "md"; className?: string }) {
  const { user } = usePersonal();
  const { ensure } = useAccountSetup();
  const openSignIn = useOpenSignIn();
  const [likes, setLikes] = useState(c.likes);
  const [liked, setLiked] = useState(c.liked);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"report" | "edit" | "remove" | null>(null);
  useEffect(() => { setLikes(c.likes); setLiked(c.liked); }, [c.id, c.likes, c.liked]);
  const toggle = async () => {
    if (!user) { toast("Sign in to like videos"); openSignIn(); return; }
    if (!(await ensure("Liking a video needs a username."))) return;
    const on = !liked;
    setLiked(on); setLikes((n) => Math.max(0, n + (on ? 1 : -1))); setBusy(true);
    try { const r = await likeVideo(c.id, on); setLikes(r.likes); setLiked(r.liked); }
    catch (e: any) { setLiked(!on); setLikes((n) => Math.max(0, n + (on ? -1 : 1))); toast.error(e?.message ?? "Didn't save"); }
    finally { setBusy(false); }
  };
  const text = size === "sm" ? "text-xs" : "text-sm";
  const name = c.profile
    ? <Link to={c.profile} className="font-medium text-text-base underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
    : <span className="font-medium text-text-base">{c.name}</span>;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", text, className)} data-video-credit>
      <span className="min-w-0 truncate text-text-muted">Video by {name}</span>
      {c.verified && <VerifiedMark className={size === "sm" ? "size-3.5" : undefined} />}
      <span className="ml-auto flex shrink-0 items-center">
        <button type="button" onClick={(e) => { e.stopPropagation(); void toggle(); }} disabled={busy} aria-pressed={liked} aria-label={`${liked ? "Unlike" : "Like"} this video, ${likes} like${likes === 1 ? "" : "s"}`}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-text-muted hover:bg-text-base/[0.06] hover:text-text-base pointer-coarse:min-h-11 pointer-coarse:min-w-11" data-like-button>
          <Heart className={cn("size-4", liked && "fill-current text-red-500")} aria-hidden /><span className="tabular-nums" data-like-count>{likes}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" onClick={(e) => e.stopPropagation()} aria-label="More for this video" className="inline-flex size-9 items-center justify-center rounded-md text-text-muted hover:bg-text-base/[0.06] hover:text-text-base pointer-coarse:size-11" data-video-menu>
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {c.mine ? (
              <>
                <DropdownMenuItem onSelect={() => setDialog("edit")}><Pencil /> Edit link</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("remove")} className="text-destructive"><Trash2 /> Remove link</DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={async () => {
                if (!user) { toast("Sign in to report a video"); openSignIn(); return; }
                if (await ensure("Reporting a video needs a username.")) setDialog("report");
              }}><Flag /> Report</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      {dialog === "report" && <ReportDialog id={c.id} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditDialog id={c.id} onClose={() => setDialog(null)} />}
      {dialog === "remove" && <RemoveDialog id={c.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ReportDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [reason, setReason] = useState<VideoReportReason | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const send = async () => {
    if (!reason) { setErr("Pick what's wrong with it."); return; }
    setBusy(true); setErr(null);
    try { const r = await reportVideo(id, reason, note.trim()); toast.success(r.message); onClose(); }
    catch (e: any) { setErr(e?.message ?? "Not sent."); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle>Report this video</DialogTitle>
          <DialogDescription>What's wrong with it? The site owner reads every report. It stays up while they look.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Reason</legend>
          {VIDEO_REPORT_REASONS.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/[0.08]">
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => { setReason(r); setErr(null); }} className="accent-[var(--color-accent)]" />
              {VIDEO_REPORT_REASON_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1">
          <label htmlFor={noteId} className="text-xs text-text-muted">Anything to add? (optional)</label>
          <Textarea id={noteId} value={note} maxLength={TEXT_MAX} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. this is Q12, not Q6" />
        </div>
        <FieldError id="report-error">{err}</FieldError>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void send()} disabled={busy}>{busy ? "Sending…" : "Send report"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ code: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (confirm?: string) => {
    setBusy(true); setErr(null);
    try {
      await editVideo(id, { url, confirmLong: confirm === "long" || ask?.code === "long", confirmDuplicate: confirm === "duplicate" || ask?.code === "duplicate" });
      toast.success("Link updated"); announceVideosChanged(); onClose();
    } catch (e: any) {
      const b = e?.body as { code?: string; error?: string } | undefined;
      if (b?.code === "long" || b?.code === "duplicate") setAsk({ code: b.code, text: b.error ?? "" });
      else setErr(b?.error ?? e?.message ?? "Not saved.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit link</DialogTitle><DialogDescription>Paste the right YouTube link for this match.</DialogDescription></DialogHeader>
        <Input value={url} onChange={(e) => { setUrl(e.target.value); setErr(null); setAsk(null); }} placeholder="https://youtu.be/…" aria-label="YouTube link" className="h-11 text-base sm:h-10 sm:text-sm" />
        <FieldError id="edit-error">{err}</FieldError>
        {ask && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">{ask.text}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save(ask?.code)} disabled={busy || !url}>{ask ? "Yes, use it" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Remove this video for everyone?</DialogTitle><DialogDescription>It stops showing at once, and its likes go with it.</DialogDescription></DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await removeVideo(id); toast.success("Removed"); announceVideosChanged(); onClose(); }
            catch (e: any) { toast.error(e?.message ?? "Not removed"); setBusy(false); }
          }}>Remove link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
