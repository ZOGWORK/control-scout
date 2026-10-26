// Preview (dev only): the one-phase-at-a-time form on the built-in 2026 template. ?phase= opens a tab
// (auto, teleop, endgame, overall), ?sample=1 fills in a few taps so the screenshot shows answered fields.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page";
import { PhaseForm } from "../../components/scout/redesign/PhaseForm";
import { builtinTemplate } from "../../shared/scoutDefaults";
import { MATCH_PHASES, type FieldPhase } from "../../shared/scoutTemplate";
import type { ScoutValue } from "../../lib/scouting";

const SAMPLE: Record<string, ScoutValue> = { autoLeave: true, autoHive: 2, pollen: 14, garden: 6, park: "Partial", driver: 4, broke: true, fouls: 1 };

export default function PhaseFormPreview() {
  const [sp] = useSearchParams();
  const asked = sp.get("phase") as FieldPhase | null;
  const [phase, setPhase] = useState<FieldPhase>(asked && MATCH_PHASES.includes(asked) ? asked : "auto");
  const [value, setValue] = useState<Record<string, ScoutValue>>(sp.get("sample") ? SAMPLE : {});
  const [notes, setNotes] = useState("");
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Phase form" description="Built-in 2026 match template, one team." />
      <PhaseForm template={builtinTemplate(2026, "match")} value={value} onChange={setValue} notes={notes} onNotes={setNotes} notesLabel="Notes on 12345" phase={phase} onPhase={setPhase} />
    </div>
  );
}
