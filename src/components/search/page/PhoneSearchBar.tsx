// /search on a phone (FTC One Search, Part B 3b): the query in one bar that stays under the top bar while the page
// scrolls, and draws in to a slimmer line once it has scrolled. The bar is the page's real search field: one tap puts
// the caret in it, ready to edit. It claims the page's one search box (usePageSearch), so the top bar's field and its
// search button step aside: there's never a second box opening over this one (it used to be a button that opened the
// top bar's field, all selected, on top of it, and an iPhone tap on a selection only offers Cut/Copy/Paste).
// Phones only (md:hidden): from md up the query sits in the top bar's own field.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageSearch, useSearch } from "../../layout/Search";
import { SearchBox, hitHref } from "../SearchBox";
import { cn } from "../../cn";

/** Scrolled past the page's top: the bar draws in. */
function useScrolled(px = 24) {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.scrollY > px);
  useEffect(() => {
    const f = () => setOn(window.scrollY > px);
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, [px]);
  return on;
}

/** The bar's height as `--phone-search-h` on the page, so what else sticks under it (a comparison's team key) sits
 *  below it, not behind it; 0 once the bar is gone or hidden (md up). */
function usePhoneSearchHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current, root = document.documentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => root.style.setProperty("--phone-search-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--phone-search-h"); };
  }, []);
  return ref;
}

export function PhoneSearchBar({ query }: { query: string }) {
  const pageRef = usePageSearch();
  const { restoreFocus } = useSearch();
  const nav = useNavigate();
  const small = useScrolled();
  const ref = usePhoneSearchHeight();
  return (
    <div ref={ref} data-phone-search={small ? "compact" : "full"}
      className={cn("sticky top-(--header-h) z-20 -mx-4 -mt-4 mb-3 border-b bg-primary px-4 sm:-mx-6 sm:px-6 transition-[padding,border-color] duration-150 md:hidden", small ? "border-line py-1.5" : "border-transparent py-2")}>
      <SearchBox
        inputRef={pageRef}
        label="Search teams, events and matches"
        placeholder="Search teams, events, matches…"
        discover examples syncQuery={query}
        onPick={(h) => nav(hitHref(h))}
        onEscape={restoreFocus}
        fieldClassName={cn("transition-[height] duration-150", small ? "h-[44px]" : "h-[48px]")}
      />
    </div>
  );
}
