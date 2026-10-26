// Preview: the Matches tab on a real event's schedule (?season=&event=) with sample progress: the first
// six matches scouted except two skipped and one partly done. ?watch=red|blue|all|red1… picks what the
// scout watches; ?workspace=1 adds sample names for the other alliance. Dev only.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useEventSchedule } from "../../lib/eventSchedule";
import { PageHeader } from "../../components/page";
import { MatchesList, type OtherScout } from "../../components/scout/redesign/MatchesList";
import { DEFAULT_WATCHING, nextMatchIndex, normalizeMatchLabel, parseWatching, teamsWatched, type Watching } from "../../shared/scoutMatch";

function watchingFrom(v: string | null): Watching {
  if (v === "all") return { kind: "all" };
  if (v === "red" || v === "blue") return { kind: "alliance", side: v };
  return parseWatching({ kind: "slot", slot: v }) ?? DEFAULT_WATCHING;
}

const SKIP = new Set([1, 3]), PARTIAL = 4, DONE_UP_TO = 6, NAMES = ["Priya", "Marcus", "Jo"];

export default function MatchesPreview() {
  const [sp] = useSearchParams();
  const season = Number(sp.get("season")) || 2025, code = sp.get("event") || "USMICHQ";
  const watching = useMemo(() => watchingFrom(sp.get("watch")), [sp]);
  const s = useEventSchedule(season, code);
  const scouted = useMemo(() => {
    const out = new Map<string, Set<number>>();
    s.matches.slice(0, DONE_UP_TO).forEach((m, i) => {
      if (SKIP.has(i)) return;
      const teams = teamsWatched(m, watching).map((t) => t.team);
      out.set(normalizeMatchLabel(m.label) ?? m.label, new Set(i === PARTIAL ? teams.slice(0, 1) : teams));
    });
    return out;
  }, [s.matches, watching]);
  const others = useMemo(() => {
    if (sp.get("workspace") !== "1" || watching.kind === "all") return undefined;
    const other: OtherScout["side"] = watching.kind === "alliance" ? (watching.side === "red" ? "blue" : "red") : watching.slot.startsWith("red") ? "blue" : "red";
    return new Map(s.matches.map((m, i) => [normalizeMatchLabel(m.label) ?? m.label, [{ side: other, name: NAMES[i % 3], done: i < DONE_UP_TO - 1 }]]));
  }, [s.matches, sp, watching]);
  const next = useMemo(() => nextMatchIndex(s.matches, watching, scouted), [s.matches, watching, scouted]);
  const [opened, setOpened] = useState<number | null>(null);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Your matches" description={`${s.eventName || code} · ${s.status}${s.fromDevice ? " (kept on this device)" : ""}`} />
      <MatchesList schedule={s.matches} watching={watching} scouted={scouted} currentIndex={opened ?? next} nextIndex={next} onOpen={setOpened} others={others} />
    </div>
  );
}
