// The Scout page's Data tab: what you've scouted and what your team plans with it, as a few large cards in
// groups instead of one long list. "Your data" (Entries, Pit scouting, Match recordings) and "Team planning"
// (Pick list, Assignments, Scouting alliance) are cards, the most used one in each group wider and first; each
// card says one live fact (a count it already has) or, when empty, what to do. "Manage" (Activity, Template,
// Export CSV) is a quiet row of buttons at the bottom. Cards follow the space: Personal has no team planning,
// activity, export or template; a read-only workspace keeps everything that reads and drops the template.
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { ChevronRight, ClipboardCheck, ClipboardList, Download, Handshake, History, LayoutList, ListOrdered, Video, Wrench } from "lucide-react";
import { workspaceExportUrl } from "../../../shared/scoutExport";
import { seasonLabel } from "../../../shared/format";
import { CHANGED, countRecordings } from "../../../lib/recordings";
import { Badge } from "../../ui/basic";
import { Button } from "../../ui/button";
import { cn } from "../../cn";

/** The views a card or button opens (Export CSV is a link, so it has none). */
export type DataView = "entries" | "picklist" | "activity" | "assignments" | "alliance" | "pit" | "recordings" | "template";

/** What Export CSV sends: the page URL's filters (the entry list's), for the season on screen. The same as the page's own. */
export function dataHubExportUrl(workspaceId: string, sp: URLSearchParams, season: number): string {
  const out = new URLSearchParams(sp);
  out.set("season", String(season));
  return workspaceExportUrl(workspaceId, out);
}

