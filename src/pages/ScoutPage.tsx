// Manual scouting: your own match and pit observations on top of public data.
// Offline-first: saved on this device the moment you press Save; synced to
// your account when signed in and online.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Cloud, CloudOff, Loader2, Minus, Plus, Save, Trash2 } from "lucide-react";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { deleteScoutEntry, newScoutId, saveScoutEntry, ScoutStorageError, templateFor, useScouting, type ScoutEntry, type ScoutField, type ScoutValue } from "../lib/scouting";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { Badge, Input, Textarea, Label } from "../components/ui/basic";
import { ToggleGroup, ToggleGroupItem, Switch } from "../components/ui/controls";
import { toast } from "../components/ui/sonner";
import { TeamInput } from "../components/TeamInput";
import { SeasonToggle } from "../components/SeasonToggle";
import { Recordings } from "../components/VideoDialog";
import { cn } from "../components/cn";

export default function ScoutPage() {
  useTitle("Scout");
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const teamFilter = Number(sp.get("team")) || undefined;
  const { user, syncReady } = usePersonal();
  const { entries, status, pendingCount, syncNow } = useScouting({ season, team: teamFilter }, syncReady);
  const editing = sp.get("entry");
  const editEntry = entries.find((e) => e.uuid === editing) ?? null;
  const [formOpen, setFormOpen] = useState(!!teamFilter || !!editing);
  useEffect(() => { if (editing) setFormOpen(true); }, [editing]);
  return (
    <div>
      <PageHeader title="Scout" description="Your own observations — private to you. Saved on this device instantly; synced to your account when you're signed in."
        actions={<SyncChip status={status} pending={pendingCount} onSync={syncNow} signedIn={!!user} />}>
        <div className="flex flex-wrap items-center gap-3">
          <SeasonToggle value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; })} />
          {teamFilter && <Badge variant="soft">Team {teamFilter} <button onClick={() => setSp((x) => { x.delete("team"); return x; })} aria-label="Clear team filter" className="ml-1">×</button></Badge>}
          {!formOpen && <Button onClick={() => setFormOpen(true)}><Plus /> New entry</Button>}
        </div>
      </PageHeader>
      {formOpen && (
        <EntryForm key={editEntry?.uuid ?? `new-${teamFilter ?? ""}`} season={season} initial={editEntry} team={teamFilter}
          onDone={() => { setFormOpen(false); setSp((x) => { x.delete("entry"); return x; }); }} />
      )}
      <Section title={`Entries (${entries.length})`} description={teamFilter ? `For team ${teamFilter}` : "Newest first"}>
        {!entries.length ? <EmptyState icon={ClipboardList} title="No scouting entries yet" description="Start one above, or from any team page." /> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {entries.map((e) => <EntryCard key={e.uuid} e={e} onEdit={() => setSp((x) => { x.set("entry", e.uuid); return x; })} />)}
          </ul>
        )}
      </Section>
      <Section title="Match recordings" description="Videos you recorded in the app stay on this device only — they're never uploaded. YouTube links you add sync with your account.">
        <Recordings />
      </Section>
    </div>
  );
}

function SyncChip({ status, pending, onSync, signedIn }: { status: string; pending: number; onSync: () => void; signedIn: boolean }) {
  if (!signedIn) return <Badge variant="secondary"><CloudOff /> On this device only</Badge>;
  return (
    <button onClick={onSync} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
      {status === "syncing" ? <Loader2 className="size-3.5 animate-spin" /> : status === "offline" || status === "error" ? <CloudOff className="size-3.5 text-warning" /> : <Cloud className="size-3.5 text-success" />}
      {status === "syncing" ? "Syncing…" : status === "offline" ? `Offline — ${pending} waiting` : status === "error" ? `Sync failed — ${pending} waiting · retry` : pending ? `${pending} waiting` : "Synced"}
    </button>
  );
}

function EntryCard({ e, onEdit }: { e: ScoutEntry; onEdit: () => void }) {
  const t = templateFor(e.season, e.kind);
  const shown = t.fields.filter((f) => e.data[f.id] !== undefined && e.data[f.id] !== false && e.data[f.id] !== 0 && e.data[f.id] !== "").slice(0, 5);
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium"><Link to={`/teams/${e.team}?season=${e.season}`} className="font-mono hover:underline">{e.team}</Link> · {e.kind === "pit" ? "Pit" : `Match ${e.matchLabel ?? ""}`}</p>
          <p className="text-xs text-muted-foreground">{e.eventCode ?? "No event"} · {new Date(e.updatedAt).toLocaleString()}</p>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete entry" onClick={() => { deleteScoutEntry(e); toast("Entry deleted"); }}><Trash2 /></Button>
        </div>
      </div>
      {shown.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{shown.map((f) => <Badge key={f.id} variant="secondary">{f.label}: {String(e.data[f.id] === true ? "yes" : e.data[f.id])}</Badge>)}</div>}
      {e.notes && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{e.notes}</p>}
    </li>
  );
}

