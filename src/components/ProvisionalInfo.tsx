// A regional site's event details and registered teams (FTC New Jersey), shown until FIRST posts the event's
// own team list or schedule (server/api/events.ts). Always labelled with where it's from and that it isn't
// FIRST's: the site's list can still change, and FIRST's replaces it.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Info, Search, Users } from "lucide-react";
import type { ProvisionalInfo, SharedSessions } from "../shared/api";
import { Badge, Input } from "./ui/basic";
import { EmptyState } from "./page";
import { ago, place } from "../lib/format";
import { cn } from "./cn";

/** "From FTC New Jersey (newjerseyftc.com), read 2 h ago. Not FIRST's official list yet." */
function SourceNote({ p, what }: { p: ProvisionalInfo; what: string }) {
  const host = new URL(p.url).hostname.replace(/^www\./, "");
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground" data-provisional-source>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {what} from <a href={p.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground">{p.sourceName} ({host})<ExternalLink className="size-3" /></a>, read {ago(p.fetchedAt)}.
        {" "}Provisional: FIRST hasn&apos;t published this event yet, and its data replaces this once it does.
      </span>
    </p>
  );
}

/** The header's event-info panel: hosts, times, capacity, format. */
export function ProvisionalDetails({ p }: { p: ProvisionalInfo }) {
  const rows: [string, string][] = [];
  if (p.nickname) rows.push(["Event", p.nickname]);
  if (p.hosts) rows.push(["Hosts", p.hosts]);
  if (p.address) rows.push(["Address", place(p.venue, p.address)]);
  if (p.capacity) rows.push(["Capacity", `${p.capacity} teams`]);
  if (p.schedule.length) rows.push(["Times", p.schedule.join(" · ")]);
  if (p.notes.length) rows.push(["Format", p.notes.join(" · ")]);
  if (!rows.length && !p.closed) return null;
  return (
    <section aria-label={`Event info from ${p.sourceName}`} className="mt-4 rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3 text-sm" data-provisional-details>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">Event info</span>
        <Badge variant="outline">Provisional</Badge>
        {p.closed && <Badge variant="secondary">Registration closed</Badge>}
      </div>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words max-sm:mb-1">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2.5"><SourceNote p={p} what="Event info" /></div>
    </section>
  );
}

type CardTeam = { team: number; name: string | null; city: string | null; state: string | null; known: boolean };

/** A grid of team cards. A team FIRST doesn't list yet has no team page: its card isn't a link. */
function TeamCards({ teams, season, team, label }: { teams: CardTeam[]; season: number; team: number | null; label: string }) {
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" aria-label={label}>
      {teams.map((t) => {
        const box = cn("flex h-full items-center gap-3 rounded-xl border border-border bg-card p-3", t.team === team && "border-accent/60 bg-accent/[0.06]");
        const body = (
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2"><span className="font-mono font-semibold">{t.team}</span><span className="truncate text-sm">{t.name}</span></span>
            <span className="block truncate text-xs text-muted-foreground">{place(t.city, t.state) || "—"}</span>
          </span>
        );
        return <li key={t.team}>{t.known ? <Link to={`/teams/${t.team}?season=${season}`} className={cn("lift", box)}>{body}</Link> : <div className={box} data-team-unknown>{body}</div>}</li>;
      })}
    </ul>
  );
}

/** A search box over a team list, and the filter it sets. */
function useTeamSearch(count: number) {
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const match = (t: Omit<CardTeam, "known">) => !f || `${t.team} ${t.name ?? ""} ${t.city ?? ""} ${t.state ?? ""}`.toLowerCase().includes(f);
  const box = (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find one of ${count} teams`} aria-label="Find a team registered for this event" className="h-10 pl-9" />
    </div>
  );
  return { match, box };
}

const byNumber = (a: { team: number }, b: { team: number }) => a.team - b.team;

/** The Teams tab before FIRST's list: the site's registered teams, then its waitlist apart (not in the event). */
export function ProvisionalTeams({ p, season, team }: { p: ProvisionalInfo; season: number; team: number | null }) {
  const { match, box } = useTeamSearch(p.teams.length);
  const registered = p.teams.filter((t) => t.status === "registered");
  const waitlist = p.teams.filter((t) => t.status === "pending");
  const shownIn = registered.filter(match).sort(byNumber), shownWait = waitlist.filter(match).sort(byNumber);
  if (!p.teams.length) return <EmptyState icon={Users} title="No teams registered yet" description="The team list appears once FIRST publishes it." />;
  return (
    <div className="space-y-4" data-provisional-teams>
      <div className="rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3">
        <p className="mb-1.5 text-sm font-medium text-foreground">{registered.length} teams registered{p.sessionUnknown ? " for the morning and afternoon sessions" : ""}{waitlist.length ? ` · ${waitlist.length} on the waitlist` : ""}{p.closed ? " · registration closed" : ""}</p>
        <SourceNote p={p} what="Team list" />
        {p.sessionUnknown && <p className="mt-1.5 text-xs text-muted-foreground">This event runs morning and afternoon sessions; the list doesn&apos;t say which session each team is in.</p>}
      </div>
      {box}
      {!shownIn.length && !shownWait.length ? <EmptyState icon={Search} title="No team matches" /> : (
        <>
          {shownIn.length > 0 && <TeamCards teams={shownIn} season={season} team={team} label="Registered teams" />}
          {shownWait.length > 0 && (
            <section aria-labelledby="provisional-waitlist" className="space-y-2.5" data-provisional-waitlist>
              <div>
                <h3 id="provisional-waitlist" className="text-sm font-medium text-foreground">Waitlist ({waitlist.length})</h3>
                <p className="text-xs text-muted-foreground">
                  Pending on {p.sourceName}&apos;s list: not in this event unless a spot opens{p.teams.some((t) => t.session) ? ", and not yet placed in the morning or afternoon session" : ""}.
                </p>
              </div>
              <TeamCards teams={shownWait} season={season} team={team} label="Waitlisted teams" />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The Teams tab of one session of an AM/PM event when FIRST lists both sessions' teams together. */
export function SharedSessionTeams({ s, season, team }: { s: SharedSessions; season: number; team: number | null }) {
  const { match, box } = useTeamSearch(s.teams.length);
  const shown = s.teams.filter(match);
  return (
    <div className="space-y-4" data-shared-sessions>
      <div className="rounded-xl border border-dashed border-border bg-muted/40 px-3.5 py-3">
        <p className="mb-1.5 text-sm font-medium text-foreground">{s.teams.length} teams registered for the morning and afternoon sessions</p>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This event runs as two sessions: this one and <Link to={`/events/${season}/${encodeURIComponent(s.other.code)}?tab=teams`} className="underline underline-offset-2 hover:text-foreground">{s.other.name}</Link>.
            {" "}FIRST lists both sessions&apos; teams together (read {ago(s.fetchedAt)}): each team plays in one of them, and FIRST doesn&apos;t say which yet.
          </span>
        </p>
      </div>
      {box}
      {!shown.length ? <EmptyState icon={Search} title="No team matches" /> : <TeamCards teams={shown.map((t) => ({ ...t, known: true }))} season={season} team={team} label="Teams registered for either session" />}
    </div>
  );
}
