// Preview (dev only): quick mode, all 4 teams of a sample match on one screen, through the same draft as the
// full form (useMatchDraft, kept in sessionStorage under the "preview" space; nothing is saved as an entry).
// ?season=2023…2026 picks the built-in template, ?sample=1 fills in a few taps for the screenshot.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page";
import { QuickMatchForm, quickFields, type QuickToggleKind } from "../../components/scout/redesign/QuickMatchForm";
import { useMatchDraft } from "../../lib/matchDraft";
import { resolveTemplate } from "../../lib/scoutTemplates";
import { teamsWatched, type ScheduleMatch } from "../../shared/scoutMatch";
import type { ScoutValue } from "../../lib/scouting";
import type { ScoutTemplate } from "../../shared/scoutTemplate";

const MATCH: ScheduleMatch = { key: "qual:0:14", label: "Q14", level: "qual", time: null, startsAt: null, played: false, red: [4410, 18360], blue: [23014, 7175] };
/** A few taps per team, built from the season's quick fields: [count, choice option, toggles on]. */
const SAMPLE: [number, number, QuickToggleKind[]][] = [[12, 2, ["leave"]], [5, -1, ["defense"]], [9, 1, ["leave", "broke"]]];
const sampleFor = (template: ScoutTemplate) => {
  const q = quickFields(template);
  return SAMPLE.map(([n, opt, on]) => {
    const data: Record<string, ScoutValue> = {};
    if (q.counter) data[q.counter.id] = Math.min(n, q.counter.max ?? n);
    const o = q.choice?.options?.[opt];
    if (q.choice && o) data[q.choice.id] = o;
    for (const t of q.toggles) if (on.includes(t.kind)) data[t.field.id] = true;
    return data;
  });
};

export default function QuickPreview() {
  const [sp] = useSearchParams();
  const asked = Number(sp.get("season"));
  const season = asked >= 2023 && asked <= 2026 ? asked : 2026;
  const template = useMemo(() => resolveTemplate(null, season, "match"), [season]);
  const teams = useMemo(() => teamsWatched(MATCH, { kind: "all" }), []);
  const draft = useMatchDraft({ space: "preview-quick", season, eventCode: "PREVIEW", match: MATCH, teams, template, existing: [] });
  const [opened, setOpened] = useState<number | null>(null);
  // The whole record back from a tap, written answer by answer (the draft has no "clear" yet: a cleared
  // choice is written as "", which counts as not answered).
  const onChange = (team: number, data: Record<string, ScoutValue>) => {
    const was = draft.teams.find((t) => t.watched.team === team)?.data ?? {};
    for (const [id, v] of Object.entries(data)) if (was[id] !== v) draft.setAnswer(team, id, v);
    for (const id of Object.keys(was)) if (!(id in data)) draft.setAnswer(team, id, "");
  };
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !sp.get("sample")) return;
    seeded.current = true;
    sampleFor(template).forEach((data, i) => { for (const [id, v] of Object.entries(data)) draft.setAnswer(teams[i].team, id, v); });
  }, [draft, sp, template, teams]);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`${MATCH.label} · quick mode`} description={`All 4 teams, built-in ${season} template. Sample teams.`} />
      <QuickMatchForm teams={draft.teams} onChange={onChange} onOpenFull={setOpened} />
      <p className="mt-3 text-sm text-muted-foreground">
        {opened ? `The full form for ${opened} opens here in the scout page.` : "Quick mode: one counter and a few taps per team. Open the full form for one team for everything else."}
      </p>
    </div>
  );
}
