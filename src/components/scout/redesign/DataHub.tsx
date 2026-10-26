// The Scout page's Data tab (docs/mockups/scout-redesign.html, step 6): one list in place of the old toolbar's
// buttons, so the screen a student scouts from stays clear. Each row opens a view the page already has (a
// callback) or, for Export CSV, is the download link itself. Rows follow the space: Personal has no pick list,
// activity, assignments, export or template; a read-only workspace keeps everything that reads and drops the template.
import type { ComponentType, ReactNode } from "react";
import { ChevronRight, ClipboardCheck, ClipboardList, Download, History, LayoutList, ListOrdered, Video, Wrench } from "lucide-react";
import { workspaceExportUrl } from "../../../shared/scoutExport";
import { Badge } from "../../ui/basic";
import { cn } from "../../cn";

/** The views a row opens (Export CSV is a link, so it has none). */
export type DataView = "entries" | "picklist" | "activity" | "assignments" | "pit" | "recordings" | "template";

/** What Export CSV sends: the page URL's filters (the entry list's), for the season on screen. The same as the page's own. */
export function dataHubExportUrl(workspaceId: string, sp: URLSearchParams, season: number): string {
  const out = new URLSearchParams(sp);
  out.set("season", String(season));
  return workspaceExportUrl(workspaceId, out);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface DataHubProps {
  /** The workspace on screen (null: Personal). */
  workspace: { id: string; name: string } | null;
  /** The workspace can only be read (deleted in Control Point, or no admin left). */
  readOnly?: boolean;
  /** An admin of the workspace (the template row). Ignored when read-only. */
  isAdmin?: boolean;
  season: number;
  /** The session's event, for the rows' wording (null: none picked). */
  eventCode?: string | null;
  /** Entries in the list Entries opens (the space's, this season). */
  entryCount: number;
  /** Open assignments for you in this workspace. */
  openForYou?: number;
  /** Pit scouting at the session's event, when the page knows the event's teams. */
  pit?: { done: number; total: number } | null;
  /** The page's URL filters, which the export applies (the entry list's own). */
  filters?: URLSearchParams;
  /** How many entries the filters leave, when any filter is set (for the export's screen-reader label). */
  filteredCount?: number | null;
  onOpen: (v: DataView) => void;
  className?: string;
}

interface Row { key: string; icon: ComponentType<{ className?: string }>; title: string; detail: ReactNode; badge?: number; open?: DataView; href?: string; srExtra?: string }

/** The rows a space shows, in order (exported for the tests and the preview). */
export function dataHubRows(p: Omit<DataHubProps, "onOpen" | "className">): Row[] {
  const ws = p.workspace, ro = !!p.readOnly;
  const at = p.eventCode ? ` at ${p.eventCode}` : "";
  const rows: Row[] = [
    { key: "entries", icon: ClipboardList, open: "entries", title: "Entries", detail: `${plural(p.entryCount, "entry", "entries")} in ${p.season} · ${ro ? "filter, search, read" : "filter, search, edit"}` },
  ];
  if (ws) {
    rows.push({ key: "picklist", icon: ListOrdered, open: "picklist", title: "Pick list", detail: ro ? "Shared with the workspace · read-only" : "Shared with the workspace" });
    rows.push({ key: "activity", icon: History, open: "activity", title: "Activity", detail: "What changed in the workspace" });
    const mine = Math.max(0, p.openForYou ?? 0);
    rows.push({ key: "assignments", icon: ClipboardCheck, open: "assignments", title: "Assignments", detail: mine ? `Who scouts which teams · ${mine} open for you` : "Who scouts which teams", badge: mine || undefined });
  }
  const pit = p.pit && p.pit.total > 0 ? p.pit : null;
  rows.push({ key: "pit", icon: Wrench, open: "pit", title: "Pit scouting", detail: pit ? `${Math.min(pit.done, pit.total)} of ${plural(pit.total, "team")} done${at}` : "Robot details, once per team" });
  rows.push({ key: "recordings", icon: Video, open: "recordings", title: "Match recordings", detail: "Videos on this device, YouTube links" });
  if (ws) {
    const filtered = p.filteredCount != null;
    rows.push({ key: "export", icon: Download, title: "Export CSV", href: dataHubExportUrl(ws.id, p.filters ?? new URLSearchParams(), p.season),
      detail: filtered ? `The ${plural(p.filteredCount!, "filtered entry", "filtered entries")}` : `All ${p.season} entries`,
      srExtra: filtered ? ` (the ${p.filteredCount} filtered ${p.season} entries)` : ` (all ${p.season} entries)` });
  }
  if (ws && p.isAdmin && !ro) rows.push({ key: "template", icon: LayoutList, open: "template", title: "Template", detail: "Admins: the fields people fill in" });
  return rows;
}

export function DataHub({ onOpen, className, ...p }: DataHubProps) {
  const rows = dataHubRows(p);
  // The rows are Settings' list rows (src/components/settings): a bordered card, hairlines between, an accent icon.
  return (
    <ul aria-label="Scout data" className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      {rows.map((r) => {
        const Icon = r.icon;
        const inner = (
          <>
            <Icon aria-hidden className="size-4 shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{r.title}{r.srExtra && <span className="sr-only">{r.srExtra}</span>}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
            </span>
            {/* The detail line already says the count; the badge is for the eye. */}
            {r.badge != null && <Badge variant="beta" aria-hidden className="shrink-0 tabular-nums">{r.badge}</Badge>}
            {r.href ? <Download aria-hidden className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
          </>
        );
        const cls = "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-text-base/[0.04] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60";
        return (
          <li key={r.key} data-row={r.key} className="border-b border-border last:border-b-0">
            {r.href ? <a href={r.href} download className={cls}>{inner}</a>
              : <button type="button" onClick={() => onOpen(r.open!)} className={cls}>{inner}</button>}
          </li>
        );
      })}
    </ul>
  );
}