/** Teams with a pit entry: a robot written up twice is still one robot. */
export function pitTeams(entries: readonly { kind: string; team: number }[]): number {
  return new Set(entries.filter((e) => e.kind === "pit").map((e) => e.team)).size;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DataHubProps {
  /** The workspace on screen (null: Personal). */
  workspace: { id: string; name: string } | null;
  /** The workspace can only be read (deleted in Control Point, or no admin left). */
  readOnly?: boolean;
  /** An admin of the workspace (the template button). Ignored when read-only. */
  isAdmin?: boolean;
  season: number;
  /** The session's event, for the cards' wording (null: none picked). */
  eventCode?: string | null;
  /** Entries in the list Entries opens (the space's, this season). */
  entryCount: number;
  /** How many teams those pit entries cover (Pit scouting's fact when the event's teams aren't known). */
  pitCount?: number;
  /** Scouting alliances on for this workspace (the owner's scoutingAlliances switch). Absent: on. */
  alliances?: boolean;
  /** Open assignments for you in this workspace. */
  openForYou?: number;
  /** Pit scouting at the session's event, when the page knows the event's teams. */
  pit?: { done: number; total: number } | null;
  /** Recordings on this device (tests and the preview; absent: the card counts them itself). */
  recordingCount?: number | null;
  /** The page's URL filters, which the export applies (the entry list's own). */
  filters?: URLSearchParams;
  /** How many entries the filters leave, when any filter is set (for the export's label). */
  filteredCount?: number | null;
  onOpen: (v: DataView) => void;
  /** The empty Entries card's "Start scouting" (the Scout tab). Absent: no button. */
  onStartScouting?: () => void;
  className?: string;
}

type Icon = ComponentType<{ className?: string }>;
/** One card: `fact` is its live line; `empty` marks a card with nothing in it yet (its fact says what to do). */
export interface DataCard { key: string; icon: Icon; title: string; fact: string; open: DataView; featured?: boolean; empty?: boolean; badge?: number; note?: string }
/** One Manage button: opens a view, or (Export CSV) is the download link. */
export interface DataAction { key: string; icon: Icon; label: string; open?: DataView; href?: string; srExtra?: string }
export interface DataHubLayout { yours: DataCard[]; planning: DataCard[]; manage: DataAction[] }

/** What a space shows, group by group (exported for the tests). */
export function dataHubLayout(p: Omit<DataHubProps, "onOpen" | "onStartScouting" | "className">): DataHubLayout {
  const ws = p.workspace, ro = !!p.readOnly;
  const season = seasonLabel(p.season);
  const at = p.eventCode ? ` at ${p.eventCode}` : "";
  const roNote = ro ? "Read-only" : undefined;

  const yours: DataCard[] = [];
  yours.push(p.entryCount > 0
    ? { key: "entries", icon: ClipboardList, open: "entries", featured: true, note: roNote, title: "Entries", fact: `${plural(p.entryCount, "entry", "entries")} in ${season}` }
    : { key: "entries", icon: ClipboardList, open: "entries", featured: true, note: roNote, title: "Entries", empty: true, fact: ro ? `No entries in ${season}` : `No entries in ${season} yet. Start scouting to fill this in.` });
  const pit = p.pit && p.pit.total > 0 ? p.pit : null;
  const pitN = Math.max(0, p.pitCount ?? 0);
  yours.push(pit
    ? { key: "pit", icon: Wrench, open: "pit", title: "Pit scouting", fact: `${Math.min(pit.done, pit.total)} of ${plural(pit.total, "team")} done${at}`, empty: pit.done === 0 }
    : pitN > 0
      ? { key: "pit", icon: Wrench, open: "pit", title: "Pit scouting", fact: `${plural(pitN, "robot")} written up` }
      : { key: "pit", icon: Wrench, open: "pit", title: "Pit scouting", empty: true, fact: "None yet. Note a robot's details, once per team." });
  const rec = p.recordingCount;
  yours.push({ key: "recordings", icon: Video, open: "recordings", title: "Match recordings",
    fact: rec == null ? "Videos on this device, YouTube links" : rec > 0 ? `${plural(rec, "video")} on this device` : "None on this device yet. Record a match to keep it here.",
    empty: rec === 0 });

  const planning: DataCard[] = [];
  const manage: DataAction[] = [];
  if (ws) {
    planning.push({ key: "picklist", icon: ListOrdered, open: "picklist", featured: true, note: roNote, title: "Pick list", fact: ro ? "Your workspace's ranking of teams" : "Rank teams together for alliance selection" });
    const mine = Math.max(0, p.openForYou ?? 0);
    planning.push({ key: "assignments", icon: ClipboardCheck, open: "assignments", title: "Assignments", fact: mine ? `${plural(mine, "assignment")} open for you` : "Nothing open for you", badge: mine || undefined });
    if (p.alliances !== false) planning.push({ key: "alliance", icon: Handshake, open: "alliance", title: "Scouting alliance", fact: "Share one event's scouting with another team" });

    manage.push({ key: "activity", icon: History, open: "activity", label: "Activity" });
    if (p.isAdmin && !ro) manage.push({ key: "template", icon: LayoutList, open: "template", label: "Template" });
    const filtered = p.filteredCount != null;
    manage.push({ key: "export", icon: Download, label: "Export CSV", href: dataHubExportUrl(ws.id, p.filters ?? new URLSearchParams(), p.season),
      srExtra: filtered ? ` (the ${p.filteredCount} filtered ${p.season} entries)` : ` (all ${p.season} entries)` });
  }
  return { yours, planning, manage };
}

/** Recordings on this device, kept current (null until counted, or when the browser can't store them). */
function useRecordingCount(skip: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    const count = () => { countRecordings().then((c) => { if (live) setN(c); }, () => { if (live) setN(null); }); };
    count();
    window.addEventListener(CHANGED, count);
    return () => { live = false; window.removeEventListener(CHANGED, count); };
  }, [skip]);
  return n;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = `data-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-2.5 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Cards({ cards, onOpen, onStartScouting, readOnly }: { cards: DataCard[]; onOpen: (v: DataView) => void; onStartScouting?: () => void; readOnly: boolean }) {
  const smalls = cards.filter((c) => !c.featured).length;
  return (
    // Phone: the featured card full width, the others two to a row. Desktop: four columns, the featured card two of them.
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        const wide = c.featured || smalls === 1;
        const start = c.key === "entries" && c.empty && !readOnly && onStartScouting;
        return (
          <li key={c.key} data-card={c.key} className={cn("flex flex-col rounded-xl border border-border bg-card", wide ? "col-span-2" : "col-span-1", c.empty && "border-dashed")}>
            <button type="button" onClick={() => onOpen(c.open)}
              className={cn("group flex w-full flex-1 flex-col gap-3 rounded-xl text-left transition-colors hover:bg-text-base/[0.04] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                c.featured ? "p-4 sm:p-5" : "p-3.5 sm:p-4")}>
              <span className="flex items-start justify-between gap-2">
                <span className={cn("grid shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text", c.featured ? "size-10" : "size-8")}>
                  <Icon className={c.featured ? "size-5" : "size-4"} />
                </span>
                <span className="flex items-center gap-1.5">
                  {c.note && <Badge variant="outline" className="shrink-0">{c.note}</Badge>}
                  {/* The fact already says the count; the badge is for the eye. */}
                  {c.badge != null && <Badge variant="beta" aria-hidden className="shrink-0 tabular-nums">{c.badge}</Badge>}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
              <span className="min-w-0">
                <span className={cn("block font-semibold text-foreground", c.featured ? "text-base sm:text-lg" : "text-sm")}>{c.title}</span>
                <span className={cn("mt-0.5 block text-xs", c.empty ? "text-muted-foreground" : "text-foreground/80")}>{c.fact}</span>
              </span>
            </button>
            {start && (
              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                <Button size="sm" onClick={onStartScouting}>Start scouting</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DataHub({ onOpen, onStartScouting, className, ...p }: DataHubProps) {
  const counted = useRecordingCount(p.recordingCount !== undefined);
  const { yours, planning, manage } = dataHubLayout({ ...p, recordingCount: p.recordingCount !== undefined ? p.recordingCount : counted });
  return (
    <div aria-label="Scout data" role="region" className={cn("flex flex-col gap-6", className)}>
      <Group title="Your data"><Cards cards={yours} onOpen={onOpen} onStartScouting={onStartScouting} readOnly={!!p.readOnly} /></Group>
      {planning.length > 0 && <Group title="Team planning"><Cards cards={planning} onOpen={onOpen} readOnly={!!p.readOnly} /></Group>}
      {manage.length > 0 && (
        <Group title="Manage">
          <div className="flex flex-wrap gap-2">
            {manage.map((a) => {
              const Icon = a.icon;
              return a.href ? (
                <Button key={a.key} asChild variant="secondary" size="sm" data-action={a.key}>
                  <a href={a.href} download><Icon />{a.label}{a.srExtra && <span className="sr-only">{a.srExtra}</span>}</a>
                </Button>
              ) : (
                <Button key={a.key} variant="outline" size="sm" data-action={a.key} onClick={() => onOpen(a.open!)}><Icon />{a.label}</Button>
              );
            })}
          </div>
        </Group>
      )}
    </div>
  );
}
