// Owner console › Bug reports: what people sent with the top bar's "Report a bug" button (server/bugReports.ts), newest
// first, open ones and closed ones apart (50 at a time, then Load older), each with its screenshots (click for full
// size) and video, the details the dialog attached, and Close / Reopen / Delete. Attachments load from
// /api/owner/bug-reports/:id/files/:n, behind the owner gate.
import { useEffect, useState } from "react";
import { Bug, CheckCircle2, Mail, RotateCcw, Trash2 } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { BUG_CATEGORIES, formatBytes, isSitePath, type BugReportItem, type BugReportList } from "../../shared/bugReport";

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

function ReportCard({ r, onChanged }: { r: BugReportItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (what: "close" | "reopen" | "delete") => {
    if (what === "delete" && !window.confirm(`Delete bug report #${r.id} and its attachments? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (what === "delete") await apiFetch(`${PATH}/${r.id}`, { method: "DELETE", json: {} });
      else await apiFetch(`${PATH}/${r.id}`, { method: "PATCH", json: { status: what === "close" ? "done" : "open" } });
      markStale(PATH);
      onChanged();
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
        <dt>Page</dt><dd className="min-w-0 break-all font-mono text-foreground">{c.page && isSitePath(c.page) ? <a className="hover:underline" href={c.page}>{c.page}</a> : c.page || "—"}</dd>
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

type Status = "open" | "done";

export function BugReportsPanel() {
  const [status, setStatus] = useState<Status>("open");
  const state = useApi<BugReportList>(`${PATH}?status=${status}`);
  // Older pages, loaded on request and kept below the first (cleared when the tab or the first page changes).
  const [older, setOlder] = useState<BugReportItem[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setOlder([]); setOlderMore(null); }, [status, state.data]);
  const d = state.data;
  const more = olderMore ?? d?.more ?? false;
  const loadOlder = async () => {
    const last = older.at(-1)?.id ?? d?.reports.at(-1)?.id;
    if (!last) return;
    setLoading(true);
    try {
      const page = await apiFetch<BugReportList>(`${PATH}?status=${status}&before=${last}`);
      setOlder((o) => [...o, ...page.reports]);
      setOlderMore(page.more);
    } catch (e) { toast.error((e as ApiError).message); } finally { setLoading(false); }
  };
  const tab = (s: Status, label: string, n?: number) => (
    <button key={s} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
      className={`h-9 rounded-lg px-3 text-sm font-medium transition-colors max-sm:h-10 ${status === s ? "bg-accent-soft text-foreground" : "text-text-muted hover:text-foreground"}`}>
      {label}{n != null && <span className="ml-1.5 tabular-nums text-text-muted">{n}</span>}
    </button>
  );
  return (
    <Section
      title="Bug reports"
      description={d
        ? `From the Report a bug button in the top bar. Attachments use ${formatBytes(d.storedBytes)} of ${formatBytes(d.capBytes)}.`
        : "From the Report a bug button in the top bar."}
    >
      <div role="tablist" aria-label="Which reports" className="mb-3 flex gap-1">{tab("open", "Open", d?.open)}{tab("done", "Closed", d?.closed)}</div>
      <Async state={state} empty={(x) => !x.reports.length && <EmptyState icon={Bug} title={status === "open" ? "No open bug reports" : "No closed bug reports"} description={status === "open" ? "Nothing waiting on you." : "Closed reports show here."} />}>
        {({ reports }) => (
          <>
            <ul className="space-y-3">{[...reports, ...older].map((r) => <ReportCard key={r.id} r={r} onChanged={() => setOlder((o) => o.filter((x) => x.id !== r.id))} />)}</ul>
            {more && <Button variant="outline" className="mt-3 max-sm:h-10" disabled={loading} onClick={() => void loadOlder()}>{loading ? "Loading…" : "Load older"}</Button>}
          </>
        )}
      </Async>
    </Section>
  );
}
