// Official result changes (server/data/resultChanges.ts): results first
// posted, posted scores revised, scheduled matches moved, as the sync saw
// them. Self-contained: fetches its own route, for the event's Matches tab
// (every match, each linking to itself) or one match's details.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, History } from "lucide-react";
import type { ResultChange, ResultChangesView, ResultScoreSide, ResultSnapshot, ScheduleSnapshot } from "../shared/api";
import { useApi } from "../lib/api";
import { matchTime } from "../lib/format";
import { Badge } from "./ui/basic";
import { Button } from "./ui/button";
import { Async } from "./states";
import { cn } from "./cn";

/** Event view: this many first, the rest behind "Show all". */
const FIRST_SHOWN = 8;

const SOURCE: Record<string, string> = { first: "FIRST Events API", "ftc-scout": "FTC Scout (fallback)" };
const KIND: Record<ResultChange["kind"], { label: string; variant: "success" | "info" | "secondary" }> = {
  posted: { label: "Result posted", variant: "success" },
  revised: { label: "Score revised", variant: "info" },
  schedule: { label: "Schedule changed", variant: "secondary" },
};

/** "Nov 7, 3:05 PM" in the viewer's zone (when the sync saw it). */
const seenAt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function ResultChanges({ season, code, matchKey }: { season: number; code: string; matchKey?: string }) {
  const base = `/api/events/${season}/${encodeURIComponent(code)}`;
  const state = useApi<ResultChangesView>(matchKey ? `${base}/matches/${matchKey}/result-changes` : `${base}/result-changes`);
  const headingId = useId();
  const one = !!matchKey;
  return (
    <section aria-labelledby={headingId} className={cn(one ? "rounded-xl border border-border bg-card p-4" : "mt-10")}>
      <h2 id={headingId} className={cn("flex items-center gap-2 font-display font-semibold text-foreground", one ? "text-sm" : "text-lg")}>
        <History className="size-4 text-text-muted" aria-hidden /> Result changes
      </h2>
      <Async state={state} loading={<div className="skeleton mt-3 h-16 rounded-xl" />}>
        {(v) => <Body v={v} one={one} />}
      </Async>
    </section>
  );
}

