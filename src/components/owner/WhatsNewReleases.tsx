// The owner console's view of What's new (loaded with its panel, not the console): every release in
// CHANGELOG.md with its date, highlights and PRs, what the newest one still needs, and the visitor's view.
import { lazy, Suspense } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import md from "../../../CHANGELOG.md?raw";
import { releasePrs, releaseProblems, parseChangelog } from "../../lib/changelog";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { LoadingBlock } from "../states";
import { cn } from "../cn";

const WhatsNewContent = lazy(() => import("../WhatsNewContent"));
const REPO = "https://github.com/ZOGWORK/control-scout/pull/";
const RELEASES = parseChangelog(md);

export default function WhatsNewReleases({ live }: { live: string | null }) {
  const newest = RELEASES[0];
  const problems = newest ? releaseProblems(newest) : [];
  return (
    <div className="grid gap-4">
      {newest && (
        <div className={cn("flex items-start gap-3 rounded-xl border p-3 text-sm", problems.length ? "border-warning/40 bg-warning/[0.06]" : "border-success/40 bg-success/[0.06]")}>
          {problems.length ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />}
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              Newest entry <span className="font-mono">v{newest.version}</span>{live && live !== newest.version ? <> · this server runs <span className="font-mono">v{live}</span></> : null}
            </p>
            <p className="text-muted-foreground">{problems.length ? `Before it ships: ${problems.join("; ")}.` : "Ready: a summary, 3 to 5 tagged highlights and its PR."}</p>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Release</TableHead><TableHead className="max-sm:hidden">Date</TableHead><TableHead>Highlights</TableHead><TableHead className="text-right">PR</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {RELEASES.slice(0, 12).map((e) => {
              const prs = releasePrs(e);
              return (
                <TableRow key={e.version}>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    v{e.version}{e.version === live && <Badge variant="success" className="ml-1.5 font-sans">Live</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground max-sm:hidden">{e.date}</TableCell>
                  <TableCell className="min-w-0 text-sm">
                    {e.highlights.length ? <span className="line-clamp-2">{e.highlights.map((h) => h.text).join(" · ")}</span> : <span className="text-muted-foreground">Full notes only</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">
                    {prs.slice(-2).map((n) => <a key={n} href={`${REPO}${n}`} target="_blank" rel="noreferrer" className="ml-1 text-accent-text underline underline-offset-2">#{n}</a>)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <details className="rounded-xl border border-border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm text-muted-foreground hover:text-foreground">What visitors see</summary>
        <div className="overflow-hidden border-t border-border">
          <Suspense fallback={<LoadingBlock rows={4} label="Loading releases" />}><WhatsNewContent /></Suspense>
        </div>
      </details>
    </div>
  );
}
