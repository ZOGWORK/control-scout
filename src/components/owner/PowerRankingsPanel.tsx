// The owner portal's Power rankings panel (docs/power-rankings.md, "Owner controls"): the weeks
// published automatically every Friday, who wrote each blurb (Bruno, the data-only template, or you),
// and the controls: edit the intro or any blurb, regenerate a week with Bruno, hide or show it, and
// publish this week now. Every action asks first and is recorded in the audit log on the server.
import { useState } from "react";
import { Bot, CalendarClock, ExternalLink, Eye, EyeOff, FileText, Pencil, RefreshCw, Send, Sparkles, Trophy } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge, Textarea } from "../ui/basic";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { apiFetch, ApiError, markStale, prime, useApi } from "../../lib/api";
import { seasonLabel } from "../../lib/format";
import { PUBLISH_TIME_ZONE, publishedLabel, weekLabel, type BlurbAuthor } from "../../shared/powerRankings";
import type { OwnerPowerRankings, OwnerPowerRankingsWeek } from "../../shared/owner";

const PATH = "/api/owner/power-rankings";

const SOURCE: Record<BlurbAuthor, { label: string; variant: "soft" | "secondary" | "outline" }> = {
  bruno: { label: "Bruno", variant: "soft" },
  template: { label: "Template", variant: "secondary" },
  owner: { label: "Edited", variant: "outline" },
};

const nextRun = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: PUBLISH_TIME_ZONE, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

interface Ask { title: string; body: string; confirm: string; run: () => Promise<unknown> }

