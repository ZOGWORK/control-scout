// Inline search: a field with a results dropdown under it. The page behind it
// stays fully usable (no modal, no focus trap). Content only: teams, events
// and matches — navigation lives in the nav.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { CalendarDays, Loader2, Search, Swords, Users, X } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { useMeta } from "../../lib/meta";
import type { SearchHit } from "../../shared/api";
import { cn } from "../cn";

export type HitKind = SearchHit["kind"];

export function hitHref(h: SearchHit): string {
  if (h.kind === "team") return `/teams/${h.ref}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}`; }
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

/** Debounced search; my team, tracked and shortlisted teams/events rank first among equal matches. */
export function useSearchHits(q: string, kinds?: HitKind[]) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const { state } = usePersonal();
  const prefer = useMemo(() => [...new Set([
    ...(state.myTeam ? [`team:${state.myTeam}`] : []),
    ...state.tracked.teams.map((t) => `team:${t}`),
    ...state.bookmarks.map((t) => `team:${t}`),
    ...state.tracked.events.map((e) => `event:${e}`),
  ])].slice(0, 100).join(","), [state.myTeam, state.tracked, state.bookmarks]);
  const kindKey = kinds?.join(",") ?? "";
  useEffect(() => {
    const query = q.trim();
    const id = ++seq.current;
    if (!query) { setHits([]); setError(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(() => {
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=15${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`)
        .then((r) => { if (id === seq.current) { setHits(kindKey ? r.hits.filter((h) => kindKey.split(",").includes(h.kind)) : r.hits); setError(null); } })
        .catch((e) => { if (id === seq.current) setError(e.message); })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 140);
    return () => clearTimeout(t);
  }, [q, prefer, kindKey]);
  return { hits, busy, error };
}

const GROUPS: [HitKind, string, typeof Users][] = [["team", "Teams", Users], ["event", "Events", CalendarDays], ["match", "Matches", Swords]];

export interface SearchBoxProps {
  onPick: (h: SearchHit) => void;
  kinds?: HitKind[];
  placeholder: string;
  label: string;
  size?: "md" | "lg";
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Shown under the field while it's empty and focused (e.g. quick picks). */
  emptyHint?: ReactNode;
  autoFocus?: boolean;
}

export function SearchBox({ onPick, kinds, placeholder, label, size = "md", className, inputRef, emptyHint, autoFocus }: SearchBoxProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { hits, busy, error } = useSearchHits(q, kinds);
  const meta = useMeta();
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Group order matches what's shown, so arrow keys walk the list top to bottom.
  const ordered = useMemo(() => GROUPS.flatMap(([k]) => hits.filter((h) => h.kind === k)), [hits]);
  useEffect(() => setActive(0), [hits]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (h: SearchHit) => { onPick(h); setQ(""); setOpen(false); (document.activeElement as HTMLElement | null)?.blur?.(); };
  const query = q.trim();
  const showList = open && (query ? true : !!emptyHint);
  const lg = size === "lg";
  return (
    <div ref={box} className={cn("relative", className)}>
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-card text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", lg ? "h-14 px-4" : "h-9 px-3")}>
        {busy ? <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", lg ? "size-5" : "size-4")} /> : <Search className={cn("shrink-0 text-accent", lg ? "size-5" : "size-4")} />}
        <input
          ref={inputRef} value={q} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { if (q) setQ(""); else { setOpen(false); (e.target as HTMLInputElement).blur(); } return; }
            if (!ordered.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % ordered.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + ordered.length) % ordered.length); }
            else if (e.key === "Enter") { e.preventDefault(); pick(ordered[active]); }
          }}
          placeholder={placeholder} aria-label={label}
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && ordered[active] ? `${listId}-${active}` : undefined}
          className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground", lg ? "text-base" : "text-sm")}
        />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
      </div>
      {showList && (
        <div id={listId} role="listbox" aria-label={`${label} results`}
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(26rem,70vh)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
          {!query ? emptyHint : error ? <p className="px-3 py-2.5 text-sm text-destructive">{error}</p>
            : !ordered.length ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search." : <>Nothing matches “{query}”.</>}</p>
            ) : GROUPS.map(([kind, title, Icon]) => {
              const hs = ordered.filter((h) => h.kind === kind);
              if (!hs.length) return null;
              return (
                <div key={kind} role="group" aria-label={title}>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
                  {hs.map((h) => {
                    const i = ordered.indexOf(h);
                    return (
                      <div
                        key={`${h.kind}:${h.ref}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                        onPointerDown={(e) => e.preventDefault()} onClick={() => pick(h)} onPointerMove={() => setActive(i)}
                        className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm", i === active ? "bg-accent/[0.12] text-foreground" : "text-foreground/90")}
                      >
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{h.title}</span>
                        <span className="hidden max-w-[45%] truncate text-xs text-muted-foreground sm:inline">{h.subtitle}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
