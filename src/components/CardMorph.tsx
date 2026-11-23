// The React side of the card morph (src/lib/cardMorph.ts). A card opts in with useMorphCard and marks its title
// `data-morph-title`; the page it opens marks its own title with useMorphTarget. Only cards inside a <MorphScope on>
// morph: everywhere else the hooks hand back nothing and the link cuts, as every other link does.
import { createContext, useCallback, useContext, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useNavigationType } from "react-router-dom";
import { launchMorph, maybeReturn, noteLeaving, noteShown } from "../lib/cardMorph";
import { load, qs } from "../lib/api";

/** null: no morph here. A string: the section's name (one name per section on a page), so Back finds the copy of a
 *  card in the section it was tapped in when the same card shows in two. */
const Scope = createContext<string | null>(null);

/** Turns the morph on for the cards inside (Home's cards, the Events list, the search page's cards), naming their section. */
export function MorphScope({ name, children }: { name: string; children: ReactNode }) {
  return <Scope.Provider value={name}>{children}</Scope.Provider>;
}

/** The morph key for an event (the card and the event page agree on it). */
export const eventMorphKey = (season: number, code: string) => `event:${season}/${code}`;

/** Warms an event page at the tap: its code and its data, the same request the page makes (src/pages/EventPage.tsx). */
export function warmEvent(season: number, code: string) {
  void import("../pages/EventPage").catch(() => {});
  void load(`/api/events/${season}/${code}`).catch(() => {});
}

/** The morph key for a team (the card and the team page agree on it). */
export const teamMorphKey = (team: number) => `team:${team}`;

/** Warms a team page at the tap: its code and its data, the same request the page makes (src/pages/TeamPage.tsx),
 *  for the season the link asks for when it asks for one. */
export function warmTeam(team: number, season?: string | number | null) {
  void import("../pages/TeamPage").catch(() => {});
  void load(`/api/teams/${team}${qs({ season })}`).catch(() => {});
}

/** The team a link opens, when it opens the plain team page (`/teams/n`, any season), with the season it asks for:
 *  a team link to anywhere else (an event page for that team, say) has no team page to land on, so no morph. */
export function teamLink(to: string): { team: number; season: string | null } | null {
  try {
    const u = new URL(to, "http://x");
    const m = /^\/teams\/(\d+)\/?$/.exec(u.pathname);
    return m ? { team: Number(m[1]), season: u.searchParams.get("season") } : null;
  } catch { return null; }
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

/** Props for the card's link to `to`: its key, and the tap that starts the morph and then changes the page itself.
 *  The link is the card, or (a card whose title link stretches over it) the key goes on the card and the tap on the
 *  link: the tap grows the nearest element carrying the key.
 *  `warm`: fetch what the page needs at the tap (its code, its data), so it is drawn by the time the card has grown. */
export function useMorphCard(key: string, to: string, warm?: () => void): { "data-morph-key"?: string; "data-morph-slot"?: string; onClick?: (e: MouseEvent<HTMLElement>) => void } {
  const slot = useContext(Scope);
  // An empty key: this card has no page to land on (no morph, the plain link).
  const on = slot !== null && key !== "";
  const navigate = useNavigate();
  const action = useNavigationType();
  // Back to this list: the card left last shrinks the page back into itself (once per arrival).
  const arrived = useRef(false);
  useLayoutEffect(() => {
    if (!on || arrived.current) return;
    arrived.current = true;
    if (action === "POP") maybeReturn(key);
  }, [on, action, key]);
  const onClick = useCallback((e: MouseEvent<HTMLElement>) => {
    // A new tab, a modified click or a page that took the click over: no morph (the browser does what was asked).
    if (!plainClick(e)) return;
    // launchMorph never throws (a failure is a plain false), so a broken morph still leaves the tap to the link.
    const card = e.currentTarget.closest<HTMLElement>("[data-morph-key]") ?? e.currentTarget;
    if (launchMorph(card, key, () => navigate(to))) {
      e.preventDefault(); // the morph changes the page, a frame later
      try { warm?.(); } catch { /* warming is a bonus */ }
    }
  }, [key, to, navigate, warm]);
  return on ? { "data-morph-key": key, "data-morph-slot": slot, onClick } : {};
}

/** The destination page's title: marked so a landing morph can find it, and measured on the way out for Back. */
export function useMorphTarget(key: string) {
  const ref = useRef<HTMLElement | null>(null);
  // A layout effect's cleanup runs before React takes the page out of the document, so the title can still be measured.
  // Shown (again, say by Back from a later page): an older way back from it is stale. Leaving records a fresh one.
  useLayoutEffect(() => { noteShown(key); return () => noteLeaving(key, ref.current); }, [key]);
  const set = useCallback((el: HTMLElement | null) => { ref.current = el; }, []);
  return { ref: set, "data-morph-target": key };
}
