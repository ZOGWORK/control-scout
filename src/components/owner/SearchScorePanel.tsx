// Owner portal › Server & speed › Search speed and score (server/searchScore.ts, the search audit's M6 + M7): time to
// answer on the results page at the median and 95th percentile, phone and desktop, then a weekly score: how searches
// ended (answered, Sorry, failed), follow-up taps and re-searches within 30 s. From a sample of the page loads of
// visitors who allowed usage statistics; the counts are that sample's, the rates stand for all of them.
import { Monitor, Search, Smartphone } from "lucide-react";
import { EmptyState, Section } from "../page";
import { StatTile, type Tone } from "../StatTile";
import { Async } from "../states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { cn } from "../cn";
import { useApi } from "../../lib/api";
import { int, pct } from "../../lib/format";
import type { AnswerSpeed, SearchScore, SearchWeek } from "../../shared/searchScore";

export const fmtMs = (x: number | null | undefined) => (x == null ? "—" : x < 999.5 ? `${Math.round(x)} ms` : `${(x / 1000).toFixed(1)} s`);

/** A 95th percentile's tone: within a second is good, past three seconds is slow. */
export function speedTone(p95: number | null): Tone {
  return p95 == null ? "neutral" : p95 <= 1000 ? "emerald" : p95 <= 3000 ? "amber" : "rose";
}

function SpeedTile({ label, icon, s }: { label: string; icon: typeof Monitor; s: AnswerSpeed }) {
  return (
    <StatTile tone={speedTone(s.p95)} icon={icon} label={label} value={fmtMs(s.p50)}
      hint={s.n ? `Median · 95th % ${fmtMs(s.p95)} · ${int(s.n)} timed` : "No timed searches yet"} />
  );
}

const Rate = ({ v, warn, good }: { v: number | null; warn?: boolean; good?: boolean }) => (
  <TableCell className={cn("text-right tabular-nums", v == null ? "text-muted-foreground" : warn ? "text-warning" : good ? "text-success v8:text-emerald-400" : undefined)}>{pct(v, 0)}</TableCell>
);

function WeekTable({ weeks }: { weeks: SearchWeek[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card" data-search-weeks>
      <Table className="[&_td]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead className="text-right">Searches</TableHead>
            <TableHead className="text-right" title="Answered: a direct answer, results, or straight on to the page the words name">Answered</TableHead>
            <TableHead className="text-right" title="A card or stat answer">Direct</TableHead>
            <TableHead className="text-right">Sorry</TableHead>
            <TableHead className="text-right" title="The search request failed">Failed</TableHead>
            <TableHead className="text-right" title="Searches started from a Related searches or People also ask tap">Follow-up taps</TableHead>
            <TableHead className="text-right" title="Typed searches run again with other words within 30 s of an answer">Re-search</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeks.map((w) => (
            <TableRow key={w.week}>
              <TableCell title={`From ${w.from} (UTC)`}>{w.week.replace("-W", " · week ")}</TableCell>
              <TableCell className="text-right tabular-nums">{int(w.searches)}</TableCell>
              <Rate v={w.answered} good={w.answered != null && w.answered >= 0.9} />
              <Rate v={w.direct} />
              <Rate v={w.sorry} warn={w.sorry != null && w.sorry > 0.1} />
              <Rate v={w.failed} warn={w.failed != null && w.failed > 0.01} />
              <Rate v={w.related} />
              <Rate v={w.reSearch} warn={w.reSearch != null && w.reSearch > 0.2} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SearchScoreView({ s }: { s: SearchScore }) {
  const sampled = `1 in ${Math.round(1 / s.sample)}`;
  return (
    <div className="space-y-4" data-search-score>
      <div className="grid grid-cols-2 gap-3">
        <SpeedTile label="Phone" icon={Smartphone} s={s.speed.phone} />
        <SpeedTile label="Desktop" icon={Monitor} s={s.speed.desktop} />
      </div>
      <p className="text-xs text-muted-foreground">
        Opened on /search (includes loading the app): {fmtMs(s.speed.load.p50)} median, {fmtMs(s.speed.load.p95)} 95th %.
        {" "}Searched inside the app: {fmtMs(s.speed.app.p50)} median, {fmtMs(s.speed.app.p95)} 95th %. Tablets count as desktop.
      </p>
      {s.weeks.length
        ? <WeekTable weeks={s.weeks} />
        : <EmptyState icon={Search} title="No searches counted yet." description="They arrive as sampled visitors who allowed usage statistics search." />}
      <p className="text-xs text-muted-foreground">
        ISO weeks, UTC. Searches counts {sampled} page loads of visitors who allowed usage statistics; the rates stand for all of them.
        No query, address, account or ID is stored. Test traffic, bots and automated browsers aren't counted.
      </p>
    </div>
  );
}

export function SearchScorePanel({ days }: { days: number }) {
  const state = useApi<SearchScore>(`/api/owner/search-score?days=${days}`);
  return (
    <Section title="Search speed and score"
      description={`Time to answer on the results page, from the search starting to its answer drawn, over the last ${days} days; then how searches ended each week.`}>
      <Async state={state}>{(d) => <SearchScoreView s={d} />}</Async>
    </Section>
  );
}
