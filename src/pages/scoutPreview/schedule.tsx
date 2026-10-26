// Preview: the wave 1 schedule hook on a real event (?season=&event=), as the scout screen will read it.
import { useSearchParams } from "react-router-dom";
import { useEventSchedule } from "../../lib/eventSchedule";
import { PageHeader } from "../../components/page";

export default function SchedulePreview() {
  const [sp] = useSearchParams();
  const season = Number(sp.get("season")) || 2025, code = sp.get("event") || "USNJQ1";
  const s = useEventSchedule(season, code);
  return (
    <div>
      <PageHeader title={s.eventName || code} description={`${s.status}${s.fromDevice ? " (kept on this device)" : ""} · ${s.matches.length} matches`} />
      <ol className="grid gap-1 font-mono text-sm">{s.matches.map((m) => <li key={m.key}>{m.label}: <span className="text-red-alliance-text">{m.red.join(" ")}</span> · <span className="text-blue-alliance-text">{m.blue.join(" ")}</span></li>)}</ol>
    </div>
  );
}
