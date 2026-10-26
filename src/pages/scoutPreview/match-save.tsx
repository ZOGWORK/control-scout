// Preview (dev only): scouting one match for several teams, with team tabs and one Save. Sample schedule and
// teams; the old ScoutFieldInput list stands in for piece C's form. Save here is a dry run (nothing is written),
// so the preview never leaves entries on the device: ?team=<n> opens a tab, ?watch=all shows four teams.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page";
import { Label, Textarea } from "../../components/ui/basic";
import { ScoutFieldInput } from "../../components/scout/ScoutFieldInput";
import { TeamTabs } from "../../components/scout/redesign/TeamTabs";
import { SaveMatchBar } from "../../components/scout/redesign/SaveMatchBar";
import { useMatchDraft, type MatchSaveResult } from "../../lib/matchDraft";
import { resolveTemplate } from "../../lib/scoutTemplates";
import { phaseLabel, MATCH_PHASES } from "../../shared/scoutTemplate";
import { teamsWatched, type ScheduleMatch, type Watching } from "../../shared/scoutMatch";

const SCHEDULE: ScheduleMatch[] = [14, 15, 16].map((q, i) => ({
  key: `qual:0:${q}`, label: `Q${q}`, level: "qual", time: null, startsAt: null, played: false,
  red: [[4410, 18360], [7175, 23014], [11115, 16236]][i], blue: [[23014, 7175], [4410, 11115], [18360, 21229]][i],
}));

export default function MatchSavePreview() {
  const [sp] = useSearchParams();
  const [index, setIndex] = useState(0);
  const match = SCHEDULE[index];
  const watchAll = sp.get("watch") === "all";
  const watching = useMemo<Watching>(() => (watchAll ? { kind: "all" } : { kind: "alliance", side: "red" }), [watchAll]);
  const teams = useMemo(() => teamsWatched(match, watching), [match, watching]);
  const template = useMemo(() => resolveTemplate(null, 2025, "match"), []);
  const draft = useMatchDraft({ space: "preview", season: 2025, eventCode: "PREVIEW", match, teams, template, existing: [] });
  const [active, setActive] = useState(Number(sp.get("team")) || teams[0].team);
  const open = teams.some((t) => t.team === active) ? active : teams[0].team;
  // A started team on first load, so the dots and the empty-team hint show.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const f = template.fields.find((x) => x.type === "counter");
    if (f && !draft.teams[0].data[f.id]) draft.setAnswer(teams[0].team, f.id, 3);
  }, [draft, teams, template]);
  // Dry run: what saveMatch would save, without writing preview entries to the device.
  const dryRun = ({ includeEmpty }: { includeEmpty?: boolean }): MatchSaveResult => {
    const skipped = includeEmpty ? [] : draft.emptyTeams;
    return { ok: true, saved: draft.teams.filter((t) => t.status === "started" || (includeEmpty && t.status === "empty")).length, unchanged: draft.teams.filter((t) => t.status === "done").length, skipped };
  };
  const next = Math.min(index + 1, SCHEDULE.length - 1);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={`${match.label} · dev preview`} description="Several teams in one match, one Save. Sample teams; Save is a dry run here." />
      <TeamTabs teams={draft.teams.map((t) => ({ watched: t.watched, status: t.status }))} active={open} onSelect={setActive}
        renderForm={(w) => {
          const t = draft.teams.find((x) => x.watched.team === w.team)!;
          return (
            <div className="grid gap-4">
              {MATCH_PHASES.map((ph) => {
                const fields = t.template.fields.filter((f) => f.phase === ph);
                if (!fields.length) return null;
                return (
                  <fieldset key={ph} className="min-w-0 rounded-xl border border-border p-4">
                    <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{phaseLabel(ph)}</legend>
                    <div className="space-y-3">{fields.map((f) => <ScoutFieldInput key={f.id} f={f} idPrefix={`t${w.team}`} value={t.data[f.id]} onChange={(v) => draft.setAnswer(w.team, f.id, v)} />)}</div>
                  </fieldset>
                );
              })}
              <div>
                <Label htmlFor={`notes-${w.team}`}>Notes on {w.team}</Label>
                <Textarea id={`notes-${w.team}`} value={t.notes} onChange={(e) => draft.setNotes(w.team, e.target.value)} maxLength={4000} placeholder="What stood out? Strategy, reliability, driver habits…" className="mt-2" />
              </div>
            </div>
          );
        }} />
      <SaveMatchBar className="mt-4" label={match.label} teamCount={teams.length} nextLabel={next !== index ? SCHEDULE[next].label : null} nextIndex={next}
        emptyTeams={draft.emptyTeams} onSave={dryRun} onSaved={(i) => { setIndex(i); setActive(teamsWatched(SCHEDULE[i], watching)[0].team); }} />
    </div>
  );
}
