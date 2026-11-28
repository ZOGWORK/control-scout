// The library's own pages in the Videos area (pages/VideosPage.tsx): Watch later, Saved and History as the feed's
// cards (each one's ✕ takes it off that list), and Notes, every note grouped under its video, newest first, each a
// tap from the moment it was written at. Pages load as the reader nears the end, like the feed.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Clock, History, NotebookPen } from "lucide-react";
import { clearList, libraryPage, notesPage, setInList, useLibraryVersion } from "../../lib/videoLibrary";
import { LIBRARY_LABEL, noteTime, type LibraryEntry, type LibraryList, type VideoNote } from "../../shared/videoLibrary";
import { watchHref } from "../../shared/watch";
import { FeedCard, type WatchState } from "../FeedCard";
import { ClipImage } from "../search/page/ClipImage";
import { ErrorState } from "../states";
import { Button } from "../ui/button";
import { cn } from "../cn";

const EMPTY: Record<LibraryList | "notes", { icon: typeof Clock; text: string }> = {
  later: { icon: Clock, text: "Nothing to watch later yet. Tap Watch later under a video to queue it here." },
  saved: { icon: Bookmark, text: "No saved videos yet. Tap Save under a video to keep it here." },
  history: { icon: History, text: "Videos you watch show up here." },
  notes: { icon: NotebookPen, text: "No notes yet. Open a video and write what you notice: each note keeps the moment it's about, and your team sees it too." },
};
const REMOVE: Record<LibraryList, string> = { later: "Remove from Watch later", saved: "Remove from Saved", history: "Remove from History" };

function Empty({ of }: { of: LibraryList | "notes" }) {
  const { icon: Icon, text } = EMPTY[of];
  return (
    <div className="grid place-items-center gap-3 rounded-xl border border-line bg-card px-6 py-12 text-center" data-library-empty={of}>
      <Icon className="size-8 text-text-faint" aria-hidden />
      <p className="max-w-sm text-sm text-text-muted">{text}</p>
      <Button asChild variant="outline"><Link to="/videos">Browse videos</Link></Button>
    </div>
  );
}

/** Pages of something, loaded one after another as the reader nears the end. A new `what` starts afresh; a new
 *  `version` of the same (the library changed) reads it again in place, keeping what's shown until the answer, and
 *  as far down as was shown: a change on item 60 doesn't cut the list back to its first page. */
