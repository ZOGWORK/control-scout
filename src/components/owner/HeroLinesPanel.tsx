// The owner console's hero-line editor (Rankings & content): the home page's headline, which changes on the
// hour through a list of lines. Add, edit, reorder, switch on or off and preview lines (a plain part and a part
// in the accent colour), start from the built-in lines, or go back to them. Saved on the server (hero_lines),
// so every visitor gets the same line in the same hour; each change is in the audit log with its old and new value.
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Clock, Eye, Megaphone, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Badge, Input, Label } from "../ui/basic";
import { Button } from "../ui/button";
import { Switch } from "../ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { HOME_HEADLINE_MS } from "../../shared/boot";
import { HERO_PART_MAX, heroLineProblem, type HeroLine, type HeroLineRow, type OwnerHeroLines } from "../../shared/heroLines";

const PATH = "/api/owner/hero-lines";

interface Ask { title: string; body: string; confirm: string; danger?: boolean; run: () => Promise<unknown> }

/** The line as the home page draws it: the plain part, then the accent part on its own line. */
export function HeroPreview({ line, className }: { line: HeroLine; className?: string }) {
  return (
    <p className={cn("font-display text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground sm:text-4xl", className)}>
      {line[0] || <span className="text-muted-foreground">Plain part</span>}{" "}
      <span className="block text-accent-display">{line[1] || <span className="text-muted-foreground">Coloured part</span>}</span>
    </p>
  );
}

/** When the next line comes up, in minutes. */
const nextChange = (now = Date.now()) => Math.max(1, Math.ceil((HOME_HEADLINE_MS - (now % HOME_HEADLINE_MS)) / 60_000));

function LineFields({ plain, accent, setPlain, setAccent, idPrefix }: { plain: string; accent: string; setPlain: (s: string) => void; setAccent: (s: string) => void; idPrefix: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-plain`}>Plain part</Label>
        <Input id={`${idPrefix}-plain`} value={plain} maxLength={HERO_PART_MAX} onChange={(e) => setPlain(e.target.value)} placeholder="Know the match" />
        <span className="text-xs tabular-nums text-muted-foreground">{plain.trim().length}/{HERO_PART_MAX}</span>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${idPrefix}-accent`}>Coloured part</Label>
        <Input id={`${idPrefix}-accent`} value={accent} maxLength={HERO_PART_MAX} onChange={(e) => setAccent(e.target.value)} placeholder="before it starts." />
        <span className="text-xs tabular-nums text-muted-foreground">{accent.trim().length}/{HERO_PART_MAX}</span>
      </div>
    </div>
  );
}

