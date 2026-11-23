// The React side of the card morph (src/lib/cardMorph.ts). A card opts in with useMorphCard and marks its title
// `data-morph-title`; the page it opens marks its own title with useMorphTarget. Only cards inside a <MorphScope on>
// morph: everywhere else the hooks hand back nothing and the link cuts, as every other link does.
import { createContext, useCallback, useContext, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useNavigate, useNavigationType } from "react-router-dom";
import { launchMorph, maybeReturn, noteLeaving } from "../lib/cardMorph";
import { load } from "../lib/api";

const Scope = createContext(false);

/** Turns the morph on for the cards inside (the /preview/morph page, for now). */
export function MorphScope({ on = true, children }: { on?: boolean; children: ReactNode }) {
  return <Scope.Provider value={on}>{children}</Scope.Provider>;
}

/** The morph key for an event (the card and the event page agree on it). */
export const eventMorphKey = (season: number, code: string) => `event:${season}/${code}`;

/** Warms an event page at the tap: its code and its data, the same request the page makes (src/pages/EventPage.tsx). */
export function warmEvent(season: number, code: string) {
  void import("../pages/EventPage").catch(() => {});
  void load(`/api/events/${season}/${code}`).catch(() => {});
}

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

/** Props for the card's link to `to`: its key, and the tap that starts the morph and then changes the page itself.
 *  `warm`: fetch what the page needs at the tap (its code, its data), so it is drawn by the time the card has grown. */
export function useMorphCard(key: string, to: string, warm?: () => void): { "data-morph-key"?: string; onClick?: (e: MouseEvent<HTMLElement>) => void } {
  const on = useContext(Scope);
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
    if (launchMorph(e.currentTarget, key, () => navigate(to))) {
      e.preventDefault(); // the morph changes the page, a frame later
      try { warm?.(); } catch { /* warming is a bonus */ }
    }
  }, [key, to, navigate, warm]);
  return on ? { "data-morph-key": key, onClick } : {};
}

/** The destination page's title: marked so a landing morph can find it, and measured on the way out for Back. */
export function useMorphTarget(key: string) {
  const ref = useRef<HTMLElement | null>(null);
  // A layout effect's cleanup runs before React takes the page out of the document, so the title can still be measured.
  useLayoutEffect(() => () => noteLeaving(key, ref.current), [key]);
  const set = useCallback((el: HTMLElement | null) => { ref.current = el; }, []);
  return { ref: set, "data-morph-target": key };
}
