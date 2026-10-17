// Page changes that land at once: when a pointer rests on a link, is pressed on it, a finger touches it or it gets
// keyboard focus, the target page's code chunk and its main data start loading, so by the time the
// click arrives both are usually in hand and the page draws without a loading block or skeleton.
//
// Data goes through the same deduped cache the pages read (lib/api.ts load), under the exact path
// the page will ask for, so a prefetch is never fetched twice and a hover over a link whose data is
// already fresh costs nothing. Only pages whose main request follows from the address alone are
// covered; the paths must match what those pages pass to useApi (pinned by prefetch.test.ts).
// Nothing is prefetched with Save-Data on, or for links to other sites, downloads or new tabs.
import { load, peek, qs } from "./api";
import { normalMatchKey } from "../shared/matchReport";
import { pageModule, type PageModule } from "../shared/routes";
import type { Meta } from "../shared/api";

/** A pointer must rest this long on a link before anything loads (sweeping across the sidebar loads nothing). */
export const HOVER_MS = 60;

const seg = (s: string) => { try { return decodeURIComponent(s); } catch { return null; } };

/** The API paths a page asks for first, from its address alone ([] when that needs more than the address). */
export function dataFor(url: URL, currentSeason: number | undefined): string[] {
  const p = url.pathname.replace(/(.)\/+$/, "$1");
  const q = url.searchParams;
  let m: RegExpExecArray | null;
  // TeamPage: /api/teams/:n?season=, and the season's matches when the address names the season.
  if ((m = /^\/teams\/(\d{1,6})$/i.exec(p))) {
    const team = Number(m[1]), season = q.get("season");
    if (team < 1) return [];
    return [`/api/teams/${team}${qs({ season })}`, ...(season && /^\d{4}$/.test(season) ? [`/api/teams/${team}/matches?season=${season}`] : [])];
  }
  // MatchReportPage: the report (src/lib/matchReport.ts matchReportPath).
  if ((m = /^\/events\/(\d+)\/([^/]+)\/match\/([^/]+)$/i.exec(p))) {
    const code = seg(m[2]), key = normalMatchKey(seg(m[3]));
    return code && key ? [`/api/events/${m[1]}/${encodeURIComponent(code)}/matches/${key}/report`] : [];
  }
  // EventPage: /api/events/:season/:code, as the router decodes them.
  if ((m = /^\/events\/(\d+)\/([^/]+)$/i.exec(p))) {
    const code = seg(m[2]);
    return code ? [`/api/events/${m[1]}/${code}`] : [];
  }
  // EventsPage: the season's list (the current season unless the address names one).
  if (/^\/events$/i.test(p)) {
    const season = Number(q.get("season")) || currentSeason;
    return season ? [`/api/events${qs({ season })}`] : [];
  }
  // RankingsPage with no filters.
  if (/^\/rankings$/i.test(p) && !url.search) return ["/api/rankings"];
  // PowerRankingsPage: the latest week (a past week's address names it).
  if (/^\/power-rankings$/i.test(p)) return ["/api/power-rankings"];
  return [];
}

type Conn = { saveData?: boolean };

/** Load a link's page code and main data ahead of the click. */
export function prefetchLink(a: HTMLAnchorElement, preload: (m: PageModule) => void): void {
  if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
  if ((navigator as Navigator & { connection?: Conn }).connection?.saveData) return;
  let url: URL;
  try { url = new URL(a.href, location.href); } catch { return; }
  if (url.origin !== location.origin || /^\/(api|packs)\//.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.search === location.search) return;
  const mod = pageModule(url.pathname);
  if (mod) preload(mod);
  for (const path of dataFor(url, peek<Meta>("/api/meta")?.currentSeason)) load(path).catch(() => { /* the page shows (and retries) it */ });
}

/** Listen for link intent anywhere in the document (one set of listeners for every link). Returns a stop function. */
export function installPrefetch(preload: (m: PageModule) => void): () => void {
  const link = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLAnchorElement>("a[href]") : null);
  let timer: number | undefined, pending: HTMLAnchorElement | null = null;
  const over = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const a = link(e.target);
    if (!a || a === pending) return;
    window.clearTimeout(timer);
    pending = a;
    timer = window.setTimeout(() => { pending = null; prefetchLink(a, preload); }, HOVER_MS);
  };
  const out = (e: PointerEvent) => {
    if (pending && !pending.contains(e.relatedTarget as Node | null)) { window.clearTimeout(timer); pending = null; }
  };
  const now = (e: Event) => { const a = link(e.target); if (a) prefetchLink(a, preload); };
  document.addEventListener("pointerover", over, { passive: true });
  document.addEventListener("pointerout", out, { passive: true });
  document.addEventListener("touchstart", now, { passive: true });
  document.addEventListener("pointerdown", now, { passive: true });
  document.addEventListener("focusin", now);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("pointerover", over);
    document.removeEventListener("pointerout", out);
    document.removeEventListener("touchstart", now);
    document.removeEventListener("pointerdown", now);
    document.removeEventListener("focusin", now);
  };
}
