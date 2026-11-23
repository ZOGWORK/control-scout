// Owner console › Bug reports: what people sent with the top bar's "Report a bug" button (server/bugReports.ts), newest
// first, open ones and closed ones apart (50 at a time, then Load older), each with its screenshots (click for full
// size) and video, the details the dialog attached, its GitHub issue (one click to open it) or why it isn't filed yet,
// and Close / Reopen / Delete. A filed report follows its issue: once the issue is closed on GitHub the server closes
// the report too (server/bugReports.ts syncBugIssues), so it moves to Closed with "Fixed by PR #…" or "Not planned".
// Closing or deleting here never touches the issue. Attachments load from /api/owner/bug-reports/:id/files/:n (behind the owner gate) while the local copy is
// kept; once it's on GitHub and the copy is deleted, they link to GitHub.
import { useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, CircleDashed, ExternalLink, Github, Mail, RotateCcw, Trash2 } from "lucide-react";
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
      {r.files.map((f) => {
        const what = `${f.type.startsWith("video/") ? "Video" : "Screenshot"} ${f.n + 1}, ${formatBytes(f.bytes)}`;
        // On GitHub only (the local copy was deleted): a link, since the page's own policy doesn't load GitHub media.
        if (!f.url) {
          return f.githubUrl ? (
            <a key={f.n} href={f.githubUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-accent-text v8:text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60">
              <Github className="size-3.5" aria-hidden />{what} on GitHub<ExternalLink className="size-3" aria-hidden />
            </a>
          ) : <span key={f.n} className="self-center text-xs text-muted-foreground">{what}: no copy left</span>;
        }
        const media = f.type.startsWith("video/")
          ? <video src={f.url} controls preload="metadata" className="max-h-56 max-w-full rounded-lg border border-border bg-black" aria-label={what} />
          : (
            <a href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/60" title={`${what}: open full size`}>
              <img src={f.url} alt={`Screenshot ${f.n + 1} of report #${r.id}`} loading="lazy" className="h-28 w-40 object-cover object-top" />
            </a>
          );
        return (
          <figure key={f.n} className="flex flex-col gap-1">
            {media}
            {f.uploadError && !f.githubUrl && <figcaption className="max-w-40 text-[11px] text-warning">Didn't upload to GitHub: {f.uploadError}</figcaption>}
          </figure>
        );
      })}
      {r.missing > 0 && <span className="self-center text-xs text-muted-foreground">{r.missing} attachment{r.missing === 1 ? " was" : "s were"} never uploaded</span>}
    </div>
  );
}

const LINK = "inline-flex min-h-8 items-center gap-1.5 font-medium text-accent-text v8:text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:min-h-11";

/** Its GitHub issue, one click away, and how it was closed there (the PR or commit that fixed it); or "Not filed yet" and why. */
function Issue({ r }: { r: BugReportItem }) {
  if (r.issue) {
    const c = r.issueClosed;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <a href={r.issue.url} target="_blank" rel="noopener noreferrer" data-testid="bug-report-issue" className={LINK}>
          <Github className="size-3.5" aria-hidden />Issue #{r.issue.number}<ExternalLink className="size-3" aria-hidden />
        </a>
        {c && (
          <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="bug-report-issue-closed">
            {c.reason === "completed" ? "Fixed" : "Closed as not planned"}
            {c.by && <>by <a href={c.by.url} target="_blank" rel="noopener noreferrer" className={LINK}>{c.by.label}<ExternalLink className="size-3" aria-hidden /></a></>}
            {c.at && <span>· {ago(c.at)}</span>}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="bug-report-not-filed">
      <CircleDashed className="size-3.5" aria-hidden />{r.notFiled?.startsWith("Private:") ? r.notFiled : `Not filed yet${r.notFiled ? `: ${r.notFiled}` : ""}`}
    </span>
  );
}

function ReportCard({ r, onChanged }: { r: BugReportItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (what: "close" | "reopen" | "delete") => {
    if (what === "delete" && !window.confirm(`Delete bug report #${r.id} and its attachments here? This can't be undone.${r.issue ? ` Its GitHub issue #${r.issue.number} stays.` : ""}`)) return;
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
        {r.status === "done" && (r.issueClosed?.reason === "not_planned"
          ? <Badge variant="secondary">Not planned</Badge>
          : <Badge variant="success">{r.issueClosed ? "Fixed" : "Closed"}</Badge>)}
        <span className="text-muted-foreground">#{r.id} · {ago(r.createdAt)}</span>
        {r.email && <a className="inline-flex min-w-0 items-center gap-1 truncate text-accent-text v8:text-accent underline-offset-4 hover:underline" href={`mailto:${r.email}`}><Mail className="size-3.5 shrink-0" aria-hidden />{r.email}</a>}
      </div>
      <div className="mt-2 text-sm"><Issue r={r} /></div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{r.message}</p>
      <Attachments r={r} />
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Page</dt><dd className="min-w-0 break-all font-mono text-foreground">{c.page && isSitePath(c.page) ? <a className="hover:underline" href={c.page}>{c.page}</a> : c.page || "—"}</dd>
        <dt>Version</dt><dd className="text-foreground">{c.release || "—"}</dd>
        <dt>Screen</dt><dd className="text-foreground">{c.viewport || "—"}</dd>
        <dt>Device</dt><dd className="min-w-0 break-words text-foreground">{c.device || "—"}</dd>
        <dt>Theme</dt><dd className="text-foreground">{c.theme || "—"}</dd>
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
  // Which view an older page was asked for: an answer for another tab (or an earlier first page) is dropped.
  const view = useRef(0);
  useEffect(() => { view.current++; setOlder([]); setOlderMore(null); setLoading(false); }, [status, state.data]);
  const d = state.data;
  const more = olderMore ?? d?.more ?? false;
  const loadOlder = async () => {
    const last = older.at(-1)?.id ?? d?.reports.at(-1)?.id;
    if (!last) return;
    const asked = view.current;
    setLoading(true);
    try {
      const page = await apiFetch<BugReportList>(`${PATH}?status=${status}&before=${last}`);
      if (asked !== view.current) return;
      setOlder((o) => [...o, ...page.reports]);
      setOlderMore(page.more);
    } catch (e) { if (asked === view.current) toast.error((e as ApiError).message); } finally { if (asked === view.current) setLoading(false); }
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
      description={`From the Report a bug button in the top bar. A report closes here when its GitHub issue is closed.${
        d && d.storedBytes >= d.capBytes * 0.75 ? ` Attachments use ${formatBytes(d.storedBytes)} of ${formatBytes(d.capBytes)}: delete old reports to make room.` : ""}`}
    >
      <div role="tablist" aria-label="Which reports" className="mb-3 flex gap-1">{tab("open", "Open", d?.open)}{tab("done", "Closed", d?.closed)}</div>
      <Async state={state} empty={(x) => !x.reports.length && <EmptyState icon={Bug} title={status === "open" ? "No open bug reports" : "No closed bug reports"} description={status === "open" ? "Nothing waiting on you." : "Reports whose issue was fixed, or that you closed, show here."} />}>
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
