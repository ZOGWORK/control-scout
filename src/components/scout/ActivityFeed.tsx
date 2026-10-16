// The Activity view of a workspace's scout space (?view=activity): who did
// what, newest first, grouped by day, live from the workspace's stream.
// Every member sees it. Tapping an item about an entry opens that entry.
import type { ComponentType } from "react";
import { Camera, History, ImageMinus, LayoutList, Loader2, Pencil, Plus, RotateCcw, Trash2, UserMinus, UserPlus } from "lucide-react";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { activityEntry, describeActivity, groupByDay, type ActivityItem, type ActivityState } from "../../lib/scoutActivity";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { cn } from "../cn";

const LOOK: Record<string, { icon: ComponentType<{ className?: string }>; tone: string }> = {
  "entry.added": { icon: Plus, tone: "bg-success/15 text-success" },
  "entry.edited": { icon: Pencil, tone: "bg-accent/15 text-accent-text" },
  "entry.deleted": { icon: Trash2, tone: "bg-destructive/15 text-destructive" },
  "entry.restored": { icon: RotateCcw, tone: "bg-info/15 text-info" },
  "entry.version_restored": { icon: History, tone: "bg-info/15 text-info" },
  "photo.added": { icon: Camera, tone: "bg-info/15 text-info" },
  "photo.removed": { icon: ImageMinus, tone: "bg-muted text-muted-foreground" },
  "template.changed": { icon: LayoutList, tone: "bg-warning/15 text-warning" },
  "member.joined": { icon: UserPlus, tone: "bg-success/15 text-success" },
  "member.left": { icon: UserMinus, tone: "bg-muted text-muted-foreground" },
};
const FALLBACK = { icon: History, tone: "bg-muted text-muted-foreground" };

export function ActivityFeed({ state, workspaceName, onOpenEntry }: {
  state: ActivityState; workspaceName: string;
  onOpenEntry: (uuid: string) => void;
}) {
  const now = useNow();
  const { items, loading, error, more, loadingOlder, loadOlder, reload } = state;
  return (
    <Section title="Activity" description={`Everything that happens in ${workspaceName}, newest first. Kept for 90 days.`}>
      {loading && !items.length ? <LoadingBlock rows={4} label="Loading activity" />
        : error && !items.length ? <ErrorState error={error} onRetry={reload} />
          : !items.length ? <EmptyState icon={History} title="Nothing here yet" description="New entries, edits, template changes and members joining show up here as they happen." />
            : (
              <div className="space-y-6">
                {groupByDay(items, now).map((g) => (
                  <section key={g.key} aria-label={g.label}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</h3>
                    <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                      {g.items.map((i) => <ActivityRow key={i.id} item={i} now={now} onOpenEntry={onOpenEntry} />)}
                    </ol>
                  </section>
                ))}
                {error && <p role="alert" className="text-sm text-destructive">{error.message}</p>}
                {more && (
                  <div className="flex justify-center">
                    <Button variant="outline" onClick={loadOlder} disabled={loadingOlder}>
                      {loadingOlder && <Loader2 className="animate-spin" />} Load older
                    </Button>
                  </div>
                )}
              </div>
            )}
    </Section>
  );
}

function ActivityRow({ item, now, onOpenEntry }: { item: ActivityItem; now: number; onOpenEntry: (uuid: string) => void }) {
  const { icon: Icon, tone } = LOOK[item.type] ?? FALLBACK;
  const { verb, subject, note } = describeActivity(item);
  // A deleted entry's line opens it too: the page shows its History, where it can be restored (Task 16).
  const target = activityEntry(item) ?? (item.type === "entry.deleted" && item.subject.startsWith("entry:") ? item.subject.slice(6) || null : null);
  const at = new Date(item.at);
  const body = (
    <>
      <span aria-hidden className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone)}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug">
          <span className="font-medium text-foreground">{item.actor.name || "A member"}</span>{" "}
          <span className="text-muted-foreground">{verb}</span>{" "}
          {subject && <span className="font-medium text-foreground">{subject}</span>}
        </span>
        {note && <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>}
      </span>
      <time dateTime={at.toISOString()} title={at.toLocaleString()} className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{agoShort(item.at, now)}</time>
    </>
  );
  return (
    <li>
      {target ? (
        <button type="button" onClick={() => onOpenEntry(target)}
          className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
          {body}
        </button>
      ) : <div className="flex min-h-14 items-start gap-3 px-4 py-3">{body}</div>}
    </li>
  );
}
