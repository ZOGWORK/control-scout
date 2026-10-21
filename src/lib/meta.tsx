// Site metadata (seasons, current season, data freshness) loaded once.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useApi } from "./api";
import type { Meta } from "../shared/api";
import { isWeek, parsePlaces, placeKey } from "../shared/rankings";

const Ctx = createContext<Meta | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<Meta>("/api/meta");
  // A server with no data yet (first sync or a snapshot still loading): check
  // again every 30 s so the "no data" notice and search message clear by themselves.
  const empty = data ? !data.dataLoaded : false;
  useEffect(() => {
    if (!empty) return;
    const t = setInterval(reload, 30_000);
    return () => clearInterval(t);
  }, [empty, reload]);
  return <Ctx.Provider value={data ?? null}>{children}</Ctx.Provider>;
}

/** Null until loaded. */
export const useMeta = () => useContext(Ctx);

/** The current FTC season (from the server, else from today's date). */
export function useCurrentSeason(): number {
  const m = useMeta();
  if (m) return m.currentSeason;
  const d = new Date();
  return d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

/** Whether a season has ratings and predictions (2019–2022 are history only). 2023+ until meta loads. */
export function usePredictable(season: number): boolean {
  return useMeta()?.seasons.find((s) => s.season === season)?.predictable ?? season >= 2023;
}

/** True while a CSS media query matches (e.g. phone width), following changes. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setOn(m.matches);
    fn();
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return on;
}

export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · Control Scout` : "Control Scout — free FTC scouting & predictions";
  }, [title]);
}

/** The canonical form of a page path, the same as the server's: no trailing slash, event codes in
 *  upper case, team numbers without leading zeros (/events/2025/usnjnom3 → /events/2025/USNJNOM3).
 *  Event codes are only ever [A-Za-z0-9_-] (as on the server), so nothing is decoded and a
 *  malformed path is left as it is, never thrown on. */
export function canonicalPath(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  return p
    .replace(/^\/events\/(\d{4})\/([A-Za-z0-9_-]{1,40})$/, (_m, s: string, c: string) => `/events/${s}/${c.toUpperCase()}`)
    // The pit display's canonical is its event page (server/seoMeta.ts), so the TV screen folds into the page to find.
    .replace(/^\/events\/(\d{4})\/([A-Za-z0-9_-]{1,40})\/display$/i, (_m, s: string, c: string) => `/events/${s}/${c.toUpperCase()}`)
    .replace(/^\/teams\/0*(\d+)$/, "/teams/$1")
    .replace(/^\/power-rankings\/(\d{4}-w\d{2})$/i, (_m, w: string) => `/power-rankings/${w.toLowerCase()}`);
}

// How many not-found pages are showing (0 or 1; a count so a remount never races an unmount).
let notFoundShown = 0;
const notFoundSubs = new Set<() => void>();
const subscribeNotFound = (fn: () => void) => { notFoundSubs.add(fn); return () => { notFoundSubs.delete(fn); }; };

/** A not-found page is showing: the head says noindex and names no canonical URL (as the server's 404 does). */
export function useNotFoundHead() {
  useEffect(() => {
    notFoundShown++;
    notFoundSubs.forEach((f) => f());
    return () => { notFoundShown--; notFoundSubs.forEach((f) => f()); };
  }, []);
}

/** The query a page's canonical URL keeps: only /rankings' view (each place, week and page is its own list,
 *  as the server's canonical says: server/seoMeta.ts rankingsMeta), normalised the same way (places as the
 *  API reads them, repeated ones joined; values it would refuse left out), in a fixed order. Anything else:
 *  none. A page past the last, which only the server can clamp, is put right by the page itself
 *  (RankingsPage rewrites its URL to the view the API answered with). */
export function canonicalQuery(pathname: string, search: string): string {
  if (!/^\/rankings\/?$/i.test(pathname)) return "";
  const sp = new URLSearchParams(search), q = new URLSearchParams();
  const season = sp.get("season"), week = sp.get("week"), page = Number(sp.get("page"));
  const places = parsePlaces(sp.getAll("region").join(","));
  if (season && /^\d{4}$/.test(season)) q.set("season", season);
  if (places?.length) q.set("region", places.map(placeKey).join(","));
  if (week && isWeek(week)) q.set("week", week);
  if (Number.isInteger(page) && page > 1 && page <= 10_000) q.set("page", String(page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** Keeps <link rel="canonical"> (and a not-found page's noindex) in step with in-app navigation (the server sets both on the first load). */
export function CanonicalSync() {
  const { pathname, search } = useLocation();
  const notFound = useSyncExternalStore(subscribeNotFound, () => notFoundShown > 0);
  useEffect(() => {
    // Only the not-found noindex (marked data-not-found, by the server or here) is ours: a personal page's own stays.
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"][data-not-found]');
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (notFound) {
      link?.remove();
      if (!robots) {
        const m = document.createElement("meta");
        m.name = "robots"; m.content = "noindex"; m.setAttribute("data-not-found", "");
        document.head.appendChild(m);
      }
      return;
    }
    robots?.remove();
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = `${window.location.origin}${canonicalPath(pathname)}${canonicalQuery(pathname, search)}`;
  }, [pathname, search, notFound]);
  return null;
}
