// Preview: the scouting session setup screen (Scout redesign piece A) on real events (?season=&suggested=),
// with this device's My team. Start shows what the page would save instead of saving it.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SessionSetup } from "../../components/scout/redesign/SessionSetup";
import { usePersonal } from "../../lib/personal";
import { watchingLabel, type Watching } from "../../shared/scoutMatch";

export default function SetupPreview() {
  const [sp] = useSearchParams();
  const season = Number(sp.get("season")) || 2025;
  const { state } = usePersonal();
  const [started, setStarted] = useState<{ code: string; watching: Watching } | null>(null);
  return (
    <div className="mx-auto max-w-md">
      <SessionSetup season={season} suggestedEvent={sp.get("suggested")} myTeam={state.myTeam}
        onStart={(code, watching) => setStarted({ code, watching })} onCancel={() => setStarted(null)} />
      {started && <p role="status" className="mt-3 text-sm text-muted-foreground">Would start: {started.code} · {watchingLabel(started.watching)}</p>}
    </div>
  );
}
