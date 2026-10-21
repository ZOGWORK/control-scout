// Sortable stat table with CSV export (dense, keyboard-friendly).
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "./cn";
import { downloadCsv } from "../lib/csv";

export interface Col<T> {
  key: string;
  label: string;
  /** Sort / export value. */
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Lower is better (sort ascending first). */
  asc?: boolean;
  className?: string;
  hideOnMobile?: boolean;
  title?: string;
}

export function SortTable<T>({ rows, cols, initial, csvName, rowKey, highlight, empty }: {
  rows: T[];
  cols: Col<T>[];
  initial?: { key: string; dir: "asc" | "desc" };
  csvName?: string;
  rowKey: (r: T) => string | number;
  highlight?: (r: T) => boolean;
  empty?: string;
}) {
  const [sort, setSort] = useState(initial ?? { key: cols[0].key, dir: "asc" as const });
  const sorted = useMemo(() => {
    const c = cols.find((x) => x.key === sort.key) ?? cols[0];
    const m = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = c.value(a), y = c.value(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // blanks last either way
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * m;
    });
  }, [rows, cols, sort]);
  const click = (c: Col<T>) => setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.asc || c.align !== "right" ? "asc" : "desc" }));
  if (!rows.length) return <p className="rounded-xl border border-dashed border-border px-4 py-8 max-sm:py-5 text-center text-sm text-muted-foreground">{empty ?? "Nothing here yet."}</p>;
  return (
    <div>
      {csvName && (
        <div className="mb-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => downloadCsv(csvName, sorted.map((r) => Object.fromEntries(cols.map((c) => [c.label, c.value(r)]))))}><Download /> CSV</Button>
        </div>
      )}
      <div className="custom-scrollbar overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {cols.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("h-10 whitespace-nowrap px-3 text-[10px] font-bold uppercase tracking-wider text-text-muted", c.align === "right" ? "text-right" : "text-left", c.hideOnMobile && "max-sm:hidden")}>
                  <button onClick={() => click(c)} title={c.title} className={cn("inline-flex items-center gap-1 rounded hover:text-text-base", c.align === "right" && "flex-row-reverse")}>
                    {c.label}{sort.key === c.key && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)} className={cn("border-b border-border last:border-b-0 hover:bg-text-base/[0.03]", highlight?.(r) && "bg-accent/[0.06]")}>
                {cols.map((c) => <td key={c.key} className={cn("density-row whitespace-nowrap px-3 py-2", c.align === "right" && "text-right tabular-nums", c.hideOnMobile && "max-sm:hidden", c.className)}>{c.render ? c.render(r) : (c.value(r) ?? "—")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
