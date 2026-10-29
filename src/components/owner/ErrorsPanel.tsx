// Owner console › Feedback & errors: crash reports people chose to send (server/errorReports.ts), each with
// its GitHub issue and that issue's state, and the owner's own note (console only, never sent to GitHub;
// every save is in the audit log with the note it replaced).
import { useId, useState } from "react";
import { Bug, ExternalLink, NotebookPen } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge, Textarea } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago } from "../../lib/format";

export interface ErrorReportRow {
  fingerprint: string; message: string; count: number; firstSeen: string; lastSeen: string;
  issueNumber: number | null; issueUrl: string | null; issueState: string | null;
  ownerNote: string | null; ownerNoteAt: string | null;
  sample: { route: string; appVersion: string; stack: string; userAgent: string };
}

const PATH = "/api/owner/errors?limit=100";
/** Matches the server's OWNER_NOTE_MAX. */
const NOTE_MAX = 2000;

const ISSUE: Record<string, { label: string; variant: "destructive" | "success" | "secondary" }> = {
  open: { label: "Open", variant: "destructive" },
  closed: { label: "Closed", variant: "success" },
  not_planned: { label: "Not planned", variant: "secondary" },
};

function IssueLink({ r }: { r: ErrorReportRow }) {
  if (!r.issueUrl) return <Badge variant="secondary" className="shrink-0">Not filed</Badge>;
  const s = ISSUE[r.issueState ?? ""] ?? { label: r.issueState ?? "Unknown", variant: "secondary" as const };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Badge variant={s.variant} aria-label={`GitHub issue ${s.label.toLowerCase()}`}>{s.label}</Badge>
      <Button size="sm" variant="outline" className="max-sm:h-10" asChild>
        <a href={r.issueUrl} target="_blank" rel="noreferrer noopener">Issue #{r.issueNumber} <ExternalLink /></a>
      </Button>
    </div>
  );
}

function OwnerNote({ r }: { r: ErrorReportRow }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(r.ownerNote ?? "");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const save = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/owner/errors/${r.fingerprint}/note`, { method: "PUT", json: { note: text } });
      markStale("/api/owner/errors");
      toast.success(text.trim() ? "Note saved" : "Note removed");
      setEditing(false);
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap items-start gap-2">
        {r.ownerNote
          ? <p className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-sm text-foreground">{r.ownerNote}<span className="mt-1 block text-xs text-muted-foreground">Your note · {ago(r.ownerNoteAt)}</span></p>
          : <span className="flex-1" />}
        <Button size="sm" variant="outline" className="max-sm:h-10" onClick={() => { setText(r.ownerNote ?? ""); setEditing(true); }}><NotebookPen /> {r.ownerNote ? "Edit note" : "Add note"}</Button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Your note (only you see it; not sent to GitHub)</label>
      <Textarea id={id} value={text} maxLength={NOTE_MAX} rows={3} onChange={(e) => setText(e.target.value)} placeholder="What you found, what's next…" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="max-sm:h-10" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save note"}</Button>
        <Button size="sm" variant="outline" className="max-sm:h-10" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function ErrorsPanel() {
  const state = useApi<{ reports: ErrorReportRow[] }>(PATH);
  return (
    <Section title="Error reports" description="Crashes people chose to report, grouped by what broke. Each is filed as a GitHub issue when the server has a token for it; its state here follows the issue.">
      <Async state={state} empty={(d) => !d.reports.length && <EmptyState icon={Bug} title="No error reports" description="Nobody has reported a crash." />}>
        {({ reports }) => (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={r.fingerprint} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-danger/15 font-display text-sm font-semibold tabular-nums text-danger" title={`${r.count} reports`}>{r.count > 99 ? "99+" : r.count}</span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="break-words font-mono text-sm text-foreground">{r.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.count} report{r.count === 1 ? "" : "s"} · last {ago(r.lastSeen)} · first {ago(r.firstSeen)} · on <span className="font-mono">{r.sample.route}</span> · v{r.sample.appVersion}
                    </p>
                  </div>
                  <IssueLink r={r} />
                </div>
                <OwnerNote key={r.ownerNoteAt ?? "none"} r={r} />
                {r.sample.stack && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Latest stack</summary>
                    <pre className="custom-scrollbar mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground">{r.sample.stack}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Async>
    </Section>
  );
}
