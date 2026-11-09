// Owner console › Bug reports: what people sent with the top bar's "Report a bug" button (server/bugReports.ts), newest
// first, each with its screenshots (click for full size) and video, the details the dialog attached, and Close /
// Reopen / Delete. Attachments load from /api/owner/bug-reports/:id/files/:n, behind the owner gate.
import { useState } from "react";
import { Bug, CheckCircle2, Mail, RotateCcw, Trash2 } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { BUG_CATEGORIES, formatBytes, type BugReportItem, type BugReportList } from "../../shared/bugReport";

const PATH = "/api/owner/bug-reports";

const TONE: Record<string, "destructive" | "soft" | "beta" | "info" | "secondary"> = {
  broken: "destructive", data: "soft", layout: "beta", slow: "info", other: "secondary",
};
const label = (c: string) => BUG_CATEGORIES.find((x) => x.id === c)?.label ?? c;

function Attachments({ r }: { r: BugReportItem }) {
  if (!r.files.length && !r.missing) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {r.files.map((f) => f.type.startsWith("video/")
        ? <video key={f.n} src={f.url} controls preload="metadata" className="max-h-56 max-w-full rounded-lg border border-border bg-black" aria-label={`Video ${f.n + 1}, ${formatBytes(f.bytes)}`} />
        : (
          <a key={f.n} href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={`Screenshot ${f.n + 1}, ${formatBytes(f.bytes)}: open full size`}>
            <img src={f.url} alt={`Screenshot ${f.n + 1} of report #${r.id}`} loading="lazy" className="h-28 w-auto max-w-[14rem] object-cover" />
          </a>
        ))}
      {r.missing > 0 && <span className="self-center text-xs text-muted-foreground">{r.missing} attachment{r.missing === 1 ? " was" : "s were"} never uploaded</span>}
    </div>
  );
}

function ReportCard({ r }: { r: BugReportItem }) {
  const [busy, setBusy] = useState(false);
  const act = async (what: "close" | "reopen" | "delete") => {
    if (what === "delete" && !window.confirm(`Delete bug report #${r.id} and its attachments? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (what === "delete") await apiFetch(`${PATH}/${r.id}`, { method: "DELETE", json: {} });
      else await apiFetch(`${PATH}/${r.id}`, { method: "PATCH", json: { status: what === "close" ? "done" : "open" } });
      markStale(PATH);
      toast.success(what === "delete" ? `Report #${r.id} deleted` : what === "close" ? `Report #${r.id} closed` : `Report #${r.id} reopened`);
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const c = r.context;
  return (
    <li className="rounded-xl border border-border bg-card p-4" data-testid="bug-report">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={TONE[r.category] ?? "secondary"}>{label(r.category)}</Badge>
        {r.status === "done" && <Badge variant="success">Closed</Badge>}
        <span className="text-muted-foreground">#{r.id} · {ago(r.createdAt)}</span>
        {r.email
          ? <a className="inline-flex min-w-0 items-center gap-1 truncate text-accent-text underline-offset-4 hover:underline" href={`mailto:${r.email}`}><Mail className="size-3.5 shrink-0" aria-hidden />{r.email}</a>
          : <span className="text-muted-foreground">No email given</span>}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{r.message}</p>
      <Attachments r={r} />
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Page</dt><dd className="min-w-0 break-all font-mono text-foreground">{c.page ? <a className="hover:underline" href={c.page}>{c.page}</a> : "—"}</dd>
        <dt>Version</dt><dd className="text-foreground">{c.release || "—"}</dd>
        <dt>Screen</dt><dd className="text-foreground">{c.viewport || "—"}</dd>
        <dt>Device</dt><dd className="min-w-0 break-words text-foreground">{c.device || "—"}</dd>
        <dt>Theme</dt><dd className="text-foreground">{c.theme || "—"}</dd>
        <dt>Email</dt><dd className="text-foreground">{r.emailed ? "Sent to you" : "Not emailed"}</dd>
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "open"
          ? <Button size="sm" variant="secondary" className="max-sm:h-10" disabled={busy} onClick={() => void act("close")}><CheckCircle2 /> Close</Button>
          : <Button size="sm" variant="outline" className="max-sm:h-10" disabled={busy} onClick={() => void act("reopen")}><RotateCcw /> Reopen</Button>}
        <Button size="sm" variant="outline" className="max-sm:h-10" disabled={busy} onClick={() => void act("delete")}><Trash2 /> Delete</Button>
      </div>
    </li>
  );
}

export function BugReportsPanel() {
  const state = useApi<BugReportList>(PATH);
  return (
    <Section
      title="Bug reports"
      description={state.data
        ? `From the Report a bug button in the top bar. ${state.data.open} open · attachments use ${formatBytes(state.data.storedBytes)} of ${formatBytes(state.data.capBytes)}.`
        : "From the Report a bug button in the top bar."}
    >
      <Async state={state} empty={(d) => !d.reports.length && <EmptyState icon={Bug} title="No bug reports" description="Nobody has sent one yet." />}>
        {({ reports }) => <ul className="space-y-3">{reports.map((r) => <ReportCard key={r.id} r={r} />)}</ul>}
      </Async>
    </Section>
  );
}
