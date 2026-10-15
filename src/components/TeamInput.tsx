// Team number field that confirms the team's name as you type, and shows the
// form's error for it (aria-invalid, described by the message) when it has one.
import { useEffect, useId, useState, type Ref } from "react";
import { Input } from "./ui/basic";
import { apiFetch } from "../lib/api";
import type { SearchHit } from "../shared/api";
import { cn } from "./cn";

const nameCache = new Map<number, string | null>();

/** The team's name ("" when it has none), null when there's no such team, undefined when the lookup failed (offline). */
export async function lookupTeamName(n: number): Promise<string | null | undefined> {
  if (nameCache.has(n)) return nameCache.get(n);
  try {
    const r = await apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${n}&limit=3`);
    const hit = r.hits.find((h) => h.kind === "team" && h.ref === String(n));
    const v = hit ? hit.title.replace(/^\d+\s*/, "") || "" : null;
    nameCache.set(n, v);
    return v;
  } catch { return undefined; }
}

export function useTeamName(n: number | null): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(n ? nameCache.get(n) : undefined);
  useEffect(() => {
    if (!n) { setName(undefined); return; }
    if (nameCache.has(n)) { setName(nameCache.get(n)); return; }
    let live = true;
    const t = setTimeout(() => { lookupTeamName(n).then((v) => { if (live) setName(v); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [n]);
  return name;
}

export function TeamInput({ value, onChange, label, tone, autoFocus, error, inputRef }: {
  value: string; onChange: (v: string) => void; label: string; tone?: "red" | "blue"; autoFocus?: boolean;
  /** The form's error for this field (set on submit); shown in place of the name hint. */
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const n = /^\d{1,6}$/.test(value) ? Number(value) : null;
  const name = useTeamName(n);
  const hintId = useId();
  return (
    <div className="min-w-0">
      <Input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="Team #" aria-label={label} autoFocus={autoFocus}
        aria-invalid={error ? true : undefined} aria-describedby={hintId}
        className={cn("h-11 font-mono text-base", tone === "red" && "focus-visible:border-red-alliance", tone === "blue" && "focus-visible:border-blue-alliance", !error && n && name === null && "border-warning")} />
      {error
        ? <p id={hintId} role="alert" className="mt-1 text-xs font-medium text-destructive">{error}</p>
        : <p id={hintId} className={cn("mt-1 h-4 truncate text-xs", name === null ? "text-warning" : "text-muted-foreground")}>{n ? (name === undefined ? "…" : name === null ? "Not a team we know" : name || "Unnamed team") : ""}</p>}
    </div>
  );
}