function EntryForm({ season, initial, team, onDone }: { season: number; initial: ScoutEntry | null; team?: number; onDone: () => void }) {
  const [kind, setKind] = useState<"match" | "pit">(initial?.kind ?? "match");
  const [teamText, setTeamText] = useState(initial ? String(initial.team) : team ? String(team) : "");
  const [eventCode, setEventCode] = useState(initial?.eventCode ?? "");
  const [matchLabel, setMatchLabel] = useState(initial?.matchLabel ?? "");
  const [data, setData] = useState<Record<string, ScoutValue>>(initial?.data ?? {});
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const template = useMemo(() => templateFor(season, kind), [season, kind]);
  const phases = ["auto", "teleop", "endgame", "overall", "pit"] as const;
  const save = () => {
    if (!teamText) { toast.error("Add a team number"); return; }
    try {
      saveScoutEntry({ uuid: initial?.uuid ?? newScoutId(), season, team: Number(teamText), eventCode: eventCode.trim().toUpperCase() || null, matchLabel: kind === "match" ? matchLabel.trim().toUpperCase() || null : null, kind, data, notes });
      toast.success("Saved on this device");
      onDone();
    } catch (e) {
      toast.error(e instanceof ScoutStorageError ? e.message : "Couldn't save");
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="mb-8 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-4">
        <ToggleGroup type="single" value={kind} onValueChange={(v) => { if (v) setKind(v as typeof kind); }} aria-label="Entry type">
          <ToggleGroupItem value="match">Match</ToggleGroupItem><ToggleGroupItem value="pit">Pit</ToggleGroupItem>
        </ToggleGroup>
        <div className="w-32"><TeamInput label="Team" value={teamText} onChange={setTeamText} /></div>
        <div className="w-36"><Input value={eventCode} onChange={(e) => setEventCode(e.target.value)} placeholder="Event code" aria-label="Event code" className="h-11 font-mono uppercase" /></div>
        {kind === "match" && <div className="w-24"><Input value={matchLabel} onChange={(e) => setMatchLabel(e.target.value)} placeholder="Q12" aria-label="Match" className="h-11 font-mono uppercase" /></div>}
      </div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {phases.map((ph) => {
          const fields = template.fields.filter((f) => f.phase === ph);
          if (!fields.length) return null;
          return (
            <fieldset key={ph} className="rounded-xl border border-border p-4">
              <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">{ph === "teleop" ? "TeleOp" : ph[0].toUpperCase() + ph.slice(1)}</legend>
              <div className="space-y-3">{fields.map((f) => <Field key={f.id} f={f} value={data[f.id]} onChange={(v) => setData((d) => ({ ...d, [f.id]: v }))} />)}</div>
            </fieldset>
          );
        })}
      </div>
      <div className="mt-5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="What stood out? Strategy, reliability, driver habits…" className="mt-2" />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit"><Save /> Save</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        <p className="ml-auto self-center text-xs text-muted-foreground">Saved on this device first — works without a connection.</p>
      </div>
    </form>
  );
}

function Field({ f, value, onChange }: { f: ScoutField; value: ScoutValue | undefined; onChange: (v: ScoutValue) => void }) {
  const id = `f-${f.id}`;
  if (f.type === "toggle") return <div className="flex items-center justify-between gap-3"><Label htmlFor={id}>{f.label}</Label><Switch id={id} checked={!!value} onCheckedChange={onChange} /></div>;
  if (f.type === "counter") {
    const n = typeof value === "number" ? value : 0;
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{f.label}</span>
        <div className="flex items-center gap-1">
          <Button type="button" variant="secondary" size="icon-sm" aria-label={`${f.label} minus one`} onClick={() => onChange(Math.max(0, n - 1))}><Minus /></Button>
          <span className="w-8 text-center font-mono tabular-nums" aria-live="polite">{n}</span>
          <Button type="button" variant="secondary" size="icon-sm" aria-label={`${f.label} plus one`} onClick={() => onChange(Math.min(f.max ?? 999, n + 1))}><Plus /></Button>
        </div>
      </div>
    );
  }
  if (f.type === "rating") {
    const n = typeof value === "number" ? value : 0;
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{f.label}</span>
        <div className="flex gap-1" role="radiogroup" aria-label={f.label}>
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
          {f.options!.map((o) => <ToggleGroupItem key={o} value={o}>{o}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
    );
  }
  return <div className="space-y-1.5"><Label htmlFor={id}>{f.label}</Label><Input id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} /></div>;
}

