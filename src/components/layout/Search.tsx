// Global search (⌘K / Ctrl+K / "/"): teams, events and matches as you type.
import { useEffect, useRef, useState, createContext, useContext, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, Hash, Loader2, Swords, Users } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { apiFetch } from "../../lib/api";
import type { SearchHit } from "../../shared/api";
import { usePersonal } from "../../lib/personal";
import { useMeta } from "../../lib/meta";

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useSearch = () => useContext(Ctx);

export function hitHref(h: SearchHit): string {
  if (h.kind === "team") return `/teams/${h.ref}`;
  if (h.kind === "event") { const [s, c] = h.ref.split(":"); return `/events/${s}/${c}`; }
  const [s, c, level, series, number] = h.ref.split(":");
  return `/events/${s}/${c}?match=${level}:${series}:${number}`;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openFn = useCallback(() => setOpen(true), []);
  return (
    <Ctx.Provider value={{ open: openFn }}>
      {children}
      <SearchDialog open={open} onOpenChange={setOpen} />
    </Ctx.Provider>
  );
}

function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const nav = useNavigate();
  const { state } = usePersonal();
  const meta = useMeta();
  // My team, tracked and shortlisted teams/events rank first among equal matches.
  const prefer = [
    ...new Set([
      ...(state.myTeam ? [`team:${state.myTeam}`] : []),
      ...state.tracked.teams.map((t) => `team:${t}`),
      ...state.bookmarks.map((t) => `team:${t}`),
      ...state.tracked.events.map((e) => `event:${e}`),
    ]),
  ].slice(0, 100).join(",");
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (!query) { setHits([]); setError(null); return; }
    const id = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(query)}&limit=15${prefer ? `&prefer=${encodeURIComponent(prefer)}` : ""}`)
        .then((r) => { if (id === seq.current) { setHits(r.hits); setError(null); } })
        .catch((e) => { if (id === seq.current) setError(e.message); })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 140);
    return () => clearTimeout(t);
  }, [q, open, prefer]);
  const go = (href: string) => { onOpenChange(false); setQ(""); nav(href); };
  const groups: [SearchHit["kind"], string, typeof Users][] = [["match", "Matches", Swords], ["team", "Teams", Users], ["event", "Events", CalendarDays]];
  const quick = [
    ...(state.myTeam ? [{ label: `My team · ${state.myTeam}`, href: `/teams/${state.myTeam}` }] : []),
    { label: "Prediction lab", href: "/predict" },
    { label: "Track record", href: "/predict/accuracy" },
    { label: "Events this week", href: "/events" },
  ];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Search teams, events and matches" shouldFilter={false}>
      <CommandInput placeholder="Team number or name, event, or a match like “USNJQ1 Q12”…" value={q} onValueChange={setQ} />
      <CommandList>
        {busy && <div className="flex items-center gap-2 px-4 py-3 text-sm text-text-muted"><Loader2 className="size-4 animate-spin" /> Searching…</div>}
        {error && <div className="px-4 py-3 text-sm text-destructive">{error}</div>}
        {!busy && q.trim() && !hits.length && !error && <CommandEmpty>{meta && !meta.dataLoaded ? "This server has no FTC data loaded yet, so there's nothing to search." : <>No team, event or match matches “{q.trim()}”.</>}</CommandEmpty>}
        {!q.trim() && (
          <CommandGroup heading="Go to">
            {quick.map((x) => <CommandItem key={x.href} value={x.href} onSelect={() => go(x.href)}><Hash className="size-4 text-text-muted" />{x.label}</CommandItem>)}
          </CommandGroup>
        )}
        {groups.map(([kind, title, Icon]) => {
          const hs = hits.filter((h) => h.kind === kind);
          if (!hs.length) return null;
          return (
            <CommandGroup key={kind} heading={title}>
              {hs.map((h) => (
                <CommandItem key={`${h.kind}:${h.ref}`} value={`${h.kind}:${h.ref}`} onSelect={() => go(hitHref(h))}>
                  <Icon className="size-4 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{h.title}</span>
                  <span className="hidden max-w-[45%] truncate text-xs text-text-muted sm:inline">{h.subtitle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
