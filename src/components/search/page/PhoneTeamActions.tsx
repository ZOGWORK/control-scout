// A team card's own actions on a phone (FTC One Search, Part B 3b): VS Compare (picks it for the Compare (2) bar),
// Shortlist and a quick look at its matches, each a button you can see and tap. The same two quick actions also come by swiping the card: right adds
// it to the Shortlist (the same list as the team page's Shortlist button, src/lib/personal.tsx bookmarks), left opens
// its matches. Swiping is a shortcut, never the only way.
import { useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bookmark, BookmarkCheck, ListOrdered } from "lucide-react";
import type { MatchView } from "../../../shared/api";
import { useApi } from "../../../lib/api";
import { useTeamFlags } from "../../../lib/personal";
import { seasonLabel } from "../../../lib/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../ui/overlay";
import { toast } from "../../ui/sonner";
import { cn } from "../../cn";

/** How far a card moves before a swipe counts, in px. */
export const SWIPE_PX = 72;

/** A finished touch drag as a swipe: right, left, or none (too short, or more up/down than sideways: a scroll). */
export function swipeOf(dx: number, dy: number): "right" | "left" | null {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx > 0 ? "right" : "left";
}

const btn = "inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/** The card with its actions underneath, and the swipe on the whole card. */
/** `picked` / `onPick`: VS Compare picks this team for the page's Compare (2) bar (PhoneCompare.tsx). */
export function PhoneTeamCard({ team, name, season, picked, onPick, children }: { team: number; name: string; season: number; picked: boolean; onPick: () => void; children: ReactNode }) {
  const flags = useTeamFlags(team);
  const nav = useNavigate();
  const [matches, setMatches] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  // Closing the matches sheet hands focus back to its button, however it was opened (a swipe focuses nothing).
  const matchesBtn = useRef<HTMLButtonElement>(null);
  const shortlist = () => {
    const on = !flags.bookmarked;
    flags.toggleBookmark();
    if (!on) { toast(`Removed ${team} from your shortlist`); return; }
    toast.success(`${team} added to your shortlist`, { action: { label: "Shortlist", onClick: () => nav("/shortlist") } });
  };
  return (
    <div className="relative" data-phone-team={team}>
      {/* What a swipe will do, uncovered as the card moves. */}
      {dx !== 0 && (
        <div aria-hidden className={cn("absolute inset-0 flex items-center rounded-xl px-4 text-sm font-semibold", dx > 0 ? "justify-start bg-accent/20 text-accent-text" : "justify-end bg-sky-500/20 text-sky-700 dark:text-sky-300")}>
          {dx > 0 ? (flags.bookmarked ? "Remove from Shortlist" : "Add to Shortlist") : "Matches"}
        </div>
      )}
      <div
        style={dx ? { transform: `translateX(${Math.max(-120, Math.min(120, dx))}px)` } : undefined}
        className={cn("relative", !dx && "transition-transform duration-150")}
        onTouchStart={(e) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY }; }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const t = e.touches[0], x = t.clientX - start.current.x, y = t.clientY - start.current.y;
          if (Math.abs(x) > Math.abs(y)) setDx(x);
        }}
        onTouchEnd={(e) => {
          const s = start.current, t = e.changedTouches[0];
          start.current = null;
          setDx(0);
          if (!s) return;
          const way = swipeOf(t.clientX - s.x, t.clientY - s.y);
          if (way === "right") shortlist();
          else if (way === "left") setMatches(true);
        }}
        onTouchCancel={() => { start.current = null; setDx(0); }}
        data-swipe
      >
        {children}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" data-team-actions>
        <button type="button" onClick={onPick} aria-pressed={picked} data-vs-compare className={cn(btn, picked ? "border-accent bg-accent text-accent-ink" : "border-accent/50 bg-accent/[0.1] text-accent-text")}>{picked ? "Picked ✓" : "VS Compare"}</button>
        <button type="button" onClick={shortlist} aria-pressed={flags.bookmarked} data-shortlist className={cn(btn, flags.bookmarked ? "border-accent/50 bg-accent/[0.1] text-accent-text" : "border-border bg-card text-foreground")}>
          {flags.bookmarked ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}{flags.bookmarked ? "Shortlisted" : "Shortlist"}
        </button>
        <button ref={matchesBtn} type="button" onClick={() => setMatches(true)} data-matches className={cn(btn, "border-border bg-card text-foreground")}>
          <ListOrdered className="size-4" aria-hidden />Matches
        </button>
      </div>
      <Sheet open={matches} onOpenChange={setMatches}>
        <SheetContent side="bottom" className="gap-3 p-4" returnFocus={() => matchesBtn.current} data-matches-sheet>
          {matches && <MatchHistory team={team} name={name} season={season} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** A team's latest played matches in a season, newest first: a quick look, with the full list a tap away. */
function MatchHistory({ team, name, season }: { team: number; name: string; season: number }) {
  const { data, loading, error } = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches?season=${season}`);
  const played = (data?.matches ?? []).filter((m) => m.played && m.red.score && m.blue.score).reverse().slice(0, 10);
  return (
    <>
      <SheetHeader className="pr-8">
        <SheetTitle>{team} {name}: matches</SheetTitle>
        <SheetDescription>{seasonLabel(season)}, latest first</SheetDescription>
      </SheetHeader>
      {loading ? <p className="text-sm text-muted-foreground">Loading matches…</p>
        : error ? <p className="text-sm text-muted-foreground">Couldn't load matches.</p>
        : !played.length ? <p className="text-sm text-muted-foreground">No played matches in {seasonLabel(season)} yet.</p>
        : (
          <ul className="divide-y divide-border rounded-xl border border-border" data-match-history>
            {played.map((m) => {
              const red = m.red.teams.some((t) => t.number === team);
              const us = (red ? m.red : m.blue).score!.total, them = (red ? m.blue : m.red).score!.total;
              const res = us > them ? "W" : us < them ? "L" : "T";
              return (
                <li key={`${m.code}:${m.key}`}>
                  <Link to={`/events/${m.season}/${m.code}?match=${m.key}`} className="flex min-h-[44px] items-center gap-3 px-3 py-2 text-sm">
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold", res === "W" ? "bg-success/15 text-success" : res === "L" ? "bg-danger/15 text-danger" : "bg-muted text-muted-foreground")}>{res}</span>
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium text-foreground">{m.label}</span> <span className="text-muted-foreground">· {m.code}</span></span>
                    <span className="shrink-0 tabular-nums text-foreground">{us}–{them}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      <Link to={`/teams/${team}?season=${season}#matches`} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-accent-text">All matches →</Link>
    </>
  );
}
