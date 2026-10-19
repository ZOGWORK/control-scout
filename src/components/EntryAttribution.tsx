// Who wrote a shared scout entry, and when: "Priya · 2m ago", or
// "Priya · edited by Marcus · just now" when someone else made the latest edit.
// Personal entries show nothing here (they're all yours). Times tick with the
// app's shared clock (useNow), not a timer per row. A time that can't be right (0 after the stored-row repair in
// src/shared/scoutEntry.ts, missing, or out of range) reads "time unknown", like a personal entry's date.
import { agoShort, isKnownTime } from "../lib/format";
import type { ScoutEntry } from "../lib/scouting";
import { cn } from "./cn";
import { useNow } from "../lib/useNow";

interface Parts { author: string; editor: string | null; when: string }

/** The attribution of a workspace entry; null for a personal one. */
export function attribution(e: ScoutEntry, now: number): Parts | null {
  if (e.workspaceId == null) return null;
  // Not synced yet: the server stamps the author on the first push, so a new entry is yours.
  const author = e.authorDisplayName || "You";
  const editedByOther = !!e.editorAccountId && e.editorAccountId !== e.authorAccountId && !!e.editorDisplayName;
  return { author, editor: editedByOther ? e.editorDisplayName! : null, when: isKnownTime(e.updatedAt) ? agoShort(e.updatedAt, now) : "time unknown" };
}

/** As one line of text: "Priya · edited by Marcus · just now". */
export function attributionText(e: ScoutEntry, now: number): string | null {
  const p = attribution(e, now);
  return p && [p.author, p.editor && `edited by ${p.editor}`, p.when].filter(Boolean).join(" · ");
}

export function EntryAttribution({ e, className }: { e: ScoutEntry; className?: string }) {
  const now = useNow();
  const p = attribution(e, now);
  if (!p) return null;
  // The server accepts any finite updatedAt; one outside Date's range must not break the list.
  const valid = isKnownTime(e.updatedAt);
  const at = new Date(valid ? e.updatedAt : 0);
  return (
    <p className={cn("truncate text-xs text-muted-foreground", className)} title={valid ? `${attributionText(e, now)} (${at.toLocaleString()})` : undefined}>
      <span className="font-medium text-foreground">{p.author}</span>
      {p.editor && <> · edited by <span className="font-medium text-foreground">{p.editor}</span></>}
      {" · "}<time dateTime={valid ? at.toISOString() : undefined}>{p.when}</time>
    </p>
  );
}
