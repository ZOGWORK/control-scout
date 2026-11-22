// The owner console's gradient studio (Appearance tab): the soft colour band across the top of every page in the v8
// look and the glow at the end of a long page. Six ready-made gradients (WASH_PRESETS) shown as small previews, a big
// preview of a page with both, in Dark or Light, and fine-tuning underneath. Picking a preset or moving a control only
// changes the previews here; visitors see it once you press Save. Saved on the server (owner_settings "wash",
// server/wash.ts), so every visitor's first paint has it; each save and reset is in the audit log with the one it
// replaced. The classic look has no wash and doesn't change.
import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, RotateCcw, Save } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Badge, Input, Label } from "../ui/basic";
import { Button } from "../ui/button";
import { Slider, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { Wash } from "../layout/Wash";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { applyWash } from "../../lib/wash";
import {
  COLOUR_KEYS, WASH_KEYS, WASH_PRESETS, WASH_SPREAD, WASH_STRENGTH, cleanHex, isDefaultWash, parseWash, presetOf, sameWash, washVars,
  type ColourKey, type OwnerWash, type WashSettings,
} from "../../shared/wash";

const PATH = "/api/owner/wash";

/** The editor's working copy: colours as typed (they may not be hex yet), numbers from the sliders. */
type Draft = Omit<WashSettings, ColourKey> & Record<ColourKey, string>;

const TOP = [["a", "Top left"], ["b", "Top middle"], ["c", "Top right"]] as const;
const GLOW = [["ga", "Glow left"], ["gb", "Glow middle"], ["gc", "Glow right"]] as const;

/** v8 Light, as index.css paints it (html[data-v8].light): a near-white page with a pale tint of the same colours. */
const LIGHT_BG = "#fafafa";
const DARK_BG = "#0a0a0b";
type Mode = "dark" | "light";

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

/** The variables a preview box needs: the wash's own, and Light's pale mix and page colour when previewing Light. */
const boxVars = (wash: WashSettings, mode: Mode) => ({
  ...washVars(wash),
  ...(mode === "light" ? { "--wash-mix": "42%", "--color-background": LIGHT_BG } : { "--color-background": DARK_BG }),
  background: mode === "light" ? LIGHT_BG : DARK_BG,
}) as CSSProperties;

/** A page in miniature: the real Wash on top, the real page-end glow at the bottom, and quiet stand-ins for content. */
export function WashPreview({ wash, mode = "dark" }: { wash: WashSettings; mode?: Mode }) {
  const ink = mode === "light" ? "bg-black/[0.07]" : "bg-white/[0.07]";
  const line = mode === "light" ? "bg-black/[0.12]" : "bg-white/[0.12]";
  return (
    <div data-testid="wash-preview" data-mode={mode} className="relative h-[26rem] overflow-hidden rounded-xl border border-border" style={boxVars(wash, mode)}>
      <Wash size="tall" includeParticleWave={false} />
      <div aria-hidden data-page-end-glow style={{ height: "46%" }} />
      <div aria-hidden className="relative flex h-full flex-col p-4">
        <div className="flex items-center justify-between">
          <span className={cn("h-2.5 w-20 rounded-full", line)} />
          <span className="flex gap-1.5"><span className={cn("size-4 rounded-full", line)} /><span className={cn("size-4 rounded-full", line)} /></span>
        </div>
        <div className="mx-auto mt-16 w-full max-w-sm">
          <div className={cn("mx-auto mb-4 size-6 rounded-full", mode === "light" ? "bg-black/70" : "bg-white/85")} />
          <div className={cn("h-9 rounded-lg border", mode === "light" ? "border-black/10 bg-white/70" : "border-white/10 bg-black/30")} />
        </div>
        <div className="mx-auto mt-8 grid w-full max-w-lg grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className={cn("h-24 rounded-lg", ink)} />)}
        </div>
      </div>
    </div>
  );
}

/** A preset's small preview: its top colours fading down and its glow rising at the bottom, drawn to fit the card. */
function PresetSwatch({ wash, mode }: { wash: WashSettings; mode: Mode }) {
  const bg = mode === "light" ? LIGHT_BG : DARK_BG;
  const tint = (c: string, a: number) => `color-mix(in srgb, color-mix(in srgb, ${c} ${mode === "light" ? 42 : 100}%, ${bg}) ${a}%, transparent)`;
  const top = `radial-gradient(60% 75% at 12% 0%, ${tint(wash.a, 95)}, transparent 72%), radial-gradient(55% 70% at 52% 0%, ${tint(wash.b, 95)}, transparent 72%), radial-gradient(60% 75% at 90% 0%, ${tint(wash.c, 95)}, transparent 72%)`;
  const glow = `radial-gradient(40% 60% at 43% 112%, ${tint(wash.ga, 80)}, transparent 75%), radial-gradient(38% 55% at 65% 110%, ${tint(wash.gb, 70)}, transparent 75%), radial-gradient(32% 45% at 52% 105%, ${tint(wash.gc, 40)}, transparent 80%)`;
  return <div aria-hidden className="h-24 w-full" style={{ backgroundColor: bg, backgroundImage: `${top}, ${glow}` }} />;
}

function WashEditor({ saved, onSaved }: { saved: OwnerWash; onSaved: (p: OwnerWash) => void }) {
  const [draft, setDraft] = useState<Draft>(saved.wash);
  const [mode, setMode] = useState<Mode>("dark");
  const [tuning, setTuning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const parsed = parseWash(draft);
  const valid = "wash" in parsed ? parsed.wash : null;
  // A colour still being typed shows the saved one in the previews.
  const preview = Object.fromEntries(WASH_KEYS.map((k) => [k, (COLOUR_KEYS as readonly string[]).includes(k) ? cleanHex(draft[k]) ?? saved.wash[k] : draft[k]])) as unknown as WashSettings;
  const changed = !valid || !sameWash(valid, saved.wash);
  const picked = presetOf(preview);
  const live = presetOf(saved.wash);
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
  const save = () => valid && void run(() => apiFetch<OwnerWash>(PATH, { method: "PUT", json: { wash: valid } }),
    `${picked ? `${picked.name} is` : "Your gradient is"} live. Pages show it within a minute.`);
  const reset = async () => { if (await run(() => apiFetch<OwnerWash>(`${PATH}/reset`, { method: "POST", json: { confirm: true } }), "Back to the default gradient (Dusk).")) setAsking(false); };
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="grid min-w-0 content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Previewing <span className="font-medium text-foreground">{picked?.name ?? "your own mix"}</span>
              {changed && <span> · not live yet</span>}
            </p>
            <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} aria-label="Preview in">
              <ToggleGroupItem value="dark" className="px-3">Dark</ToggleGroupItem>
              <ToggleGroupItem value="light" className="px-3">Light</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <WashPreview wash={preview} mode={mode} />
        </div>
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium text-foreground">Gradients</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2" aria-label="Ready-made gradients">
            {WASH_PRESETS.map((p) => {
              const on = picked?.id === p.id;
              const isLive = live?.id === p.id;
              return (
                <li key={p.id}>
                  <button type="button" aria-pressed={on} data-preset={p.id} onClick={() => setDraft({ ...p.wash })}
                    className={cn("group w-full overflow-hidden rounded-lg border text-left outline-none transition-[border-color,transform] duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-accent ring-1 ring-accent" : "border-border hover:border-text-muted/60")}>
                    <PresetSwatch wash={p.wash} mode={mode} />
                    <span className="flex items-center justify-between gap-1 bg-card px-2.5 py-1.5 text-xs">
                      <span className={cn("font-medium", on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{p.name}</span>
                      {isLive && <span className="inline-flex items-center gap-0.5 font-medium text-emerald-400"><Check className="size-3" aria-hidden />Live</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={saved.custom ? "soft" : "secondary"}>Live: {live?.name ?? "your own mix"}</Badge>
          {saved.custom && saved.updatedAt && <span>Saved {new Date(saved.updatedAt).toLocaleString()}{saved.updatedBy ? ` by ${saved.updatedBy}` : ""}.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || (!saved.custom && isDefaultWash(preview))} onClick={() => setAsking(true)}><RotateCcw /> Reset to default</Button>
          <Button disabled={busy || !valid || !changed} onClick={save}><Save /> {busy ? "Saving…" : picked && changed ? `Save ${picked.name}` : "Save"}</Button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card">
        <button type="button" aria-expanded={tuning} onClick={() => setTuning((t) => !t)}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Fine-tune colours, brightness and spread
          <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200", tuning && "rotate-180")} aria-hidden />
        </button>
        {tuning && (
          <div className="grid gap-4 border-t border-border p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {TOP.map(([k, label]) => <ColourField key={k} id={`wash-${k}`} label={label} value={draft[k]} fallback={saved.wash[k]} onChange={(s) => set(k, s)} />)}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {GLOW.map(([k, label]) => <ColourField key={k} id={`wash-${k}`} label={label} value={draft[k]} fallback={saved.wash[k]} onChange={(s) => set(k, s)} />)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <RangeField id="wash-strength" label="Brightness" value={draft.strength} range={WASH_STRENGTH} onChange={(n) => set("strength", n)}
                hint="The top band: below 1 it fades; above 1 the colours get brighter." />
              <RangeField id="wash-spread" label="Spread" value={draft.spread} range={WASH_SPREAD} onChange={(n) => set("spread", n)}
                hint="How far down the page the top band reaches." />
            </div>
          </div>
        )}
      </div>
      <Dialog open={asking} onOpenChange={(v) => { if (!busy) setAsking(v); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Go back to the default gradient?</DialogTitle>
            <DialogDescription>Every page goes back to Dusk, the built-in colours, brightness and spread. The audit log keeps the gradient you had.</DialogDescription>
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
  // The open page gets the new gradient at once (src/lib/wash.ts); everyone else on their next page load.
  const saved = (p: OwnerWash) => { prime(PATH, p); markStale("/api/wash"); applyWash(p); };
  return (
    <Section title="Gradients" description="The colour band across the top of every page and the glow at the end of a long one, in the new look. Pick a gradient to preview it here in Dark or Light; visitors see it only after you save.">
      <Async state={state}>
        {(p) => <WashEditor key={`${p.updatedAt ?? "default"}`} saved={p} onSaved={saved} />}
      </Async>
    </Section>
  );
}
