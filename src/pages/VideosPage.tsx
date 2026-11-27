// Videos: one feed of FTC videos that all play in the app, different for every person (GET /api/videos/feed,
// server/api/videosFeed.ts). Match clips of their teams, this weekend's streams, top plays, close finishes, upsets
// our call got wrong, creator videos and Behind the Bot episodes, each card saying why it's there. Pages load by
// cursor as the reader nears the end, in the app's windowed list (components/ui/windowing.tsx). Signed out, the
// device's own teams and watch history (lib/videoHistory.ts) shape it; nothing about them is kept on the server.
//
// The person's own library is a button away (components/videos/VideosFrame.tsx): a panel slides in beside the feed
// (two videos a row then), and /videos/later, /saved, /history and /notes are its pages (components/videos/LibraryViews.tsx).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { MonitorPlay } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { sentHistory } from "../lib/videoHistory";
import { FeedCard } from "../components/FeedCard";
import { feedPath } from "../lib/feedPath";
import { ErrorState } from "../components/states";
import { Button } from "../components/ui/button";
import { Spacer, useVirtualRows } from "../components/ui/windowing";
import { cn } from "../components/cn";
import { LibraryButton, usePanelBeside, VideosFrame } from "../components/videos/VideosFrame";
import { LibraryListView, NotesView } from "../components/videos/LibraryViews";
import { LIBRARY_LABEL, libraryViewOf } from "../shared/videoLibrary";
import { encodeHistory, FEED_FILTERS, isFeedFilter, type FeedAnswer, type FeedFilter, type FeedItem } from "../shared/videosFeed";

/** Cards a row: 1 on a phone, 2 from 640 px, 3 from 1100 px. */
const COLS: [string, number][] = [["(min-width: 1100px)", 3], ["(min-width: 640px)", 2]];
const colsNow = () => (typeof window === "undefined" || !window.matchMedia ? 1 : COLS.find(([q]) => window.matchMedia(q).matches)?.[1] ?? 1);
const subscribeCols = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const ms = COLS.map(([q]) => window.matchMedia(q));
  for (const m of ms) m.addEventListener("change", cb);
  return () => { for (const m of ms) m.removeEventListener("change", cb); };
};
/** With the library open beside it, a row holds at most two. */
const useCols = () => { const n = useSyncExternalStore(subscribeCols, colsNow, () => 1); return usePanelBeside() ? Math.min(n, 2) : n; };

export { feedPath };

interface Feed { items: FeedItem[]; next: string | null; loading: boolean; error: unknown; empty?: string; coldStart: boolean }
const START: Feed = { items: [], next: null, loading: true, error: null, coldStart: false };

export default function VideosPage() {
  return <VideosFrame><VideosBody /></VideosFrame>;
}

const VIEW_SUMMARY = {
  later: "Videos you've set aside for later.",
  saved: "Videos you've kept.",
  history: "What you've watched, newest first.",
  notes: "What you and your team noted while watching, each at its moment in the video.",
} as const;

