// Owner console › Moderation: abuse signals as counts per day and coarse network range (server/moderation.ts:
// IPv4 /16, IPv6 /32, never a full address or anything about a person), and the triage queue of contact-form
// bug reports, data corrections and ideas (the same messages as the feedback inbox, not a second inbox).
import { useState } from "react";
import { Bot, ClipboardCheck, Network, ShieldAlert, Zap } from "lucide-react";
import { Section, EmptyState } from "../page";
import { StatTile } from "../StatTile";
import { Async } from "../states";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { useApi } from "../../lib/api";
import { int } from "../../lib/format";
import type { AbuseKind, OwnerModeration } from "../../shared/owner";
import { MessageCard, TriageActions } from "./FeedbackPanel";

const KINDS: { kind: AbuseKind; label: string; cls: string }[] = [
  { kind: "rate_limited", label: "Rate-limited (429)", cls: "bg-danger" },
  { kind: "bot_ua", label: "Scraper user agents", cls: "bg-violet-500" },
  { kind: "burst", label: "Request bursts", cls: "bg-warning" },
];

function DailySignals({ daily }: { daily: OwnerModeration["abuse"]["daily"] }) {
  const total = (d: (typeof daily)[number]) => d.rate_limited + d.bot_ua + d.burst;
  const max = Math.max(1, ...daily.map(total));
  const every = Math.max(1, Math.ceil(daily.length / 5));
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex h-36 items-end gap-1" role="img"
        aria-label={`Abuse signals per day: ${daily.map((d) => `${d.day} ${total(d)}`).join(", ")}`}>
        {daily.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${int(d.rate_limited)} rate-limited · ${int(d.bot_ua)} scraper agents · ${int(d.burst)} bursts`}>
            {KINDS.map((k) => d[k.kind] > 0 && (
              <span key={k.kind} className={cn("block w-full first:rounded-t-[3px]", k.cls)} style={{ height: `${(d[k.kind] / max) * 100}%`, minHeight: 2 }} />
            ))}
            {total(d) === 0 && <span className="block h-0.5 w-full rounded bg-muted" />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[11px] text-muted-foreground" aria-hidden>
        {daily.map((d, i) => <span key={d.day} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % every === 0 ? d.day.slice(5) : ""}</span>)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {KINDS.map((k) => <span key={k.kind} className="inline-flex items-center gap-1.5"><span className={cn("size-2.5 rounded-[3px]", k.cls)} aria-hidden />{k.label}</span>)}
      </div>
    </div>
  );
}

export function ModerationPanel({ onOpenResync }: { onOpenResync?: () => void }) {
  const [days, setDays] = useState(14);
  const [queue, setQueue] = useState<"untriaged" | "accepted">("untriaged");
  const state = useApi<OwnerModeration>(`/api/owner/moderation?days=${days}&triage=${queue}`);
  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-1" role="group" aria-label="Period">
        {[7, 14, 30].map((d) => (
          <Button key={d} size="sm" variant={d === days ? "default" : "outline"} aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</Button>
        ))}
      </div>
      <Async state={state}>
        {({ abuse: a, triage: t }) => (
          <>
            <Section title="Abuse signals" description={`Counts per day and network range (IPv4 /16, IPv6 /32). No full address, user agent or account is kept, and days older than ${a.retentionDays} are dropped.`}>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile tone="amber" icon={ShieldAlert} label="Rate-limited" value={int(a.totals.rate_limited)} hint="Requests answered 429" />
                <StatTile tone="violet" icon={Bot} label="Scraper agents" value={int(a.totals.bot_ua)} hint="API calls from crawlers and scripts" />
                <StatTile tone="accent" icon={Zap} label="Bursts" value={int(a.totals.burst)} hint={`Minutes a range went over ${int(a.burstPerMinute)} requests`} />
                <StatTile tone="sky" icon={Network} label="Ranges flagged" value={int(a.ranges.length)} hint={a.ranges.length >= 25 ? "The top 25 are listed" : "In this period"} />
              </div>
              <div className="mt-4"><DailySignals daily={a.daily} /></div>
            </Section>
            <Section title="By network range" description="The ranges behind the most signals, bursts first. A range is many people: treat it as a pattern, not a person.">
              {a.ranges.length ? (
                <div className="rounded-xl border border-border bg-card">
                  <Table className="[&_td]:whitespace-nowrap">
                    <TableHeader><TableRow><TableHead>Range</TableHead><TableHead className="text-right">429s</TableHead><TableHead className="text-right">Scraper agents</TableHead><TableHead className="text-right">Bursts</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {a.ranges.map((r) => (
                        <TableRow key={r.range}>
                          <TableCell className="font-mono text-xs">{r.range}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.rate_limited > 0 && "text-danger")}>{int(r.rate_limited)}</TableCell>
                          <TableCell className="text-right tabular-nums">{int(r.bot_ua)}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", r.burst > 0 && "text-warning")}>{int(r.burst)}</TableCell>
                          <TableCell className="text-right tabular-nums">{int(r.days)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <EmptyState icon={ShieldAlert} title="All quiet" description="No request was rate-limited or looked automated in this period." />}
            </Section>
            <Section title="Triage queue" description="Bug reports, data corrections and ideas from the contact form, newest first: not triaged yet, or accepted and waiting for a fix. A data correction is fixed by a re-sync from FIRST, never by editing a match.">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
                  {(["untriaged", "accepted"] as const).map((k) => (
                    <Button key={k} size="sm" variant={k === queue ? "default" : "outline"} aria-pressed={k === queue} onClick={() => setQueue(k)}>
                      {k === "untriaged" ? "Not triaged" : "Accepted"}<span className="tabular-nums opacity-70">{int(t.counts[k])}</span>
                    </Button>
                  ))}
                </div>
                <Badge variant="success">{int(t.counts.fixed)} fixed</Badge>
                <Badge variant="secondary">{int(t.counts.rejected)} rejected</Badge>
              </div>
              {t.messages.length ? (
                <ul className="space-y-3">
                  {t.messages.map((m) => (
                    <MessageCard key={m.id} m={m}><div className="mt-3"><TriageActions m={m} onOpenResync={onOpenResync} /></div></MessageCard>
                  ))}
                </ul>
              ) : t.state === "accepted"
                ? <EmptyState icon={ClipboardCheck} title="Nothing waiting for a fix" description="Every accepted report has been marked fixed." />
                : <EmptyState icon={ClipboardCheck} title="Nothing to triage" description="Every bug report, data correction and idea has been decided." />}
              {t.more && <p className="mt-3 text-xs text-muted-foreground">The newest {int(t.messages.length)} are shown; the older ones are in the feedback inbox.</p>}
            </Section>
          </>
        )}
      </Async>
    </>
  );
}
