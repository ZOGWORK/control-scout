// Preview: the match header (wave 2, piece B) on a real event's schedule (?season=&event=, default 2025 USNJQ1),
// watching ?watch=red|blue|all|red1|red2|blue1|blue2. Progress is sample (dev only): the first five matches
// scouted, the sixth part way, the eighth done so the seventh shows as skipped. Below it, every ScheduleState.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useEventSchedule } from "../../lib/eventSchedule";
import { PageHeader } from "../../components/page";
import { MatchHeader, ScheduleState } from "../../components/scout/redesign/MatchHeader";
import { DEFAULT_WATCHING, matchProgress, nextMatchIndex, normalizeMatchLabel, SLOTS, teamsWatched, type SlotId, type Watching } from "../../shared/scoutMatch";

function watchingFrom(v: string | null): Watching {
  if (v === "all") return { kind: "all" };
  if (v === "red" || v === "blue") return { kind: "alliance", side: v };
  if (SLOTS.includes(v as SlotId)) return { kind: "slot", slot: v as SlotId };
  return DEFAULT_WATCHING;
}

export default function MatchHeaderPreview() {
  const [sp] = useSearchParams();
  const season = Number(sp.get("season")) || 2025, code = sp.get("event") || "USNJQ1";
  const w = sp.get("watch"), watching = useMemo(() => watchingFrom(w), [w]);
  const s = useEventSchedule(season, code);
  const scouted = useMemo(() => {
    const out = new Map<string, Set<number>>();
    s.matches.forEach((m, i) => {
      const teams = teamsWatched(m, watching).map((t) => t.team);
      const keep = i < 5 || i === 7 ? teams : i === 5 ? teams.slice(0, 1) : [];
      if (keep.length) out.set(normalizeMatchLabel(m.label) ?? "", new Set(keep));
    });
    return out;
  }, [s.matches, watching]);
  const next = nextMatchIndex(s.matches, watching, scouted);
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? Math.max(0, next);

  return (
    <div className="mx-auto grid max-w-md gap-6">
      <PageHeader title={s.eventName || code} description="Match header preview" />
      {s.status === "ready"
        ? <div className="grid gap-2">
          <ScheduleState status={s.status} fromDevice={s.fromDevice} />
          <MatchHeader schedule={s.matches} index={index} watching={watching} nextIndex={next}
            progress={(i) => matchProgress(s.matches[i], watching, scouted)} onIndex={setPicked} />
        </div>
        : <ScheduleState status={s.status} error={s.error} onRetry={() => void s.reload()} onManual={() => {}} />}
      <section className="grid gap-3">
        <h2 className="text-sm font-semibold text-text-muted">Schedule states</h2>
        <ScheduleState status="loading" />
        <ScheduleState status="none" onManual={() => {}} />
        <ScheduleState status="error" error="The server didn't answer." onRetry={() => {}} onManual={() => {}} />
        <ScheduleState status="ready" fromDevice />
      </section>
    </div>
  );
}