function VideosBody() {
  const view = libraryViewOf(useLocation().pathname);
  useTitle(view === "home" ? "FTC videos" : LIBRARY_LABEL[view]);
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("filter");
  const filter: FeedFilter = isFeedFilter(raw) ? raw : "all";
  const { state: personal, user, accountAnswered, providers } = usePersonal();
  // The account's answer is in (or failed: then it's this device's own).
  const ready = accountAnswered || providers != null;
  const signedIn = !!user;
  const device = useMemo(() => (signedIn ? null : {
    myTeam: personal.myTeam,
    teams: [...new Set([...personal.tracked.teams, ...personal.bookmarks])].filter((n) => n !== personal.myTeam),
    history: encodeHistory(sentHistory()),
  }), [signedIn, personal.myTeam, personal.tracked.teams, personal.bookmarks]);
  const [feed, setFeed] = useState<Feed>(START);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const asked = useRef(0);

  const load = useCallback(async (cursor: string | null) => {
    const ask = cursor ? asked.current : ++asked.current;
    setFeed((f) => (cursor ? { ...f, loading: true, error: null } : { ...START }));
    try {
      const a = await apiFetch<FeedAnswer>(feedPath(filter, cursor, device));
      if (ask !== asked.current) return;
      setFeed((f) => {
        // A page read after the list was built afresh can repeat an item: each shown once.
        const have = new Set(cursor ? f.items.map((i) => i.key) : []);
        return { items: [...(cursor ? f.items : []), ...a.items.filter((i) => !have.has(i.key))], next: a.next, loading: false, error: null, empty: a.empty, coldStart: a.coldStart };
      });
    } catch (e) {
      if (ask === asked.current) setFeed((f) => ({ ...f, loading: false, error: e }));
    }
    // The device's history is read once per list (a watch mid-list doesn't rebuild it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, signedIn, personal.myTeam, personal.tracked.teams, personal.bookmarks]);

  // Wait for the account's answer, so a signed-in reader's feed is asked for once, as theirs.
  useEffect(() => { if (ready && view === "home") void load(null); }, [ready, view, load]);

  const shown = feed.items.filter((i) => !hidden.has(i.key));
  const cols = useCols();
  const rows = useMemo(() => { const out: FeedItem[][] = []; for (let i = 0; i < shown.length; i += cols) out.push(shown.slice(i, i + cols)); return out; }, [shown, cols]);
  const vr = useVirtualRows<HTMLDivElement>(rows.length, cols === 1 ? 380 : 350, { key: (i) => rows[i][0].key, cache: `videos|${filter}|${cols}` });

  // The next page as the reader nears the end.
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !feed.next || feed.loading || feed.error || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void load(feed.next); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [feed.next, feed.loading, feed.error, load]);

  const pick = (f: FeedFilter) => {
    const q = new URLSearchParams(sp);
    if (f === "all") q.delete("filter"); else q.set("filter", f);
    setSp(q, { replace: true });
  };
  const summary = feed.coldStart ? "The best of FTC right now, from every event. Follow a team to make it yours." : "Picked for you from your teams and what you watch.";

  return (
    <div data-videos-page>
      <header className="mb-6 mt-2 flex items-start justify-between gap-4 sm:mt-4">
        <div className="min-w-0">
          <h1 className="text-[1.375rem] font-semibold leading-7 tracking-tight text-text-base">{view === "home" ? "Videos" : LIBRARY_LABEL[view]}</h1>
          <p className="mt-1 text-sm text-text-muted" data-videos-summary>{view !== "home" ? VIEW_SUMMARY[view] : feed.loading && !feed.items.length ? "Match clips, streams and creator videos, all played here." : summary}</p>
        </div>
        <LibraryButton />
      </header>
      {view === "later" || view === "saved" || view === "history" ? <LibraryListView list={view} signedIn={signedIn} cols={cols} />
        : view === "notes" ? <NotesView signedIn={signedIn} />
        : <>
      <div role="tablist" aria-label="Show" className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-videos-filters>
        {FEED_FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => pick(f.id)}
            className={cn("h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
              filter === f.id ? "border-accent bg-accent text-accent-ink" : "border-ink/[0.12] text-text-muted hover:bg-ink/[0.04] hover:text-text-base")}>{f.label}</button>
        ))}
      </div>
      {feed.error && !feed.items.length ? (
        <ErrorState error={feed.error as Error} onRetry={() => void load(null)} />
      ) : !feed.loading && !shown.length ? (
        <div className="grid place-items-center gap-3 rounded-xl border border-line bg-card px-6 py-12 text-center" data-videos-empty>
          <MonitorPlay className="size-8 text-text-faint" aria-hidden />
          <p className="max-w-sm text-sm text-text-muted">{feed.empty ?? "Nothing left here: you've seen it all."}</p>
          {filter !== "all" && <Button variant="outline" onClick={() => pick("all")}>Show all videos</Button>}
        </div>
      ) : (
        <div ref={vr.ref} data-videos-feed>
          <Spacer as="div" height={vr.paddingTop} />
          {vr.rows(rows).map(({ item: row, rowProps, gapBefore }) => (
            <div key={row[0].key}>
              {gapBefore > 0 && <Spacer as="div" height={gapBefore} />}
              <div {...rowProps} className={cn("grid gap-x-6 pb-10", cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1")}>
                {row.map((i) => <FeedCard key={i.key} item={i} signedIn={signedIn} filter={filter} onHide={(k) => setHidden((h) => new Set(h).add(k))} />)}
              </div>
            </div>
          ))}
          <Spacer as="div" height={vr.paddingBottom} />
          {feed.loading && <div className={cn("grid gap-x-6 gap-y-10", cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1")} aria-busy data-skeleton>
            {Array.from({ length: cols * 2 }, (_, i) => <div key={i} className="space-y-3"><div className="aspect-video animate-pulse rounded-xl bg-ink/[0.05] motion-reduce:animate-none" /><div className="h-4 w-3/4 animate-pulse rounded bg-ink/[0.05] motion-reduce:animate-none" /></div>)}
          </div>}
          {!!feed.error && feed.items.length > 0 && <div className="py-4 text-center"><Button variant="outline" onClick={() => void load(feed.next)}>Couldn't load more. Try again</Button></div>}
          <div ref={end} aria-hidden className="h-px" />
        </div>
      )}
        </>}
    </div>
  );
}
