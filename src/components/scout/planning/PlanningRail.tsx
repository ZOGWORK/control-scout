// Beside the pick list (Pick list & planning): what a member needs while ranking, without leaving it. Their open
// assignments (one tap to scout each), the workspace's latest activity, and the scouting alliance when it's on.
// Each card links to its full view. Under the list (its table needs the full width): side by side on a wide screen.
import { ArrowRight, ClipboardCheck, Handshake, History } from "lucide-react";
import type { ReactNode } from "react";
import type { Assignment } from "../../../shared/assignments";
import type { ActivityState } from "../../../lib/scoutActivity";
import { useNow } from "../../../lib/useNow";
import { ActivityRow } from "../ActivityFeed";
import { Button } from "../../ui/button";

const SHOWN = 5;

function RailCard({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const More = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <Button variant="ghost" size="sm" className="-mr-2 h-8 text-xs text-muted-foreground" onClick={onClick}>{label} <ArrowRight /></Button>
);

export function PlanningRail({ mine, onScout, readOnly, activity, onOpenEntry, alliancesOn, onView }: {
  /** This member's open team assignments. */
  mine: readonly Assignment[];
  onScout: (team: number, eventCode: string) => void;
  readOnly: boolean;
  activity: ActivityState;
  onOpenEntry: (uuid: string) => void;
  alliancesOn: boolean;
  onView: (view: "assignments" | "activity" | "alliance") => void;
}) {
  const now = useNow();
  const recent = activity.items.slice(0, SHOWN);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <RailCard title="Your assignments" icon={<ClipboardCheck />} action={<More label="All assignments" onClick={() => onView("assignments")} />}>
        {!mine.length ? <p className="px-4 py-3 text-sm text-muted-foreground">Nothing assigned to you right now.</p> : (
          <ul className="divide-y divide-border">
            {mine.slice(0, SHOWN).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-mono font-bold">{a.team}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{a.eventCode}</span>
                </span>
                {!readOnly && <Button size="sm" variant="outline" onClick={() => onScout(a.team, a.eventCode)} aria-label={`Scout ${a.team} at ${a.eventCode}`}>Scout</Button>}
              </li>
            ))}
            {mine.length > SHOWN && <li className="px-4 py-2 text-xs text-muted-foreground">and {mine.length - SHOWN} more</li>}
          </ul>
        )}
      </RailCard>
      <RailCard title="Latest activity" icon={<History />} action={<More label="All activity" onClick={() => onView("activity")} />}>
        {activity.loading && !recent.length ? <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
          : !recent.length ? <p className="px-4 py-3 text-sm text-muted-foreground">Nothing yet. Entries, edits and pick list changes show up here.</p>
            : <ol className="divide-y divide-border">{recent.map((i) => <ActivityRow key={i.id} item={i} now={now} onOpenEntry={onOpenEntry} />)}</ol>}
      </RailCard>
      {alliancesOn && (
        <RailCard title="Scouting alliance" icon={<Handshake />} action={<More label="Open" onClick={() => onView("alliance")} />}>
          <p className="px-4 py-3 text-sm text-muted-foreground">Share scouting with another team's workspace for one event, and see their pick list beside yours.</p>
        </RailCard>
      )}
    </div>
  );
}
