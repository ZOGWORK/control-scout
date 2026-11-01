// What the scout watches each match, as a strip on Event day: one team, one alliance or all four, and which.
// A change takes at once (the page saves it with the event); nothing to start or restart.
import { useId } from "react";
import { SLOTS, slotLabel, type AllianceSide, type SlotId, type Watching } from "../../../shared/scoutMatch";
import { ToggleGroup, ToggleGroupItem } from "../../ui/controls";
import { cn } from "../../cn";

const KINDS: { kind: Watching["kind"]; label: string }[] = [
  { kind: "slot", label: "One team" },
  { kind: "alliance", label: "One alliance" },
  { kind: "all", label: "All 4 teams" },
];

const sideOf = (s: SlotId): AllianceSide => (s.startsWith("red") ? "red" : "blue");
const Dot = ({ side }: { side: AllianceSide }) => <span aria-hidden className={cn("size-2 rounded-full", side === "red" ? "bg-red-alliance" : "bg-blue-alliance")} />;

/** The watching a kind switches to, keeping the side (or slot) already chosen where it can. */
export function switchKind(w: Watching, kind: Watching["kind"]): Watching {
  const side: AllianceSide = w.kind === "alliance" ? w.side : w.kind === "slot" ? sideOf(w.slot) : "red";
  if (kind === "all") return { kind: "all" };
  if (kind === "alliance") return { kind: "alliance", side };
  return { kind: "slot", slot: w.kind === "slot" ? w.slot : side === "red" ? "red1" : "blue1" };
}

export function WatchStrip({ watching, onChange, disabled, className }: { watching: Watching; onChange: (w: Watching) => void; disabled?: boolean; className?: string }) {
  const kindLabel = useId(), whichLabel = useId();
  return (
    <div className={cn("flex flex-wrap items-end gap-x-5 gap-y-3", className)}>
      <div className="grid gap-1.5">
        <p id={kindLabel} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What are you watching?</p>
        <ToggleGroup type="single" aria-labelledby={kindLabel} value={watching.kind} disabled={disabled}
          onValueChange={(v) => { if (v) onChange(switchKind(watching, v as Watching["kind"])); }}>
          {KINDS.map((k) => <ToggleGroupItem key={k.kind} value={k.kind} size="lg" className="max-sm:h-11">{k.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      {watching.kind !== "all" && (
        <div className="grid gap-1.5">
          <p id={whichLabel} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{watching.kind === "slot" ? "Which team" : "Which alliance"}</p>
          <ToggleGroup type="single" aria-labelledby={whichLabel} disabled={disabled} value={watching.kind === "slot" ? watching.slot : watching.side}
            onValueChange={(v) => {
              if (!v) return;
              onChange(watching.kind === "slot" ? { kind: "slot", slot: v as SlotId } : { kind: "alliance", side: v as AllianceSide });
            }}>
            {watching.kind === "slot"
              ? SLOTS.map((s) => <ToggleGroupItem key={s} value={s} size="lg" className="max-sm:h-11"><Dot side={sideOf(s)} />{slotLabel(s)}</ToggleGroupItem>)
              : (["red", "blue"] as const).map((s) => <ToggleGroupItem key={s} value={s} size="lg" className="max-sm:h-11"><Dot side={s} />{s === "red" ? "Red" : "Blue"}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
