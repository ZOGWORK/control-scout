// Global search: an inline field in the top bar on every page, results in a
// dropdown under it. No popup: the page stays usable behind it. Content only
// (teams, events, matches); the nav handles navigation.
// ⌘K / Ctrl+K / "/" focus it; on phones the header's search button expands it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { SearchBox, hitHref } from "../search/SearchBox";
import { cn } from "../cn";

export { hitHref };

interface SearchCtx {
  /** Focus the search field (expanding it on phones). */
  open: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
}
const Ctx = createContext<SearchCtx>({ open: () => {}, inputRef: { current: null }, expanded: false, setExpanded: () => {} });
export const useSearch = () => useContext(Ctx);

export function SearchProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const open = useCallback(() => {
    setExpanded(true);
    // After the (phone) field has rendered.
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); open(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const value = useMemo(() => ({ open, inputRef, expanded, setExpanded }), [open, expanded]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The top-bar search. Inline from md up; on phones a button that expands a full-width field under the header. */
export function GlobalSearch() {
  const { open, inputRef, expanded, setExpanded } = useSearch();
  const nav = useNavigate();
  return (
    <>
      <button type="button" onClick={open} className={cn("flex h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-xs text-text-muted hover:text-text-base md:hidden", expanded && "hidden")} aria-label="Search">
        <Search className="size-3.5" /> Search
      </button>
      <SearchBox
        inputRef={inputRef}
        label="Search teams, events and matches"
        placeholder="Search teams, events, matches…"
        hint={isMac ? "⌘K" : "Ctrl K"}
        onPick={(h) => nav(hitHref(h))}
        onClose={() => setExpanded(false)}
        className={cn(
          "w-full md:block md:max-w-md",
          expanded ? "absolute inset-x-0 top-full z-50 border-b border-line bg-primary p-2 md:relative md:inset-auto md:top-auto md:border-0 md:bg-transparent md:p-0" : "hidden",
        )}
      />
    </>
  );
}
