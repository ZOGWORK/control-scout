// Global search: an inline field in the top bar, results in a dropdown under
// it. No popup: the page stays usable behind it. Content only (teams, events,
// matches); the nav handles navigation.
// One search box per page: a page whose main content is its own search box
// (Home's hero, Predict's picker) claims it with usePageSearch(), and the
// top-bar field steps aside. ⌘K / Ctrl+K / "/" focus whichever box is showing;
// on phones the header's search button expands the top-bar field.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { smoothBehavior } from "../../lib/pageScroll";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { SearchBox, hitHref } from "../search/SearchBox";
import { cn } from "../cn";

export { hitHref };

interface SearchCtx {
  /** Focus the search box on this page (expanding the top-bar field on phones). */
  open: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  pageRef: React.RefObject<HTMLInputElement | null>;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  /** A page has its own search box: the top-bar field hides. */
  pageClaimed: boolean;
  claim: () => () => void;
  /** Escape out of the field: focus goes back to where it was when the field was opened (not to the page body). */
  restoreFocus: () => void;
}
const noop = () => () => {};
const Ctx = createContext<SearchCtx>({ open: () => {}, inputRef: { current: null }, pageRef: { current: null }, expanded: false, setExpanded: () => {}, pageClaimed: false, claim: noop, restoreFocus: () => {} });
export const useSearch = () => useContext(Ctx);

/** For a page whose main content is a search box: returns the ref for that box, and hides the top-bar field while the page is open. */
export function usePageSearch() {
  const { pageRef, claim } = useContext(Ctx);
  useEffect(() => claim(), [claim]);
  return pageRef;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pageRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => { setClaims((n) => n + 1); return () => setClaims((n) => n - 1); }, []);
  const pageClaimed = claims > 0;
  const returnTo = useRef<HTMLElement | null>(null);
  const restoreFocus = useCallback(() => {
    const el = returnTo.current;
    returnTo.current = null;
    // A frame later: the phone's search button is hidden while the field is open, and only shows again once the
    // close has rendered (a hidden element can't take focus).
    requestAnimationFrame(() => { if (el?.isConnected) el.focus({ preventScroll: true }); });
  }, []);
  // Focus moving anywhere but a search field (Tab away, a click, a pick) ends that visit: the saved opener goes,
  // so a later Escape never jumps back to it. Escape itself blurs to the body (no focusin), so it keeps it.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => { if (e.target !== inputRef.current && e.target !== pageRef.current) returnTo.current = null; };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);
  const open = useCallback(() => {
    const was = document.activeElement;
    // The shortcut again while already in a search field keeps the control it was first opened from.
    if (was !== inputRef.current && was !== pageRef.current) returnTo.current = was instanceof HTMLElement && was !== document.body ? was : null;
    if (pageClaimed && pageRef.current) {
      pageRef.current.scrollIntoView({ block: "center", behavior: smoothBehavior() });
      pageRef.current.focus({ preventScroll: true });
      pageRef.current.select();
      return;
    }
    setExpanded(true);
    // After the (phone) field has rendered.
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [pageClaimed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); open(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const value = useMemo(() => ({ open, inputRef, pageRef, expanded, setExpanded, pageClaimed, claim, restoreFocus }), [open, expanded, pageClaimed, claim, restoreFocus]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const SEARCH_HINT = isMac ? "⌘K" : "Ctrl K";

/** The top-bar search. Inline from md up; on phones a button that expands a full-width field under the header. Hidden on pages with their own search box.
 *  `part`: the phone's button and the field can sit in different places in the top bar (the button by the menu button, the field centred). */
export function GlobalSearch({ part }: { part?: "button" | "field" }) {
  const { open, inputRef, expanded, setExpanded, pageClaimed, restoreFocus } = useSearch();
  const nav = useNavigate();
  if (pageClaimed) return null;
  return (
    <>
      {part !== "field" && (
        <button type="button" onClick={open} className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted pointer-coarse:size-[44px] outline-none transition-colors hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden", expanded && "invisible")} aria-label="Search" data-tour="search">
          <Search className="size-5" />
        </button>
      )}
      {part !== "button" && <SearchBox
        inputRef={inputRef}
        label="Search teams, events and matches"
        placeholder="Search teams, events, matches…"
        hint={SEARCH_HINT}
        tour="search"
        onPick={(h) => nav(hitHref(h))}
        onClose={() => setExpanded(false)}
        onEscape={restoreFocus}
        className={cn(
          "w-full md:block md:max-w-xs lg:max-w-sm",
          expanded ? "absolute inset-x-0 top-full z-50 border-b border-line bg-primary p-2 md:relative md:inset-auto md:top-auto md:border-0 md:bg-transparent md:p-0" : "hidden",
        )}
      />}
    </>
  );
}