function useAction() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      await ask.run();
      setAsk(null);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(false); }
  };
  const dialog = (
    <Dialog open={!!ask} onOpenChange={(v) => { if (!v && !busy) setAsk(null); }}>
      <DialogContent>
        {ask && (
          <>
            <DialogHeader>
              <DialogTitle>{ask.title}</DialogTitle>
              <DialogDescription>{ask.body}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsk(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void go()} disabled={busy}>{busy ? "Working…" : ask.confirm}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
  return { setAsk, dialog };
}

/** After a change: the panel's new data, and the public pages refetch. */
function applied(r: { panel: OwnerPowerRankings }) {
  prime(PATH, r.panel);
  markStale("/api/power-rankings");
}

function Week({ w, onAsk }: { w: OwnerPowerRankingsWeek; onAsk: (a: Ask) => void }) {
  const [editing, setEditing] = useState(false);
  const [intro, setIntro] = useState(w.intro);
  const [blurbs, setBlurbs] = useState<Record<number, string>>({});
  const n = (s: BlurbAuthor) => w.entries.filter((e) => e.source === s).length;
  const base = `${PATH}/${w.season}/${w.week}`;
  const label = `week ${Number(w.week.slice(6))}`;
  const changed = Object.entries(blurbs).filter(([team, text]) => text.trim() !== w.entries.find((e) => e.team === Number(team))?.text);
  const introChanged = intro.trim() !== w.intro;
  const save = () => onAsk({
    title: `Save your edits to ${label}?`,
    body: `${[introChanged ? "The intro" : null, changed.length ? `${changed.length} ${changed.length === 1 ? "blurb" : "blurbs"}` : null].filter(Boolean).join(" and ")} will show on the live page at once, marked as yours rather than Bruno's.`,
    confirm: "Save edits",
    run: async () => {
      const r = await apiFetch<{ panel: OwnerPowerRankings }>(base, {
        method: "PATCH",
        json: { confirm: true, ...(introChanged ? { intro } : {}), ...(changed.length ? { blurbs: changed.map(([team, text]) => ({ team: Number(team), text })) } : {}) },
      });
      applied(r);
      setEditing(false);
      setBlurbs({});
      toast.success("Saved.");
    },
  });
  const regenerate = () => onAsk({
    title: `Regenerate ${label} with Bruno?`,
    body: "Bruno writes every blurb and the intro again from the same frozen facts, and each is fact-checked again. Your edits to this week are replaced. If Bruno can't be reached, nothing changes.",
    confirm: "Regenerate",
    run: async () => { applied(await apiFetch<{ panel: OwnerPowerRankings }>(`${base}/regenerate`, { method: "POST", json: { confirm: true } })); toast.success("Regenerated."); },
  });
  const hide = w.status === "published";
  const toggle = () => onAsk({
    title: hide ? `Hide ${label}?` : `Show ${label} again?`,
    body: hide ? "It disappears from the power rankings pages, the archive and the sitemap. Nothing is deleted; you can show it again." : "It's back on the power rankings pages, the archive and the sitemap.",
    confirm: hide ? "Hide week" : "Show week",
    run: async () => { applied(await apiFetch<{ panel: OwnerPowerRankings }>(`${base}/status`, { method: "POST", json: { confirm: true, status: hide ? "hidden" : "published" } })); toast.success(hide ? "Hidden." : "Shown."); },
  });

  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{weekLabel(w.week)}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {seasonLabel(w.season)} · published {publishedLabel(w.published)}{w.comparedWith ? ` · moves since week ${Number(w.comparedWith.slice(6))}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant={w.status === "published" ? "success" : w.status === "hidden" ? "destructive" : "secondary"}>
              {w.status === "published" ? "Live" : w.status === "hidden" ? "Hidden" : "Being written"}
            </Badge>
            {w.overridden && <Badge variant="outline">Replaced by a hand-written file</Badge>}
            <Badge variant="soft"><Bot aria-hidden /> Bruno {n("bruno")}</Badge>
            <Badge variant="secondary"><FileText aria-hidden /> Template {n("template")}</Badge>
            {n("owner") > 0 && <Badge variant="outline"><Pencil aria-hidden /> Edited {n("owner")}</Badge>}
          </div>
        </div>
        {w.status !== "pending" && (
          <div className="flex flex-wrap gap-2">
            {w.status === "published" && !w.overridden && (
              <Button variant="ghost" size="sm" asChild><a href={`/power-rankings/${w.week}`} target="_blank" rel="noreferrer"><ExternalLink /> View</a></Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => { setEditing((v) => !v); setIntro(w.intro); setBlurbs({}); }}><Pencil /> {editing ? "Stop editing" : "Edit"}</Button>
            <Button variant="secondary" size="sm" onClick={regenerate}><RefreshCw /> Regenerate</Button>
            <Button variant="secondary" size="sm" onClick={toggle}>{hide ? <><EyeOff /> Hide</> : <><Eye /> Show</>}</Button>
          </div>
        )}
      </div>

      <details className="mt-3 group" open={editing || undefined}>
        <summary className="cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground">Intro and {w.entries.length} blurbs</summary>
        <div className="mt-3 grid gap-3">
          <div>
            <p className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">Intro <Badge variant={SOURCE[w.introSource].variant}>{SOURCE[w.introSource].label}</Badge></p>
            {editing
              ? <Textarea aria-label={`Intro for ${label}`} value={intro} maxLength={1500} onChange={(e) => setIntro(e.target.value)} />
              : <p className="text-sm text-foreground">{w.intro}</p>}
          </div>
          <ol className="grid gap-2">
            {w.entries.map((e) => (
              <li key={e.team} className="rounded-lg border border-border/70 p-3">
                <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold tabular-nums text-foreground">#{e.rank}</span>
                  <span className="tabular-nums">{e.team}</span>{e.name && <span className="truncate">{e.name}</span>}
                  <Badge variant={SOURCE[e.source].variant}>{SOURCE[e.source].label}</Badge>
                </p>
                {editing
                  ? <Textarea aria-label={`Blurb for ${e.team}`} value={blurbs[e.team] ?? e.text} maxLength={700} onChange={(ev) => setBlurbs((b) => ({ ...b, [e.team]: ev.target.value }))} />
                  : <p className="text-sm text-foreground">{e.text}</p>}
                {e.rejected && e.rejected.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Bruno's blurb failed the fact check: {e.rejected.join("; ")}.</p>
                )}
              </li>
            ))}
          </ol>
          {editing && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setEditing(false); setIntro(w.intro); setBlurbs({}); }}>Cancel</Button>
              <Button onClick={save} disabled={!introChanged && !changed.length}><Pencil /> Save edits</Button>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export function PowerRankingsPanel({ onOpenSwitches }: { onOpenSwitches: () => void }) {
  const state = useApi<OwnerPowerRankings>(PATH);
  const { setAsk, dialog } = useAction();
  const publish = () => setAsk({
    title: "Publish this week's power rankings now?",
    body: "The top 25 is taken from the live world ranking right now, Bruno writes the blurbs, and each is fact-checked before the week goes live. Friday's run then skips this week, since it's already out.",
    confirm: "Publish now",
    run: async () => {
      const r = await apiFetch<{ panel: OwnerPowerRankings; result: { week: string; bruno: number; template: number } }>(`${PATH}/publish-now`, { method: "POST", json: { confirm: true } });
      applied(r);
      toast.success(`Published ${r.result.week}: ${r.result.bruno} blurbs by Bruno, ${r.result.template} from the template.`);
    },
  });
  return (
    <Section title="Power rankings" description="A top 25 is published every Friday at 00:00 New York time from the live world ranking, with blurbs by Bruno. Every number in a blurb is checked against the week's data; a blurb that fails, or every blurb when Bruno can't be reached, uses a data-only template instead.">
      <Async state={state}>
        {(p) => (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <ul className="grid gap-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", p.enabled ? "bg-success" : "bg-danger")} aria-hidden />
                  {p.enabled ? "Automatic weeks are on." : "Automatic weeks are off: nothing new is generated."}
                  <button type="button" className="text-xs text-accent-text underline underline-offset-2" onClick={onOpenSwitches}>Switches</button>
                </li>
                <li className="flex items-center gap-2 text-muted-foreground"><CalendarClock className="size-4" aria-hidden /> Next run {nextRun(p.nextRun)}</li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Sparkles className="size-4" aria-hidden />
                  {p.controlPoint ? "Bruno is reachable through Control Point." : "Control Point isn't configured on this server: every blurb will be the template."}
                </li>
              </ul>
              <Button onClick={publish} disabled={!p.enabled}><Send /> Publish now</Button>
            </div>
            {p.weeks.length
              ? <ul className="grid gap-3" aria-label="Generated weeks">{p.weeks.map((w) => <Week key={`${w.season}-${w.week}`} w={w} onAsk={setAsk} />)}</ul>
              : <EmptyState icon={Trophy} title="No automatic weeks yet" description="The first one is published on the next run, or now with Publish now." />}
          </>
        )}
      </Async>
      {dialog}
    </Section>
  );
}
