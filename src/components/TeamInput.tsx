// Team number field that confirms the team's name as you type.
import { useEffect, useState } from "react";
import { Input } from "./ui/basic";
import { apiFetch } from "../lib/api";
import type { SearchHit } from "../shared/api";
import { cn } from "./cn";

const nameCache = new Map<number, string | null>();

export function useTeamName(n: number | null): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(n ? nameCache.get(n) : undefined);
  useEffect(() => {
    if (!n) { setName(undefined); return; }
    if (nameCache.has(n)) { setName(nameCache.get(n)); return; }
    let live = true;
    const t = setTimeout(() => {
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${n}&limit=3`).then((r) => {
        const hit = r.hits.find((h) => h.kind === "team" && h.ref === String(n));
        const v = hit ? hit.title.replace(/^\d+\s*/, "") || "" : null;
        nameCache.set(n, v);
        if (live) setName(v);
      }).catch(() => { if (live) setName(undefined); });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [n]);
  return name;
}

export function TeamInput({ value, onChange, label, tone, autoFocus }: { value: string; onChange: (v: string) => void; label: string; tone?: "red" | "blue"; autoFocus?: boolean }) {
  const n = /^\d{1,6}$/.test(value) ? Number(value) : null;
  const name = useTeamName(n);
  return (
    <div className="min-w-0">
      <Input value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="Team #" aria-label={label} autoFocus={autoFocus}
        className={cn("h-11 font-mono text-base", tone === "red" && "focus-visible:border-red-alliance", tone === "blue" && "focus-visible:border-blue-alliance", n && name === null && "border-warning")} />
      <p className={cn("mt-1 h-4 truncate text-xs", name === null ? "text-warning" : "text-muted-foreground")}>{n ? (name === undefined ? "…" : name === null ? "Not a team we know" : name || "Unnamed team") : ""}</p>
    </div>
  );
}
