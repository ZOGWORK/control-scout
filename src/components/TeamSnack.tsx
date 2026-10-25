// A tap on a team in a match list opens this card at the bottom of the screen instead of leaving for the
// team page: the team's name, its place and record here, its OPR and average. "View team" goes to the page.
// Every row the team plays in marks it while the card is open; a second tap on it, X or Escape closes it.
import { createContext, useContext, useEffect, useId, useRef, useState, type Ref } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronRight, X } from "lucide-react";
import { m as Motion } from "./motion";
import { useApi, qs } from "../lib/api";
import type { MatchView, TeamProfile } from "../shared/api";
import { cn } from "./cn";

/** The team the card is open for, and how a chip opens or closes it. Absent outside a match list: chips link. */
export const TeamSnackContext = createContext<{ team: number | null; toggle: (team: number) => void } | null>(null);
export const useTeamSnack = () => useContext(TeamSnackContext);

/** One card per page: a list that opens one says so, and any other list's card closes. */
const OPENED = "cs-team-snack";

/** The team whose card a match list has open, and how its chips open or close it. */
export function useTeamSnackState() {
  const id = useId();
  const [team, setTeam] = useState<number | null>(null);
  useEffect(() => {
    const other = (e: Event) => { if ((e as CustomEvent<string>).detail !== id) setTeam(null); };
    window.addEventListener(OPENED, other);
    return () => window.removeEventListener(OPENED, other);
  }, [id]);
  useEffect(() => { if (team != null) window.dispatchEvent(new CustomEvent(OPENED, { detail: id })); }, [team, id]);
  return [team, setTeam] as const;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** `record`: the team's wins, losses and ties in the matches listed (teamRecord). `code`: the one event listed, so its rank shows. */
export function TeamSnack({ team, season, name, code, record, onClose }: {
  team: number | null; season: number; name?: string; code?: string;
  record: { w: number; l: number; t: number; played: number } | null; onClose: () => void;
}) {
  const reduce = !!useReducedMotion();
  // Keyboard: the card takes focus when it opens (its actions would otherwise sit after every row in the
  // list), and gives it back to the team that opened it when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const view = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (team == null) {
      const back = opener.current;
      opener.current = null;
      // Only when focus was in the card (its X, Escape) or nowhere: a tap on another control keeps that control.
      const at = document.activeElement;
      if (back?.isConnected && (!at || at === document.body || !at.isConnected || at.closest("[data-team-snack]"))) back.focus({ preventScroll: true });
      return;
    }
    if (!opener.current && document.activeElement instanceof HTMLElement && !document.activeElement.closest("[data-team-snack]")) opener.current = document.activeElement;
    view.current?.focus({ preventScroll: true });
  }, [team]);
  useEffect(() => {
    if (team == null) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [team, onClose]);
  return (
    <AnimatePresence>
      {team != null && (
        <Motion.div key="snack" role="dialog" aria-label={`Team ${team}`} data-team-snack
          className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto max-w-xl md:bottom-6"
          initial={reduce ? false : { y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { y: 24, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
          <SnackBody key={team} team={team} season={season} name={name} code={code} record={record} onClose={onClose} viewRef={view} />
        </Motion.div>
      )}
    </AnimatePresence>
  );
}

function SnackBody({ team, season, name, code, record, onClose, viewRef }: { team: number; season: number; name?: string; code?: string; record: { w: number; l: number; t: number; played: number } | null; onClose: () => void; viewRef: Ref<HTMLAnchorElement> }) {
  const state = useApi<TeamProfile>(`/api/teams/${team}${qs({ season })}`);
  const p = state.data?.team?.number === team ? state.data : undefined;
  const st = p?.stats;
  const here = code ? p?.events.find((e) => e.code === code) : undefined;
  const facts: { k: string; v: string }[] = [];
  if (here?.rank != null) facts.push({ k: "place", v: ordinal(here.rank) });
  // The record that goes with the list: the event's own (one event listed), else the listed matches'. With
  // neither (nothing played here yet), the season's, and it says so.
  if (here?.wins != null) facts.push({ k: "W-L-T", v: `${here.wins}-${here.losses ?? 0}-${here.ties ?? 0}` });
  else if (record && record.played > 0) facts.push({ k: "W-L-T", v: `${record.w}-${record.l}-${record.t}` });
  else if (st && st.record.matches > 0) facts.push({ k: "W-L-T this season", v: `${st.record.wins}-${st.record.losses}-${st.record.ties}` });
  if (st?.opr.np.value != null) facts.push({ k: "npOPR", v: st.opr.np.value.toFixed(2) });
  if (st?.avg.np != null) facts.push({ k: "npAVG", v: st.avg.np.toFixed(2) });
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-xl backdrop-blur">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-semibold">
          <span className="tabular-nums">{team}</span>{(p?.team.name ?? name) && <span className="text-text-muted"> · <span className="italic text-text-base">{p?.team.name ?? name}</span></span>}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-sm text-text-muted max-sm:gap-x-3" data-snack-facts>
          {facts.length ? facts.map((f, i) => (
            <span key={f.k} className="whitespace-nowrap">{/* A phone wraps the facts: no dot to start the second line, a wider gap instead. */}
            {i > 0 && <span aria-hidden className="mr-1.5 max-sm:hidden">·</span>}<span className="font-semibold tabular-nums text-text-base">{f.v}</span> {f.k}</span>
          )) : state.error ? <span>Couldn't load this team's numbers.</span>
            : p ? <span>No matches on record this season yet.</span>
            : <span className="skeleton inline-block h-4 w-56 rounded" />}
        </p>
      </div>
      <Link ref={viewRef} to={`/teams/${team}${qs({ season })}`} className="flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1.5 text-sm font-medium text-text-base outline-none transition-colors still-hover:bg-accent-soft still-hover:text-accent-text focus-visible:ring-2 focus-visible:ring-ring/60">
        View team <ChevronRight className="size-4" aria-hidden />
      </Link>
      <button type="button" onClick={onClose} aria-label="Close" className={cn("-mr-1 shrink-0 rounded-md p-1.5 text-text-muted outline-none transition-colors still-hover:bg-muted still-hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60")}>
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** The name the list already knows for a team (from any row it plays in), shown while its profile loads. */
export const nameIn = (matches: MatchView[], team: number) => {
  for (const m of matches) for (const t of [...m.red.teams, ...m.blue.teams]) if (t.number === team && t.name) return t.name;
  return undefined;
};
