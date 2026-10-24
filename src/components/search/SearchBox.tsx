// Inline search: a field with a results dropdown under it. The page behind it
// stays fully usable (no modal, no focus trap). Content only: teams, events
// and matches — navigation lives in the nav.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { smoothBehavior } from "../../lib/pageScroll";
import { CalendarDays, ChevronDown, Loader2, MapPin, Search, Swords, Users, X } from "lucide-react";
import { m } from "../motion";
import { apiFetch } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { useMeta } from "../../lib/meta";
import type { SearchHit } from "../../shared/api";
import { cn } from "../cn";
import { seasonLabel } from "../../lib/format";

export type HitKind = SearchHit["kind"];

export function hitHref(h: SearchHit): string {
  if (h.kind === "team") return `/teams/${h.ref}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}`; }
  if (h.kind === "place") return `/events?region=${encodeURIComponent(h.ref)}`;
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

/** Debounced search; my team, tracked and shortlisted teams/events rank first among equal matches. */
export function useSearchHits(q: string, kinds?: HitKind[]) {
  // Results remember the query they answer, so a pick can never come from a previous query.
  const [res, setRes] = useState<{ q: string; hits: SearchHit[] }>({ q: "", hits: [] });
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
    if (!query) { setRes({ q: "", hits: [] }); setError(null); setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(() => {
      // A box limited to some kinds asks the server for only those, so other kinds (often teams) can't crowd its own out.
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=15${kindKey ? `&kinds=${encodeURIComponent(kindKey)}` : ""}${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`)
        .then((r) => { if (id === seq.current) { setRes({ q: query, hits: kindKey ? r.hits.filter((h) => kindKey.split(",").includes(h.kind)) : r.hits }); setError(null); } })
        .catch((e) => { if (id === seq.current) { setRes({ q: query, hits: [] }); setError(e.message); } }) // the query is answered (with an error): the spinner stops
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 140);
    return () => clearTimeout(t);
  }, [q, prefer, kindKey]);
  const current = res.q === q.trim();
  return { hits: current ? res.hits : [], busy: busy || (!!q.trim() && !current), error };
}

const GROUPS: [HitKind, string, typeof Users][] = [["place", "Places", MapPin], ["team", "Teams", Users], ["event", "Events", CalendarDays], ["match", "Matches", Swords]];

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
  /** Called whenever the box closes on its own (Escape on an empty field, focus leaving, a pick). */
  onClose?: () => void;
  /** Keyboard shortcut shown at the right while the field is empty (e.g. "⌘K"). */
  hint?: string;
  /** What the first-run tour calls this box (data-tour), e.g. "search". */
  tour?: string;
  /** Text to start with, its results already open (a search arriving in the URL). Read on mount only. */
  initialQuery?: string;
}

export function SearchBox({ onPick, kinds, placeholder, label, size = "md", className, inputRef, emptyHint, autoFocus, onClose, hint, tour, initialQuery }: SearchBoxProps) {
  const [q, setQ] = useState(initialQuery ?? "");
  const [open, setOpen] = useState(!!initialQuery);
  const [active, setActive] = useState(0);
  const { hits, busy, error } = useSearchHits(q, kinds);
  const meta = useMeta();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // How many results sit below the visible part of the dropdown (drives the "more below" cue).
  const [below, setBelow] = useState(0);
  const measure = () => {
    const el = list.current;
    if (!el) { setBelow(0); return; }
    const bottom = el.scrollTop + el.clientHeight;
    setBelow(el.scrollHeight - bottom > 6 ? [...el.querySelectorAll<HTMLElement>("[role=option]")].filter((o) => o.offsetTop + o.offsetHeight / 2 > bottom).length : 0);
  };
  const listId = useId();
  // Group order matches what's shown, so arrow keys walk the list top to bottom.
  const ordered = useMemo(() => GROUPS.flatMap(([k]) => hits.filter((h) => h.kind === k)), [hits]);
  useEffect(() => setActive(0), [hits]);
  // Re-measure the "more below" cue whenever the list's contents change.
  useEffect(() => { measure(); }, [hits, open, q, busy]);
  // …and when the list's own size changes (window resized, phone rotated).
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest", behavior: smoothBehavior() }); }, [active, open, listId]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pick = (h: SearchHit) => { onPick(h); setQ(""); setOpen(false); (document.activeElement as HTMLElement | null)?.blur?.(); onClose?.(); };
  const query = q.trim();
  const showList = open && (query ? true : !!emptyHint);
  const lg = size === "lg";
  return (
    <div ref={box} data-search-box data-tour={tour} className={cn("relative", className)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) { setOpen(false); onClose?.(); } }}>
      <div className={cn("flex items-center gap-2.5 rounded-xl border border-border bg-card text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]", lg ? "h-14 px-4" : "h-9 px-3")}>
        {busy ? <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", lg ? "size-5" : "size-4")} /> : <Search className={cn("shrink-0 text-accent", lg ? "size-5" : "size-4")} />}
        <input
          ref={inputRef} value={q} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { if (q) setQ(""); else { setOpen(false); (e.target as HTMLInputElement).blur(); onClose?.(); } return; }
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
        {!q && hint && <kbd className="hidden shrink-0 rounded border border-border px-1.5 font-mono text-[10px] text-muted-foreground sm:inline">{hint}</kbd>}
        {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>}
      </div>
      {showList && (
        <m.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-x-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
        <div ref={list} id={listId} role="listbox" aria-label={`${label} results`} onScroll={measure}
          className="relative max-h-[min(26rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain p-1.5">
          {!query ? emptyHint : error ? <p className="px-3 py-2.5 text-sm text-destructive">{error}</p>
            : !ordered.length ? (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">{busy ? "Searching…" : meta && !meta.dataLoaded ? "No FTC data has been loaded on this server yet, so there's nothing to search." : <>Nothing matches “{query}”.</>}</p>
            ) : GROUPS.map(([kind, title, Icon]) => {
              const hs = ordered.filter((h) => h.kind === kind);
              if (!hs.length) return null;
              return (
                <div key={kind} role="group" aria-label={title}>
                  <p className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}<span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-foreground/80">{hs.length}</span></p>
                  {hs.map((h) => {
                    const i = ordered.indexOf(h);
                    return (
                      <div
                        key={`${h.kind}:${h.ref}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                        onPointerDown={(e) => e.preventDefault()} onClick={() => pick(h)} onPointerMove={() => setActive(i)}
                        className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm", i === active ? "bg-accent/[0.12] text-foreground" : "text-foreground/90")}
                      >
                        <Icon className={cn("size-4 shrink-0", h.kind === "place" ? "text-accent" : "text-muted-foreground")} />
                        {/* The whole name gets the width and wraps before it cuts (event divisions differ only at the end); then season and details. */}
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 break-words">{h.title}</span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            {(h.kind === "event" || h.kind === "match") && h.season != null && <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] font-medium tabular-nums text-foreground/80">{seasonLabel(h.season)}</span>}
                            <span className="truncate">{h.subtitle}</span>
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
        </div>
        {below > 0 && (
          // The cue: results continue below. Fades the last row and offers a one-tap scroll.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-popover via-popover/85 to-transparent pb-2">
            <button type="button" tabIndex={-1} onPointerDown={(e) => e.preventDefault()} onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: smoothBehavior() })}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-accent/40 bg-popover px-3 py-1 text-xs font-medium text-accent-text shadow-sm hover:border-accent">
              {below} more below <ChevronDown className="size-3.5 motion-safe:animate-bounce" />
            </button>
          </div>
        )}
        </m.div>
      )}
    </div>
  );
}
