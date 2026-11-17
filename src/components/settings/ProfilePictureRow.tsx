// Settings › Account: the profile picture (server/auth/avatars.ts). Any account can have one; a linked account's is
// the same picture in Control Point, both ways. It shows on the account and next to the name on match videos.
import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Row } from "./rows";
import { Button } from "../ui/button";
import { FieldError } from "../ui/basic";
import { toast } from "../ui/sonner";
import { UserAvatar } from "../UserAvatar";
import { apiFetch } from "../../lib/api";
import { squarePicture } from "../../lib/avatarImage";
import { usePersonal, type AccountUser } from "../../lib/personal";

export function ProfilePictureRow({ user }: { user: AccountUser }) {
  const { refreshUser } = usePersonal();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"set" | "remove" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const name = user.displayName || user.email || "You";
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy("set"); setErr(null);
    try {
      const image = await squarePicture(file);
      await apiFetch("/api/me/avatar", { method: "PUT", json: { image } });
      await refreshUser();
      toast.success("Picture saved");
    } catch (e: any) {
      setErr((e?.body as { error?: string } | undefined)?.error ?? e?.message ?? "Not saved.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    setBusy("remove"); setErr(null);
    try {
      await apiFetch("/api/me/avatar", { method: "DELETE", json: {} });
      await refreshUser();
      toast("Picture removed");
    } catch (e: any) { setErr(e?.message ?? "Not removed."); }
    finally { setBusy(null); }
  };
  return (
    <Row label="Profile picture" stack
      description={<>Shows on your account and next to your name on match videos you add.{user.controlPointLinked ? " The same picture as in Control Point: change it in either app." : ""}</>}>
      <div className="flex items-center gap-3" data-profile-picture>
        <UserAvatar url={user.avatarUrl} name={name} className="size-14 text-xl" label={user.avatarUrl ? "Your profile picture" : "No profile picture yet"} />
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => void pick(e.target.files?.[0])} data-profile-picture-input />
        <Button type="button" variant="outline" disabled={!!busy} onClick={() => input.current?.click()}>
          <ImagePlus /> {busy === "set" ? "Saving…" : user.avatarUrl ? "Change" : "Add a picture"}
        </Button>
        {user.avatarUrl && (
          <Button type="button" variant="ghost" disabled={!!busy} onClick={() => void remove()} className="text-destructive">
            <Trash2 /> {busy === "remove" ? "Removing…" : "Remove"}
          </Button>
        )}
      </div>
      <FieldError id="profile-picture-error">{err}</FieldError>
    </Row>
  );
}
