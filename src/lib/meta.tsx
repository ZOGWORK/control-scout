// Site metadata (seasons, current season, data freshness) loaded once.
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useApi } from "./api";
import type { Meta } from "../shared/api";

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

export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · FTC Control Scout` : "FTC Control Scout — free FTC scouting & predictions";
  }, [title]);
}

/** The canonical form of a page path, the same as the server's: no trailing slash, event codes in
 *  upper case, team numbers without leading zeros (/events/2025/usnjnom3 → /events/2025/USNJNOM3). */
export function canonicalPath(pathname: string): string {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
  return p
    .replace(/^\/events\/(\d{4})\/([^/]+)$/, (_m, s: string, c: string) => `/events/${s}/${decodeURIComponent(c).toUpperCase()}`)
    .replace(/^\/teams\/0*(\d+)$/, "/teams/$1");
}

/** Keeps <link rel="canonical"> in step with in-app navigation (the server sets it on the first load). */
export function CanonicalSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) { link = document.createElement("link"); link.rel = "canonical"; document.head.appendChild(link); }
    link.href = `${window.location.origin}${canonicalPath(pathname)}`;
  }, [pathname]);
  return null;
}
