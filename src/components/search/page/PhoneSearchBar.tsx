// /search on a phone (FTC One Search, Part B 3b): the query in one bar that stays under the top bar while the page
// scrolls, and draws in to a slimmer line once it has scrolled. The bar is the page's real search field: one tap puts
// the caret in it, ready to edit. It claims the page's one search box (usePageSearch), so the top bar's field and its
// search button step aside: there's never a second box opening over this one (it used to be a button that opened the
// top bar's field, all selected, on top of it, and an iPhone tap on a selection only offers Cut/Copy/Paste).
// Phones only (md:hidden): from md up the query sits in the top bar's own field. SearchPage puts it above the results
// column (and the loading screen), with a negative bottom margin for the column's top padding.
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePageSearch, useSearch } from "../../layout/Search";
import { SearchBox, hitHref } from "../SearchBox";
import { cn } from "../../cn";
import { Wash, washSize } from "../../layout/Wash";
import { isV8 } from "../../../lib/v8";

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

/** v8: keeps the bar's own copy of the wash (`--bar-wash-y`) lined up with the page's, which scrolls under it, so the
 *  bar is solid (no row shows through, no frosted blur: #2148) yet looks like the wash it sits on (no black band). */
function useWashUnder(el: RefObject<HTMLDivElement | null>, on: boolean) {
  useEffect(() => {
    const bar = el.current;
    if (!on || !bar) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const wash = document.querySelector("[data-wash]");
      if (wash) bar.style.setProperty("--bar-wash-y", `${Math.round(wash.getBoundingClientRect().top - bar.getBoundingClientRect().top)}px`);
    };
    const later = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", later); window.removeEventListener("resize", later); };
  }, [el, on]);
}

export function PhoneSearchBar({ query }: { query: string }) {
  const pageRef = usePageSearch();
  const { restoreFocus } = useSearch();
  const nav = useNavigate();
  const small = useScrolled();
  const ref = usePhoneSearchHeight();
  const v8 = isV8();
  const { pathname } = useLocation();
  useWashUnder(ref, v8);
  return (
    <div ref={ref} data-phone-search={small ? "compact" : "full"}
      className={cn("sticky top-(--header-h) z-20 -mx-4 -mb-1 border-b bg-primary px-4 sm:-mx-6 sm:-mb-5 sm:px-6 transition-[padding,border-color,background-color] duration-150 md:hidden",
        // v8: solid, never see-through or blurred (#2148), drawn with its own copy of the wash behind the field, so at the
        // top it is the wash itself and once scrolled it is a strip of it, never a black band across the wash.
        small ? "border-line py-1.5 v8:border-transparent" : "border-transparent py-2")}>
      {v8 && <div aria-hidden data-bar-wash className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0" style={{ transform: "translateY(var(--bar-wash-y, 0px))" }}><Wash size={washSize(pathname)} includeParticleWave={false} /></div>
      </div>}
      <div className="relative">
      <SearchBox
        inputRef={pageRef}
        label="Search teams, events and matches"
        placeholder="Search teams, events, matches…"
        discover examples syncQuery={query}
        onPick={(h) => nav(hitHref(h))}
        onEscape={restoreFocus}
        glide
        fieldClassName={cn("transition-[height] duration-150", small ? "h-[44px]" : "h-[48px]")}
      />
      </div>
    </div>
  );
}
