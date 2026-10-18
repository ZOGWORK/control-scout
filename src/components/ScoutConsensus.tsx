// "Your team's take": the scout consensus of the account's workspace (src/lib/consensus.ts) on the team page
// and in Compare. Nothing at all for anyone who isn't in a workspace, signed out, or refused by the server.
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ClipboardList, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { Section } from "./page";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/controls";
import { Meter, StatTile } from "./StatTile";
import { cn } from "./cn";
import { scoutTeamHref, useConsensus, type Consensus } from "../lib/consensus";
import { workspaceLabel } from "../lib/scoutSpace";
import { agoShort, int } from "../lib/format";
import type { ConsensusNumber, ConsensusTag, TeamConsensus } from "../shared/consensus";

const avg = (x: ConsensusNumber) => (Number.isInteger(x.avg) ? String(x.avg) : x.avg.toFixed(1));
const entriesLine = (c: TeamConsensus) =>
  `${int(c.entries)} ${c.entries === 1 ? "entry" : "entries"} by ${int(c.scouts)} ${c.scouts === 1 ? "scout" : "scouts"}${c.lastUpdated ? ` · updated ${agoShort(c.lastUpdated)}` : ""}`;

/** Pick another of the account's workspaces (only when there's more than one). */
function WorkspacePicker({ c, className }: { c: Consensus; className?: string }) {
  if (c.workspaces.length < 2) return null;
  return (
    <Select value={c.workspace.id} onValueChange={c.select}>
      <SelectTrigger size="sm" aria-label="Workspace" className={cn("h-9 max-w-[12rem] max-sm:h-10", className)}><SelectValue /></SelectTrigger>
      <SelectContent>{c.workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{workspaceLabel(w)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Chips({ tags, tone, label }: { tags: ConsensusTag[]; tone: "good" | "bad" | "plain"; label: string }) {
  if (!tags.length) return null;
  const cls = tone === "good" ? "border-success/30 bg-success/[0.08]" : tone === "bad" ? "border-danger/30 bg-danger/[0.08]" : "border-border bg-card";
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {tags.map((t) => (
        <li key={t.label} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", cls)}>
          <span className="break-words">{t.label}</span><span className="font-mono tabular-nums text-muted-foreground" aria-label={`${t.count} ${t.count === 1 ? "entry" : "entries"}`}>×{t.count}</span>
        </li>
      ))}
    </ul>
  );
}

function NoScouting({ c, team, season, compact }: { c: Consensus; team: number; season: number; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-border text-sm text-muted-foreground", compact ? "px-3 py-3" : "px-4 py-6 text-center")}>
      <p>No scouting on {team} in {workspaceLabel(c.workspace)} yet.</p>
      <Link to={scoutTeamHref(c.workspace.id, team, season)} className="mt-1 inline-flex min-h-8 items-center gap-1 font-medium text-accent-text underline-offset-4 hover:underline">Scout this team <span aria-hidden>→</span></Link>
    </div>
  );
}

/** The team page's block. */
export function TeamConsensusSection({ team, season }: { team: number; season: number }) {
  const c = useConsensus([team], season);
  if (!c || c.state.error) return null; // not a member (403), paused (503) or unreachable: say nothing
  const d = c.state.data?.teams[0];
  const name = workspaceLabel(c.workspace);
  return (
    <Section title="Your team's take"
      description={<>{name} scouting: what its scouts agree on, from their shared entries. Only members of {name} see this.</>}
      action={<div className="flex flex-wrap items-center justify-end gap-2"><WorkspacePicker c={c} />
        <Button variant="secondary" size="sm" asChild className="max-sm:h-10"><Link to={scoutTeamHref(c.workspace.id, team, season)}><ClipboardList /> Scout</Link></Button></div>}>
      {!d ? <Skeleton className="h-28 w-full rounded-xl" /> : !d.entries ? <NoScouting c={c} team={team} season={season} /> : (
        <div className="space-y-4" data-testid="consensus">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <StatTile tone="accent" icon={Users} label="Entries" value={int(d.entries)}
              hint={`${int(d.matchEntries)} match · ${int(d.pitEntries)} pit · ${int(d.scouts)} ${d.scouts === 1 ? "scout" : "scouts"}${d.lastUpdated ? ` · ${agoShort(d.lastUpdated)}` : ""}`} />
            {d.ratings.map((r) => (
              <StatTile key={`${r.kind}:${r.id}`} tone="violet" icon={ThumbsUp} label={r.label}
                value={<>{avg(r)}<span className="text-base font-normal text-muted-foreground"> / {r.max}</span></>}
                hint={`average of ${int(r.n)}`} bar={<Meter parts={[{ pc: ((r.avg - 1) / ((r.max ?? 5) - 1)) * 100, cls: "bg-violet-500" }]} />} />
            ))}
          </div>
          {d.counters.length > 0 && (
            <dl className="grid gap-x-6 gap-y-1.5 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {d.counters.map((x) => (
                <div key={`${x.kind}:${x.id}`} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 text-muted-foreground">{x.label}{x.kind === "pit" && <span className="ml-1 text-xs">(pit)</span>}</dt>
                  <dd className="shrink-0 font-medium tabular-nums">{avg(x)}<span className="ml-1 text-xs font-normal text-muted-foreground">avg of {int(x.n)}</span></dd>
                </div>
              ))}
            </dl>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <TagGroup title="Strengths" icon={<ThumbsUp className="size-4 text-success" aria-hidden />} tags={d.strengths} tone="good" empty="No rating stands out high yet." />
            <TagGroup title="Weaknesses" icon={<ThumbsDown className="size-4 text-danger" aria-hidden />} tags={d.weaknesses} tone="bad" empty="No rating stands out low yet." />
            <TagGroup title="Most noted" tags={d.tags} tone="plain" empty="No choices or yes answers yet." />
          </div>
          <p className="text-xs text-muted-foreground">Averages use every member's entries this season, each read with the template it was made with. A strength or weakness is a rating in the top or bottom quarter of its scale; the count is how many entries said so.</p>
        </div>
      )}
    </Section>
  );
}

function TagGroup({ title, icon, tags, tone, empty }: { title: string; icon?: ReactNode; tags: ConsensusTag[]; tone: "good" | "bad" | "plain"; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">{icon}{title}</p>
      {tags.length ? <Chips tags={tags} tone={tone} label={title} /> : <p className="text-xs text-muted-foreground">{empty}</p>}
    </div>
  );
}

/** Compare's row: one small card per team, in the cards' colours. `hideWhenEmpty`: nothing until the
 *  workspace has scouted at least one of the teams (and nothing while that's still loading). */
export function CompareConsensus({ teams, season, colors, hideWhenEmpty }: { teams: number[]; season: number; colors: string[]; hideWhenEmpty?: boolean }) {
  const c = useConsensus(teams, season);
  if (!c || c.state.error) return null;
  const data = c.state.data;
  const name = workspaceLabel(c.workspace);
  if (hideWhenEmpty && !data?.teams.some((x) => teams.includes(x.team) && x.entries > 0)) {
    // No cards, but another workspace may have scouted these teams: keep the way to switch to it.
    if (!data || c.workspaces.length < 2) return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        <p>No scouting on these teams in {name} yet. Another workspace may have some.</p>
        <WorkspacePicker c={c} />
      </div>
    );
  }
  return (
    <Section title="Your team's take" description={<>{name} scouting on each team, from its shared entries. Only members of {name} see this.</>} action={<WorkspacePicker c={c} />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]" style={{ "--n": Math.min(teams.length, 4) } as CSSProperties}>
        {teams.map((team, i) => {
          const d = data?.teams.find((x) => x.team === team);
          return (
            <div key={team} className="min-w-0 rounded-xl border border-border bg-card p-4" style={{ borderTopColor: colors[i], borderTopWidth: 3 }} data-testid="consensus-card">
              <p className="font-display text-lg font-semibold">{team}</p>
              {!d ? <Skeleton className="mt-2 h-20 w-full" /> : !d.entries ? <div className="mt-2"><NoScouting c={c} team={team} season={season} compact /></div> : (
                <div className="mt-1 space-y-3 text-sm">
                  <p className="text-xs text-muted-foreground">{entriesLine(d)}</p>
                  {d.ratings.length > 0 && (
                    <dl className="space-y-1.5">
                      {d.ratings.slice(0, 4).map((r) => (
                        <div key={`${r.kind}:${r.id}`} className="flex items-baseline justify-between gap-2">
                          <dt className="min-w-0 truncate text-muted-foreground">{r.label}</dt>
                          <dd className="shrink-0 font-medium tabular-nums">{avg(r)}<span className="text-xs font-normal text-muted-foreground"> / {r.max}</span></dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {d.strengths.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">Strengths</p><Chips tags={d.strengths.slice(0, 3)} tone="good" label={`${team} strengths`} /></div>}
                  {d.weaknesses.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">Weaknesses</p><Chips tags={d.weaknesses.slice(0, 3)} tone="bad" label={`${team} weaknesses`} /></div>}
                  {d.tags.length > 0 && <div><p className="mb-1 text-xs text-muted-foreground">Most noted</p><Chips tags={d.tags.slice(0, 3)} tone="plain" label={`${team} most noted`} /></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
