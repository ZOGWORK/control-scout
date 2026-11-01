// Owner portal › Usage › Real-user speed: web vitals (server/vitals.ts) at the 75th percentile, all pages
// together and then per page, each value coloured by Google's thresholds (green good, amber needs improvement,
// red poor). The tooltip on each value says how many loads it rests on and the shares of good and poor ones.
import { Gauge } from "lucide-react";
import { EmptyState } from "../page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/basic";
import { cn } from "../cn";
import { int, pct } from "../../lib/format";
import { rateVital, VITALS, type VitalName, type VitalStat, type VitalsRow } from "../../shared/vitals";

const TONE = { good: "text-success", ni: "text-warning", poor: "text-danger" } as const;

export function fmtVital(name: VitalName, v: number): string {
  if (name === "CLS") return v < 0.01 && v > 0 ? "<0.01" : v.toFixed(2);
  return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`;
}

function Value({ name, s }: { name: VitalName; s: VitalStat | undefined }) {
  if (!s?.n || s.p75 == null) return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  return (
    <TableCell className={cn("text-right tabular-nums", TONE[rateVital(name, s.p75)])}
      title={`${int(s.n)} loads · ${pct(s.good, 0)} good · ${pct(s.poor, 0)} poor`}>
      {fmtVital(name, s.p75)}
    </TableCell>
  );
}

const loads = (r: VitalsRow) => Math.max(0, ...Object.values(r.metrics).map((s) => s?.n ?? 0));

export function VitalsTable({ all, pages }: { all: VitalsRow; pages: VitalsRow[] }) {
  if (!loads(all)) return <EmptyState icon={Gauge} title="No real-user measurements in this period yet." description="They arrive when visitors who allowed usage statistics leave or hide a page." />;
  return (
    <div className="rounded-xl border border-border bg-card">
      <Table className="[&_td]:whitespace-nowrap">
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead className="text-right">Loads</TableHead>
            {VITALS.map((v) => <TableHead key={v} className="text-right">{v}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[all, ...pages].map((r, i) => (
            <TableRow key={r.path} className={cn(i === 0 && "font-medium")}>
              <TableCell className={cn("max-w-[16rem] truncate", i > 0 && "font-mono text-xs")} title={r.path}>{i === 0 ? "All pages" : r.path}</TableCell>
              <TableCell className="text-right tabular-nums">{int(loads(r))}</TableCell>
              {VITALS.map((v) => <Value key={v} name={v} s={r.metrics[v]} />)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