function Body({ v, one }: { v: ResultChangesView; one: boolean }) {
  const [all, setAll] = useState(false);
  const shown = one || all ? v.changes : v.changes.slice(0, FIRST_SHOWN);
  const since = v.trackedSince
    ? <>Tracked since {day(v.trackedSince)}; not tracked before then.</>
    : <>Not tracked yet: changes are recorded from this event's next results check.</>;
  return (
    <>
      <p className="mt-1 text-xs text-text-muted">
        {one ? "Official results and schedule for this match" : "When an official result is first posted, corrected, or a match is rescheduled"}, as Control Scout's sync saw them. {since}
      </p>
      {!v.changes.length ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-text-muted">No changes recorded{v.trackedSince ? ` since ${day(v.trackedSince)}` : ""}.</p>
      ) : (
        <ol className={cn("mt-3 divide-y divide-border", !one && "rounded-xl border border-border bg-card")}>
          {shown.map((c) => <Item key={c.id} c={c} v={v} one={one} />)}
        </ol>
      )}
      {!one && v.changes.length > FIRST_SHOWN && (
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setAll((x) => !x)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${v.changes.length} changes`}
        </Button>
      )}
      {v.pruned > 0 && <p className="mt-2 text-xs text-text-muted">The newest {v.cap} changes per event are kept; {v.pruned} older {v.pruned === 1 ? "one was" : "ones were"} dropped.</p>}
    </>
  );
}

function Item({ c, v, one }: { c: ResultChange; v: ResultChangesView; one: boolean }) {
  const href = `/events/${v.season}/${encodeURIComponent(v.code)}?tab=matches&match=${encodeURIComponent(c.match.key)}`;
  const k = KIND[c.kind];
  return (
    <li className={cn("py-3", !one && "px-4")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {one ? <span className="text-sm font-semibold">{c.match.label}</span>
          : <Link to={href} className="text-sm font-semibold text-accent-text underline-offset-2 hover:underline" aria-label={`Match ${c.match.label}`}>{c.match.label}</Link>}
        <Badge variant={k.variant}>{k.label}</Badge>
        <span className="text-xs text-text-muted">
          Seen <time dateTime={c.checkedAt}>{seenAt(c.checkedAt)}</time> · {SOURCE[c.source] ?? c.source}
          {c.prevSource && c.prevSource !== c.source ? <> (was {SOURCE[c.prevSource] ?? c.prevSource})</> : null}
        </span>
      </div>
      <Values c={c} labels={v.labels} />
    </li>
  );
}

const score = (s: ResultSnapshot) => (
  <span className="tabular-nums"><span className="text-red-alliance">{s.red.total ?? "—"}</span> – <span className="text-blue-alliance">{s.blue.total ?? "—"}</span></span>
);

function Values({ c, labels }: { c: ResultChange; labels: Record<string, string> }) {
  if (c.kind === "posted") return <p className="mt-1.5 text-sm">Red–blue {score(c.after)}</p>;
  if (c.kind === "revised" && !c.after) return <p className="mt-1.5 text-sm">Result withdrawn (was {score(c.before)})</p>;
  const rows = c.kind === "revised"
    ? c.fields.map((f) => ({ f, ...resultValue(f, c.before, c.after!) }))
    : c.fields.map((f) => ({ f, ...scheduleValue(f, c.before, c.after) }));
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.f} className="contents">
          <dt className={cn("text-text-muted", r.f.startsWith("red") && "text-red-alliance", r.f.startsWith("blue") && "text-blue-alliance")}>{label(r.f, labels)}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 tabular-nums">
            <span className="text-text-muted line-through decoration-text-muted/60">{r.old}</span>
            <ArrowRight className="size-3.5 shrink-0 text-text-muted" aria-hidden /><span className="sr-only">changed to</span>
            <span className="font-medium">{r.new}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "Red total", "Blue Goal RP", "Disqualified teams", "Field". */
function label(f: string, labels: Record<string, string>): string {
  const [side, ...rest] = f.split(".");
  if (side === "red" || side === "blue") {
    const name = rest.length ? labels[rest.join(".")] ?? rest.join(".") : labels[side];
    if (!rest.length) return name;
    // Sentence case after the side, except names that keep their capitals (TeleOp, HIVE TIPs, bonus RPs).
    const keep = /^(TeleOp|HIVE)|\bRP$/.test(name);
    return `${side === "red" ? "Red" : "Blue"} ${keep ? name : name.charAt(0).toLowerCase() + name.slice(1)}`;
  }
  return labels[f] ?? f;
}

const shown = (x: unknown) => (x == null ? "—" : typeof x === "boolean" ? (x ? "earned" : "not earned") : String(x));

function resultValue(f: string, a: ResultSnapshot, b: ResultSnapshot): { old: string; new: string } {
  if (f === "dq") return { old: a.dq.join(", ") || "none", new: b.dq.join(", ") || "none" };
  const [side, comp, sub] = f.split(".") as ["red" | "blue", keyof ResultScoreSide, string | undefined];
  const pick = (s: ResultSnapshot) => (sub ? (s[side].bonus as Record<string, boolean> | null)?.[sub] : s[side][comp]);
  return { old: shown(pick(a)), new: shown(pick(b)) };
}

function scheduleValue(f: string, a: ScheduleSnapshot, b: ScheduleSnapshot): { old: string; new: string } {
  if (f === "time") return { old: matchTime(a.time) || "—", new: matchTime(b.time) || "—" };
  if (f === "field") return { old: a.field ?? "—", new: b.field ?? "—" };
  const side = f as "red" | "blue";
  return { old: a[side].join(", ") || "—", new: b[side].join(", ") || "—" };
}
