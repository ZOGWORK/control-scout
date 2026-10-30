// "Scouting commons" on the team page (docs/scouting-commons.md): pit scouting other workspaces shared at events where
// the commons is open, as a separate, labelled layer under the reader's own workspace's take (which comes first).
// Signed-in accounts only; nothing at all when no open event has anything on the team.
import { Camera, Clock, Cog, Globe2, Users } from "lucide-react";
import { Section } from "./page";
import { Badge } from "./ui/basic";
import { StatTile } from "./StatTile";
import { cn } from "./cn";
import { commonsPhotoUrl, pitAge, useCommons, type PitAgeTone } from "../lib/commons";
import { int } from "../lib/format";
import type { CommonsAnswer, CommonsEntry } from "../shared/commons";
import type { ConsensusNumber } from "../shared/consensus";

const avg = (x: ConsensusNumber) => (Number.isInteger(x.avg) ? String(x.avg) : x.avg.toFixed(1));

const AGE_STYLE: Record<PitAgeTone, string> = {
  fresh: "border-success/40 bg-success/10 text-success",
  aging: "border-warning/50 bg-warning/15 text-warning",
  stale: "border-danger/40 bg-danger/10 text-danger",
};

/** The pit claim's age, big and coloured: the first thing read on each entry. */
export function PitAgeBadge({ entry, events, now }: { entry: CommonsEntry; events: CommonsAnswer["events"]; now?: number }) {
  const a = pitAge(entry.scoutedAt, events.find((e) => e.code === entry.eventCode), now);
  return (
    <div className={cn("inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 py-1 text-sm", AGE_STYLE[a.tone])} data-testid="pit-age" data-tone={a.tone}>
      <Clock className="size-4 shrink-0" aria-hidden />
      <span><span className="font-semibold">Scouted {a.when}</span><span className="opacity-90"> · {a.note}</span></span>
    </div>
  );
}

function answerText(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null; // unanswered; 0 and "no" are answers
  return v === true ? "yes" : v === false ? "no" : String(v);
}

function CommonsCard({ entry, events }: { entry: CommonsEntry; events: CommonsAnswer["events"] }) {
  const ev = events.find((e) => e.code === entry.eventCode);
  const answers = entry.fields.map((f) => ({ f, v: answerText(entry.data[f.id]) })).filter((x) => x.v != null);
  return (
    <li className="min-w-0 rounded-xl border border-border border-l-4 border-l-info bg-card p-4" data-testid="commons-entry">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium"><Users className="size-4 shrink-0 text-info" aria-hidden />{entry.source.name}</p>
          <p className="text-xs text-muted-foreground">Pit scouting at {ev?.name ?? entry.eventCode}</p>
        </div>
        <PitAgeBadge entry={entry} events={events} />
      </div>
      {answers.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-1.5">
          {answers.map(({ f, v }) => (
            <div key={f.id} className="inline-flex items-baseline gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs">
              <dt className="text-muted-foreground">{f.label}</dt><dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {entry.notes && <p className="mt-2 whitespace-pre-line text-sm">{entry.notes}</p>}
      {entry.photos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Photos">
          {entry.photos.map((p) => p.expired ? (
            <li key={p.id} className="flex size-20 items-center justify-center rounded-lg border border-dashed border-border text-center text-[11px] text-muted-foreground"><span><Camera className="mx-auto mb-1 size-4" aria-hidden />Photo expired</span></li>
          ) : (
            <li key={p.id}><a href={commonsPhotoUrl(p.id)} target="_blank" rel="noreferrer"><img src={commonsPhotoUrl(p.id)} alt={`${entry.source.name}'s pit photo of ${entry.team}`} loading="lazy" className="size-20 rounded-lg border border-border object-cover" /></a></li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The team page's block, under the reader's own workspace's take. */
export function CommonsSection({ team, season }: { team: number; season: number }) {
  const c = useCommons(team, season);
  const d = c?.data;
  if (!d || !d.entries.length) return null; // signed out, failed, loading, or nothing shared: say nothing
  const l = d.layer;
  const workspaces = l.scouts;
  return (
    <Section title={<span className="inline-flex items-center gap-2">Scouting commons <Badge variant="info"><Globe2 /> Shared by other teams</Badge></span>}
      description={<>Pit scouting other workspaces chose to share at {d.events.length === 1 ? d.events[0].name : "events where the commons is open"}. A separate layer: your own workspace's scouting comes first{d.ownHidden ? `, and your workspace's ${d.ownHidden === 1 ? "share is" : `${d.ownHidden} shares are`} left out here` : ""}. Check the time on each claim: robots change between days.</>}>
      <div className="space-y-4" data-testid="commons">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile tone="sky" icon={Globe2} label="Shared entries" value={int(l.entries)} hint={`from ${int(workspaces)} ${workspaces === 1 ? "workspace" : "workspaces"}`} />
          {l.counters.slice(0, 3).map((x) => (
            <StatTile key={x.id} tone="emerald" icon={Cog} label={x.label} value={avg(x)} hint={`average of ${int(x.n)}`} />
          ))}
          {l.ratings.slice(0, 3).map((r) => (
            <StatTile key={r.id} tone="violet" icon={Cog} label={r.label} value={<>{avg(r)}<span className="text-base font-normal text-muted-foreground"> / {r.max}</span></>} hint={`average of ${int(r.n)}`} />
          ))}
        </div>
        {l.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Most reported">
            {l.tags.map((t) => (
              <li key={t.label} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-info/30 bg-info/[0.08] px-2.5 py-1 text-xs">
                <span className="break-words">{t.label}</span><span className="font-mono tabular-nums text-muted-foreground" aria-label={`${t.count} ${t.count === 1 ? "entry" : "entries"}`}>×{t.count}</span>
              </li>
            ))}
          </ul>
        )}
        <ul className="grid gap-3 lg:grid-cols-2">{d.entries.map((e) => <CommonsCard key={e.id} entry={e} events={d.events} />)}</ul>
        <p className="text-xs text-muted-foreground">Each entry is credited to the workspace that shared it. Averages count each workspace as one scout. Match scouting is never shared.</p>
      </div>
    </Section>
  );
}
