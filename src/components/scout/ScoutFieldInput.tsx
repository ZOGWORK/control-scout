// One scout field as the entry form shows it (counter, yes/no, choice, rating, text).
// Used by the new-entry form and the template editor's preview, so the preview is
// exactly what members will fill in.
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { Input, Label } from "../ui/basic";
import { Switch, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { cn } from "../cn";
import type { ScoutField } from "../../shared/scoutTemplate";
import type { ScoutValue } from "../../lib/scouting";

export function ScoutFieldInput({ f, value, onChange, idPrefix = "f" }: { f: ScoutField; value: ScoutValue | undefined; onChange: (v: ScoutValue) => void; idPrefix?: string }) {
  const id = `${idPrefix}-${f.id}`;
  if (f.type === "toggle") return <div className="flex items-center justify-between gap-3"><Label htmlFor={id}>{f.label}</Label><Switch id={id} checked={!!value} onCheckedChange={onChange} /></div>;
  if (f.type === "counter") {
    const lo = f.min ?? 0, hi = f.max ?? 999;
    const n = typeof value === "number" ? value : lo;
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{f.label}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="secondary" size="icon-sm" aria-label={`${f.label} minus one`} disabled={n <= lo} onClick={() => onChange(Math.max(lo, n - 1))} className="max-sm:size-10"><Minus /></Button>
          <span className="w-8 text-center font-mono tabular-nums" aria-live="polite">{n}</span>
          <Button type="button" variant="secondary" size="icon-sm" aria-label={`${f.label} plus one`} disabled={n >= hi} onClick={() => onChange(Math.min(hi, n + 1))} className="max-sm:size-10"><Plus /></Button>
        </div>
      </div>
    );
  }
  if (f.type === "rating") {
    const n = typeof value === "number" ? value : 0;
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="text-sm">{f.label}</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={f.label}>
          {Array.from({ length: f.max ?? 5 }, (_, i) => i + 1).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={n === k} onClick={() => onChange(n === k ? 0 : k)} className={cn("size-8 rounded-lg border text-sm font-semibold max-sm:size-10", k <= n ? "border-accent/60 bg-accent/15 text-accent" : "border-border text-muted-foreground")}>{k}</button>
          ))}
        </div>
      </div>
    );
  }
  if (f.type === "choice") {
    return (
      <div className="space-y-1.5">
        <span className="text-sm">{f.label}</span>
        <ToggleGroup type="single" variant="chips" value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v)} className="flex flex-wrap gap-1.5">
          {(f.options ?? []).map((o) => <ToggleGroupItem key={o} value={o}>{o}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
    );
  }
  return <div className="space-y-1.5"><Label htmlFor={id}>{f.label}</Label><Input id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} /></div>;
}
