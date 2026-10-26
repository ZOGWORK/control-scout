// Preview: the redesign's header, section tabs and Data hub, for Personal (?space=personal) or an admin of a
// workspace (the default). Sample props only (dev-only route); the Scout page passes the real ones.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Cloud } from "lucide-react";
import { ScoutTopBar } from "../../components/scout/redesign/ScoutTopBar";
import { ScoutTabs, type ScoutTab } from "../../components/scout/redesign/ScoutTabs";
import { DataHub, type DataView } from "../../components/scout/redesign/DataHub";

export default function DataPreview() {
  const [sp] = useSearchParams();
  const personal = sp.get("space") === "personal";
  const [tab, setTab] = useState<ScoutTab>("data");
  const [opened, setOpened] = useState<DataView | null>(null);
  return (
    <div>
      <ScoutTopBar eventCode="USNJQ1" watching={personal ? { kind: "slot", slot: "blue1" } : { kind: "alliance", side: "red" }} onChangeSession={() => setOpened(null)}
        actions={<span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground"><Cloud className="size-3.5 text-success" />Synced</span>} />
      <ScoutTabs tab={tab} onTab={setTab}>
        {tab === "data" ? <>
          <DataHub workspace={personal ? null : { id: "w1", name: "Riverside Robotics" }} isAdmin={!personal} season={2025} eventCode="USNJQ1"
            entryCount={personal ? 12 : 84} openForYou={personal ? 0 : 1} pit={personal ? null : { done: 18, total: 24 }} onOpen={setOpened} className="max-w-2xl" />
          {opened && <p role="status" className="mt-2 text-xs text-muted-foreground">Opens: {opened}</p>}
        </> : <p className="py-8 text-center text-sm text-muted-foreground">The {tab} tab is another piece.</p>}
      </ScoutTabs>
    </div>
  );
}
