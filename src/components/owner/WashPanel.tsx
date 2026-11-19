// The owner console's wash editor (Rankings & content): the soft colour band across the top of every page in the v8
// look. Three colours, a brightness and a spread, with the real Wash drawn above the controls as you drag. Saved on
// the server (owner_settings "wash", server/wash.ts), so every visitor's first paint has it; each save and reset is
// in the audit log with the wash it replaced. The classic look has no wash and doesn't change.
import { useState, type CSSProperties } from "react";
import { RotateCcw, Save } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Badge, Input, Label } from "../ui/basic";
import { Button } from "../ui/button";
import { Slider } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { Wash } from "../layout/Wash";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { applyWash } from "../../lib/wash";
import { WASH_SPREAD, WASH_STRENGTH, cleanHex, isDefaultWash, parseWash, washVars, type OwnerWash, type WashSettings } from "../../shared/wash";

const PATH = "/api/owner/wash";

/** The editor's working copy: colours as typed (they may not be hex yet), numbers from the sliders. */
type Draft = Omit<WashSettings, "a" | "b" | "c"> & { a: string; b: string; c: string };

const COLOURS = [["a", "Left"], ["b", "Middle"], ["c", "Right"]] as const;

function ColourField({ id, label, value, fallback, onChange }: { id: string; label: string; value: string; fallback: string; onChange: (s: string) => void }) {
  const hex = cleanHex(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} colour picker`} value={hex ?? fallback} onChange={(e) => onChange(e.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5" />
        <Input id={id} value={value} maxLength={7} spellCheck={false} onChange={(e) => onChange(e.target.value)} aria-invalid={!hex}
          className="font-mono uppercase" />
      </div>
      {!hex && <p className="text-xs text-warning">Use a hex colour, like #5A76AD.</p>}
    </div>
  );
}

function RangeField({ id, label, hint, value, range, onChange }: { id: string; label: string; hint: string; value: number; range: { min: number; max: number }; onChange: (n: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label id={id}>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(2)}×</span>
      </div>
      <Slider aria-labelledby={id} aria-label={label} min={range.min} max={range.max} step={0.05} value={[value]} onValueChange={([n]) => onChange(n)} />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** The real Wash, with the draft's variables on its box, so it updates as the controls move. */
export function WashPreview({ wash }: { wash: WashSettings }) {
  return (
    <div data-testid="wash-preview" className="relative h-72 overflow-hidden rounded-xl border border-border bg-background" style={washVars(wash) as CSSProperties}>
      <Wash size="tall" />
      <div className="relative p-5">
        <p className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground">Control Scout</p>
        <p className="mt-1 text-sm text-muted-foreground">The top of every page, as visitors see it.</p>
      </div>
    </div>
  );
}

function WashEditor({ saved, onSaved }: { saved: OwnerWash; onSaved: (p: OwnerWash) => void }) {
  const [draft, setDraft] = useState<Draft>(saved.wash);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const parsed = parseWash(draft);
  const valid = "wash" in parsed ? parsed.wash : null;
  // A colour still being typed shows the saved one in the preview.
  const preview: WashSettings = { ...draft, a: cleanHex(draft.a) ?? saved.wash.a, b: cleanHex(draft.b) ?? saved.wash.b, c: cleanHex(draft.c) ?? saved.wash.c };
  const changed = !valid || (["a", "b", "c", "strength", "spread"] as const).some((k) => valid[k] !== saved.wash[k]);
  const run = async (fn: () => Promise<OwnerWash>, done: string) => {
    setBusy(true);
    try {
      const p = await fn();
      onSaved(p);
      setDraft(p.wash);
      toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as ApiError).message);
      return false;
    } finally { setBusy(false); }
  };
  const save = () => valid && void run(() => apiFetch<OwnerWash>(PATH, { method: "PUT", json: { wash: valid } }), "Wash saved. Pages show it within a minute.");
  const reset = async () => { if (await run(() => apiFetch<OwnerWash>(`${PATH}/reset`, { method: "POST", json: { confirm: true } }), "Back to the default wash.")) setAsking(false); };
  return (
    <div className="grid gap-4">
      <WashPreview wash={preview} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={saved.custom ? "soft" : "secondary"}>{saved.custom ? "Your wash" : "Default wash"}</Badge>
        {saved.custom && saved.updatedAt && <span>Saved {new Date(saved.updatedAt).toLocaleString()}{saved.updatedBy ? ` by ${saved.updatedBy}` : ""}.</span>}
      </div>
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {COLOURS.map(([k, label]) => (
            <ColourField key={k} id={`wash-${k}`} label={label} value={draft[k]} fallback={saved.wash[k]} onChange={(s) => set(k, s)} />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeField id="wash-strength" label="Brightness" value={draft.strength} range={WASH_STRENGTH} onChange={(n) => set("strength", n)}
            hint="Below 1 it fades; above 1 the colours get brighter." />
          <RangeField id="wash-spread" label="Spread" value={draft.spread} range={WASH_SPREAD} onChange={(n) => set("spread", n)}
            hint="How far down the page it reaches." />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={busy || (!saved.custom && isDefaultWash(preview))} onClick={() => setAsking(true)}><RotateCcw /> Reset to default</Button>
          <Button disabled={busy || !valid || !changed} onClick={save}><Save /> {busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
      <Dialog open={asking} onOpenChange={(v) => { if (!busy) setAsking(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Go back to the default wash?</DialogTitle>
            <DialogDescription>Every page goes back to the built-in colours, brightness and spread. The audit log keeps the wash you had.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void reset()} disabled={busy}>{busy ? "Working…" : "Reset to default"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WashPanel() {
  const state = useApi<OwnerWash>(PATH);
  // The open page gets the new wash at once (src/lib/wash.ts); everyone else on their next page load.
  const saved = (p: OwnerWash) => { prime(PATH, p); markStale("/api/wash"); applyWash(p); };
  return (
    <Section title="Wash" description="The soft colour band across the top of every page in the new look. Pick its three colours, how bright it is and how far down it reaches; the preview updates as you go, and nothing changes for visitors until you save.">
      <Async state={state}>
        {(p) => <WashEditor key={`${p.updatedAt ?? "default"}`} saved={p} onSaved={saved} />}
      </Async>
    </Section>
  );
}