function Row({ row, i, count, live, onMove, onAsk, onSaved }: {
  row: HeroLineRow; i: number; count: number; live: boolean;
  onMove: (from: number, to: number) => void; onAsk: (a: Ask) => void; onSaved: (p: OwnerHeroLines) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [plain, setPlain] = useState(row.plain);
  const [accent, setAccent] = useState(row.accent);
  const [busy, setBusy] = useState(false);
  const problem = heroLineProblem(plain, accent);
  const changed = plain.trim() !== row.plain || accent.trim() !== row.accent;
  const patch = async (json: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const r = await apiFetch<{ panel: OwnerHeroLines }>(`${PATH}/${row.id}`, { method: "PATCH", json });
      onSaved(r.panel);
      toast.success(done);
      return true;
    } catch (e) {
      toast.error((e as ApiError).message);
      return false;
    } finally { setBusy(false); }
  };
  return (
    <li className={cn("min-w-0 rounded-xl border bg-card p-3", live ? "border-accent/50 ring-1 ring-accent/30" : "border-border", !row.enabled && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{row.plain} <span className="text-accent-text">{row.accent}</span></p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {live && <Badge variant="soft"><Clock aria-hidden /> On the home page now</Badge>}
            {!row.enabled && <Badge variant="secondary">Off</Badge>}
          </div>
        </div>
        <Switch checked={row.enabled} disabled={busy} aria-label={`Show "${row.plain} ${row.accent}" on the home page`}
          onCheckedChange={(on) => void patch({ enabled: on }, on ? "Line switched on." : "Line switched off.")} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 pl-9">
        <Button variant="ghost" size="sm" disabled={i === 0 || busy} onClick={() => onMove(i, i - 1)} aria-label={`Move line ${i + 1} up`}><ArrowUp /></Button>
        <Button variant="ghost" size="sm" disabled={i === count - 1 || busy} onClick={() => onMove(i, i + 1)} aria-label={`Move line ${i + 1} down`}><ArrowDown /></Button>
        <Button variant="secondary" size="sm" onClick={() => { setEditing((v) => !v); setPlain(row.plain); setAccent(row.accent); }}><Pencil /> {editing ? "Close" : "Edit"}</Button>
        <Button variant="secondary" size="sm" onClick={() => onAsk({
          title: "Delete this line?", danger: true,
          body: `"${row.plain} ${row.accent}" leaves the rotation for good (the audit log keeps its words). To take it out for now, switch it off instead.`,
          confirm: "Delete line",
          run: async () => { onSaved((await apiFetch<{ panel: OwnerHeroLines }>(`${PATH}/${row.id}`, { method: "DELETE", json: { confirm: true } })).panel); toast.success("Line deleted."); },
        })}><Trash2 /> Delete</Button>
      </div>
      {editing && (
        <div className="mt-3 grid gap-3 border-t border-border pt-3">
          <LineFields plain={plain} accent={accent} setPlain={setPlain} setAccent={setAccent} idPrefix={`hero-${row.id}`} />
          <div className="rounded-lg border border-dashed border-border p-3"><HeroPreview line={[plain.trim(), accent.trim()]} /></div>
          {problem && changed && <p className="text-xs text-warning">{problem}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
            <Button disabled={!changed || !!problem || busy} onClick={async () => { if (await patch({ plain, accent }, "Line saved.")) setEditing(false); }}>Save line</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddLine({ onSaved, empty }: { onSaved: (p: OwnerHeroLines) => void; empty: boolean }) {
  const [plain, setPlain] = useState("");
  const [accent, setAccent] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = heroLineProblem(plain, accent);
  const add = async () => {
    setBusy(true);
    try {
      const r = await apiFetch<{ panel: OwnerHeroLines }>(PATH, { method: "POST", json: { plain, accent } });
      onSaved(r.panel);
      setPlain(""); setAccent("");
      toast.success("Line added at the end.");
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground"><Plus className="size-4 text-accent-text" aria-hidden /> Add a line</p>
      <LineFields plain={plain} accent={accent} setPlain={setPlain} setAccent={setAccent} idPrefix="hero-new" />
      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="size-3.5" aria-hidden /> Preview, as the home page draws it</p>
        <HeroPreview line={[plain.trim(), accent.trim()]} />
      </div>
      {empty && <p className="text-xs text-muted-foreground">With no saved lines yet, the home page would show only the lines you add. To keep the built-in ones in the rotation, start from them instead.</p>}
      <div className="flex justify-end"><Button onClick={() => void add()} disabled={!!problem || busy}><Plus /> Add line</Button></div>
    </div>
  );
}

export function HeroLinesPanel() {
  const state = useApi<OwnerHeroLines>(PATH);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = (p: OwnerHeroLines) => { prime(PATH, p); markStale("/api/home/headlines"); };
  const go = async () => {
    if (!ask) return;
    setBusy(true);
    try { await ask.run(); setAsk(null); } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const move = async (rows: HeroLineRow[], from: number, to: number) => {
    const ids = rows.map((r) => r.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    try { saved((await apiFetch<{ panel: OwnerHeroLines }>(`${PATH}/order`, { method: "PUT", json: { ids } })).panel); } catch (e) { toast.error((e as ApiError).message); }
  };
  return (
    <Section title="Home headline" description="The big line at the top of the home page. It changes on the hour, going through the lines that are on in this order, and everyone sees the same line in the same hour. The home page keeps room for the longest line, so nothing below it moves when it changes.">
      <Async state={state}>
        {(p) => {
          const now = p.live.lines[p.live.index] ?? p.live.lines[0];
          const liveId = p.live.custom ? p.rows.filter((r) => r.enabled)[p.live.index]?.id : undefined;
          return (
            <div className="grid gap-4">
              <div className="overflow-hidden rounded-xl border border-accent/30 bg-accent/[0.05] p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={p.live.custom ? "soft" : "secondary"}>{p.live.custom ? <><Sparkles aria-hidden /> Your lines</> : "Built-in lines"}</Badge>
                  <span>Line {p.live.index + 1} of {p.live.lines.length} is up now; the next comes up in {nextChange()} min.</span>
                </div>
                {now && <HeroPreview line={now} />}
              </div>

              {p.rows.length === 0 ? (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                    <p className="min-w-0 text-sm text-muted-foreground">The home page uses the {p.defaults.length} built-in lines. Start from them to edit, reorder or switch any of them off, or add a line of your own.</p>
                    <Button onClick={() => setAsk({
                      title: "Start editing from the built-in lines?",
                      body: `The ${p.defaults.length} built-in lines are saved as your own, in the same order, so the home page doesn't change until you edit them. You can go back to the built-in lines at any time.`,
                      confirm: "Start editing",
                      run: async () => { saved((await apiFetch<{ panel: OwnerHeroLines }>(`${PATH}/seed`, { method: "POST", json: { confirm: true } })).panel); toast.success("Saved: edit away."); },
                    })}><Megaphone /> Edit these lines</Button>
                  </div>
                  <ol className="grid gap-1.5 rounded-xl border border-border bg-card p-3 text-sm" aria-label="Built-in lines">
                    {p.defaults.map(([a, b], i) => (
                      <li key={i} className="flex gap-3"><span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span><span className={cn("min-w-0", i === p.live.index && "font-medium")}>{a} <span className="text-accent-text">{b}</span></span></li>
                    ))}
                  </ol>
                </div>
              ) : (
                <>
                  {!p.live.custom && (
                    <p className="rounded-xl border border-warning/40 bg-warning/[0.06] p-3 text-sm text-foreground">Every saved line is off, so the home page is back on the built-in lines. Switch one on to use yours.</p>
                  )}
                  <ol className="grid gap-2" aria-label="Your lines, in order">
                    {p.rows.map((r, i) => (
                      <Row key={`${r.id}-${r.updatedAt}`} row={r} i={i} count={p.rows.length} live={r.id === liveId}
                        onMove={(from, to) => void move(p.rows, from, to)} onAsk={setAsk} onSaved={saved} />
                    ))}
                  </ol>
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => setAsk({
                      title: "Go back to the built-in lines?", danger: true,
                      body: `Your ${p.rows.length} saved ${p.rows.length === 1 ? "line is" : "lines are"} removed and the home page shows the ${p.defaults.length} built-in lines again. The audit log keeps every line's words.`,
                      confirm: "Use built-in lines",
                      run: async () => { saved((await apiFetch<{ panel: OwnerHeroLines }>(`${PATH}/reset`, { method: "POST", json: { confirm: true } })).panel); toast.success("Back to the built-in lines."); },
                    })}><RotateCcw /> Use built-in lines</Button>
                  </div>
                </>
              )}
              <AddLine onSaved={saved} empty={p.rows.length === 0} />
            </div>
          );
        }}
      </Async>
      <Dialog open={!!ask} onOpenChange={(v) => { if (!v && !busy) setAsk(null); }}>
        <DialogContent>
          {ask && (
            <>
              <DialogHeader>
                <DialogTitle>{ask.title}</DialogTitle>
                <DialogDescription>{ask.body as ReactNode}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsk(null)} disabled={busy}>Cancel</Button>
                <Button variant={ask.danger ? "destructive" : "default"} onClick={() => void go()} disabled={busy}>{busy ? "Working…" : ask.confirm}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}