function usePages<T>(what: string, version: number, read: (cursor: string | null) => Promise<{ items: T[]; next: string | null }>) {
  const [s, set] = useState<{ what: string; items: T[]; next: string | null; loading: boolean; error: unknown }>({ what, items: [], next: null, loading: true, error: null });
  const asked = useRef(0);
  // How many are shown now, of what: a read again of the same goes as far.
  const shown = useRef({ what, n: 0 });
  shown.current = { what: s.what, n: s.items.length };
  const load = useCallback(async (cursor: string | null) => {
    const ask = cursor ? asked.current : ++asked.current;
    const want = !cursor && shown.current.what === what ? shown.current.n : 0;
    set((p) => (cursor || p.what === what ? { ...p, loading: true, error: null } : { what, items: [], next: null, loading: true, error: null }));
    try {
      let a = await read(cursor);
      const items = [...a.items];
      // At most 20 pages more, so a list that keeps growing under it can't read forever.
      for (let i = 0; i < 20 && a.next && items.length < want; i++) { a = await read(a.next); items.push(...a.items); }
      if (ask === asked.current) set((p) => ({ what, items: [...(cursor ? p.items : []), ...items], next: a.next, loading: false, error: null }));
    } catch (e) { if (ask === asked.current) set((p) => ({ ...p, loading: false, error: e })); }
    // `read` follows `what` and `version`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what, version]);
  useEffect(() => { void load(null); }, [load]);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !s.next || s.loading || s.error || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void load(s.next); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [s.next, s.loading, s.error, load]);
  const fresh = s.what === what;
  return { items: fresh ? s.items : [], next: fresh ? s.next : null, loading: fresh ? s.loading : true, error: fresh ? s.error : null, end, retry: () => void load(fresh && s.items.length ? s.next : null) };
}

const grid = (cols: number) => cn("grid gap-x-6 gap-y-10", cols >= 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1");

function Skeleton({ cols }: { cols: number }) {
  return (
    <div className={grid(cols)} aria-busy data-skeleton>
      {Array.from({ length: cols * 2 }, (_, i) => <div key={i} className="space-y-3"><div className="aspect-video animate-pulse rounded-xl bg-ink/[0.05] motion-reduce:animate-none" /><div className="h-4 w-3/4 animate-pulse rounded bg-ink/[0.05] motion-reduce:animate-none" /></div>)}
    </div>
  );
}

/** Watch later, Saved or History. */
export function LibraryListView({ list, signedIn, cols }: { list: LibraryList; signedIn: boolean; cols: number }) {
  const v = useLibraryVersion();
  // A removal fades its card out at once; the list then reads again in place.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const pages = usePages<LibraryEntry>(`${list}|${signedIn}`, v, (c) => libraryPage(signedIn, list, c).then((p) => ({ items: p.items, next: p.next })));
  const shown = pages.items.filter((e) => !gone.has(e.item.key));
  const remove = (e: LibraryEntry) => {
    setGone((g) => new Set(g).add(e.item.key));
    void setInList(signedIn, list, e.item, false).catch(() => setGone((g) => { const n = new Set(g); n.delete(e.item.key); return n; }));
  };
  const [clearing, setClearing] = useState(false);
  const [clearFailed, setClearFailed] = useState(false);

  return (
    <section aria-label={LIBRARY_LABEL[list]} data-library-list={list}>
      {list === "history" && shown.length > 0 && (
        <div className="-mt-4 mb-6 flex items-center justify-end gap-3">
          {clearFailed && <p className="text-xs text-text-muted" role="alert">Couldn't clear your history. Try again.</p>}
          <Button variant="ghost" size="sm" disabled={clearing} onClick={() => {
            setClearing(true); setClearFailed(false);
            void clearList(signedIn, "history").catch(() => setClearFailed(true)).finally(() => setClearing(false));
          }}>Clear history</Button>
        </div>
      )}
      {pages.error && !pages.items.length ? <ErrorState error={pages.error as Error} onRetry={pages.retry} />
        : !pages.loading && !shown.length ? <Empty of={list} />
        : (
          <>
            <div className={grid(cols)}>
              {shown.map((e) => <FeedCard key={e.item.key} item={e.item} signedIn={signedIn} remove={REMOVE[list]} inList={list} onHide={() => remove(e)} />)}
            </div>
            {pages.loading && <div className={shown.length ? "mt-10" : ""}><Skeleton cols={cols} /></div>}
            {!!pages.error && pages.items.length > 0 && <div className="py-4 text-center"><Button variant="outline" onClick={pages.retry}>Couldn't load more. Try again</Button></div>}
            <div ref={pages.end} aria-hidden className="h-px" />
          </>
        )}
    </section>
  );
}

/** Every note, grouped under its video (a video's notes in the order they come in the video). */
export function NotesView({ signedIn }: { signedIn: boolean }) {
  const v = useLibraryVersion();
  const pages = usePages<VideoNote>(`notes|${signedIn}`, v, (c) => notesPage(signedIn, c).then((p) => ({ items: p.notes, next: p.next })));
  const groups: { key: string; notes: VideoNote[] }[] = [];
  for (const n of pages.items) {
    const g = groups.find((x) => x.key === n.key);
    if (g) g.notes.push(n); else groups.push({ key: n.key, notes: [n] });
  }
  for (const g of groups) g.notes.sort((a, b) => (a.t == null ? 1 : 0) - (b.t == null ? 1 : 0) || (a.t ?? 0) - (b.t ?? 0));

  return (
    <section aria-label="Notes" data-library-notes>
      {pages.error && !pages.items.length ? <ErrorState error={pages.error as Error} onRetry={pages.retry} />
        : !pages.loading && !pages.items.length ? <Empty of="notes" />
        : (
          <div className="space-y-4">
            {groups.map((g) => {
              const item = g.notes[0].item;
              return (
                <article key={g.key} className="grid gap-4 rounded-2xl border border-line bg-card p-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:p-4" data-notes-video={g.key}>
                  <Link to={watchHref(item.videoId, { t: item.t, end: item.end })} state={{ item } satisfies WatchState} className="group/play relative block aspect-video overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Watch ${item.title}`}>
                    <ClipImage v={item} />
                  </Link>
                  <div className="min-w-0">
                    <Link to={watchHref(item.videoId, { t: item.t, end: item.end })} state={{ item } satisfies WatchState} className="line-clamp-2 text-[0.9375rem] font-semibold leading-5 text-text-base hover:underline">{item.title}</Link>
                    {(item.channel ?? item.event?.name) && <p className="mt-1 truncate text-xs text-text-muted">{item.channel ?? item.event?.name}</p>}
                    <ul className="mt-3 space-y-2">
                      {g.notes.map((n) => (
                        <li key={n.id} className="flex gap-3 text-sm leading-6">
                          {n.t != null
                            ? <Link to={watchHref(n.videoId, { t: n.t })} state={{ item: n.item } satisfies WatchState} className="h-6 shrink-0 rounded-md bg-accent/15 px-1.5 text-xs font-semibold leading-6 tabular-nums text-accent-text transition-colors duration-150 hover:bg-accent/25" aria-label={`Watch from ${noteTime(n.t)}`}>{noteTime(n.t)}</Link>
                            : <span className="h-6 shrink-0 rounded-md bg-ink/[0.06] px-1.5 text-xs font-medium leading-6 text-text-faint">Video</span>}
                          <div className="min-w-0">
                            {n.author && !n.author.mine && <p className="text-xs font-medium leading-5 text-text-muted">{n.author.name}{n.author.team ? <span className="font-normal text-text-faint"> · {n.author.team}</span> : null}</p>}
                            <p className="whitespace-pre-line break-words text-text-base">{n.body}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
            {pages.loading && <div className="h-40 animate-pulse rounded-2xl bg-ink/[0.05] motion-reduce:animate-none" aria-busy data-skeleton />}
            {!!pages.error && pages.items.length > 0 && <div className="py-4 text-center"><Button variant="outline" onClick={pages.retry}>Couldn't load more. Try again</Button></div>}
            <div ref={pages.end} aria-hidden className="h-px" />
          </div>
        )}
    </section>
  );
}
