// Team number field that confirms the team's name as you type, and shows the
// form's error for it (aria-invalid, described by the message) when it has one.
import { useEffect, useId, useState, type Ref } from "react";
import { Input } from "./ui/basic";
import { apiFetch } from "../lib/api";
import { offlineSource } from "../lib/offline/saved";
import type { SearchHit } from "../shared/api";
import { cn } from "./cn";

const nameCache = new Map<number, string | null>();

/** How long a form waits for the name check before letting the number through (a slow venue network must not block saving). */
const LOOKUP_DEADLINE_MS = 4000;

/**
 * The team's name ("" when it has none), null when the server says there's no such team, undefined when
 * we can't tell: the lookup failed, ran past `deadlineMs`, or was answered from seasons saved on this
 * device (a team missing from those may still exist). Only the server's answer is cached.
 */
export async function lookupTeamName(n: number, deadlineMs = LOOKUP_DEADLINE_MS): Promise<string | null | undefined> {
  if (nameCache.has(n)) return nameCache.get(n);
  const lookup = apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${n}&limit=3`).then((r) => {
    const hit = r.hits.find((h) => h.kind === "team" && h.ref === String(n));
    const v = hit ? hit.title.replace(/^\d+\s*/, "") || "" : null;
    if (offlineSource(r)) return v ?? undefined;
    nameCache.set(n, v);
    return v;
  }).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), deadlineMs); });
  try { return await Promise.race([lookup, deadline]); } finally { clearTimeout(timer); }
}

export function useTeamName(n: number | null): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(n ? nameCache.get(n) : undefined);
  useEffect(() => {
    if (!n) { setName(undefined); return; }
    if (nameCache.has(n)) { setName(nameCache.get(n)); return; }
    let live = true;
    // The hint isn't blocking a form, so it gives the request up to a minute.
    const t = setTimeout(() => { lookupTeamName(n, 60_000).then((v) => { if (live) setName(v); }); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [n]);
  return name;
}

export function TeamInput({ value, onChange, label, tone, autoFocus, error, inputRef, size }: {
  value: string; onChange: (v: string) => void; label: string; tone?: "red" | "blue"; autoFocus?: boolean;
  /** "lg": a single, prominent team box (the Lab's advancement team). */
  size?: "lg";
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
        className={cn(size === "lg" ? "h-14 font-mono text-2xl font-semibold" : "h-11 font-mono text-base", tone === "red" && "focus-visible:border-red-alliance", tone === "blue" && "focus-visible:border-blue-alliance", !error && n && name === null && "border-warning")} />
      {error
        ? <p id={hintId} role="alert" className="mt-1 text-xs font-medium text-destructive">{error}</p>
        : <p id={hintId} className={cn(size === "lg" ? "mt-1.5 h-5 truncate text-sm" : "mt-1 h-4 truncate text-xs", name === null ? "text-warning" : "text-muted-foreground")}>{n ? (name === undefined ? "…" : name === null ? "Not a team we know" : name || "Unnamed team") : ""}</p>}
    </div>
  );
}
