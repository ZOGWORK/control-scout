// The Videos area's frame (pages/VideosPage.tsx, pages/WatchPage.tsx): the page, and the person's library beside it
// on a button. Nothing sits there until it's opened: then a panel slides in from the right and the page makes room
// (the feed goes from three videos a row to two; the watch page moves Up next under the video). On a phone it's a
// sheet over the page instead. Whether it's open is remembered on this device, so it stays open from page to page.
//
// The panel: Home, Watch later, Saved, History and Notes with their counts, and the latest notes, each a tap from the
// moment it was written at.
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Clock, History, Home, Library, NotebookPen, PanelRightClose, Bookmark } from "lucide-react";
import { usePersonal } from "../../lib/personal";
import { libraryCounts, notesPage, useLibraryVersion } from "../../lib/videoLibrary";
import { LIBRARY_LABEL, libraryPath, libraryViewOf, noteTime, type LibraryCounts, type LibraryView, type VideoNote } from "../../shared/videoLibrary";
import { watchHref } from "../../shared/watch";
import type { WatchState } from "../FeedCard";
import { Sheet, SheetContent, SheetTitle } from "../ui/overlay";
import { cn } from "../cn";

const PANEL_KEY = "cs-videos-panel";
const WIDE = "(min-width: 1024px)";
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

const readOpen = () => { try { return localStorage.getItem(PANEL_KEY) === "1"; } catch { return false; } };
const subscribeWide = (cb: () => void) => {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const wideNow = () => typeof window !== "undefined" && !!window.matchMedia?.(WIDE).matches;

interface Frame { open: boolean; wide: boolean; setOpen: (o: boolean) => void }
const FrameContext = createContext<Frame>({ open: false, wide: false, setOpen: () => {} });
/** The panel is open beside the page (not over it): the page has less room. */
export const usePanelBeside = () => { const f = useContext(FrameContext); return f.open && f.wide; };
export const useVideosFrame = () => useContext(FrameContext);

/** The library button: opens and closes the panel. */
export function LibraryButton({ className }: { className?: string }) {
  const { open, setOpen } = useVideosFrame();
  return (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="videos-library"
      className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
        open ? "border-ink/[0.16] bg-ink/[0.08] text-text-base" : "border-ink/[0.12] text-text-muted hover:bg-ink/[0.04] hover:text-text-base", className)}
      data-library-toggle>
      <Library className="size-4" aria-hidden />You
    </button>
  );
}

export function VideosFrame({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  // Read after the first paint: the server draws it closed, and so does a device that never opened it.
  useEffect(() => { setOpenState(readOpen()); }, []);
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => false);
  const setOpen = useCallback((o: boolean) => {
    setOpenState(o);
    try { localStorage.setItem(PANEL_KEY, o ? "1" : "0"); } catch { /* this page only */ }
  }, []);
  const loc = useLocation();
  // On a phone the sheet closes once a place in it is picked.
  useEffect(() => { if (!wideNow()) setOpenState(false); }, [loc.pathname]);

  return (
    <FrameContext.Provider value={{ open, wide, setOpen }}>
      <div className={cn("grid transition-[grid-template-columns] duration-300 motion-reduce:transition-none", EASE,
        open && wide ? "grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_18.5rem]" : "grid-cols-[minmax(0,1fr)_0rem]")} data-videos-frame data-panel={open && wide ? "open" : "closed"}>
        <div className="min-w-0">{children}</div>
        {wide && (
          <div className="relative min-w-0 overflow-hidden" aria-hidden={!open || undefined} inert={!open || undefined}>
            <aside id="videos-library" aria-label="Your videos"
              className={cn("sticky top-[calc(var(--header-h)+1rem)] ml-6 w-[calc(100%-1.5rem)] transition-[opacity,transform] duration-300 motion-reduce:transition-none", EASE,
                open ? "translate-x-0 opacity-100" : "translate-x-6 opacity-0")}>
              <LibraryPanel />
            </aside>
          </div>
        )}
      </div>
      {!wide && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent id="videos-library" side="right" className="w-[min(22rem,88vw)] sm:max-w-sm" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Your videos</SheetTitle>
            <LibraryPanel inSheet />
          </SheetContent>
        </Sheet>
      )}
    </FrameContext.Provider>
  );
}

const PLACES: { view: LibraryView; icon: typeof Home; count?: keyof LibraryCounts }[] = [
  { view: "home", icon: Home },
  { view: "later", icon: Clock, count: "later" },
  { view: "saved", icon: Bookmark, count: "saved" },
  { view: "history", icon: History },
  { view: "notes", icon: NotebookPen, count: "notes" },
];

function LibraryPanel({ inSheet }: { inSheet?: boolean }) {
  const { user, accountAnswered, providers } = usePersonal();
  const ready = accountAnswered || providers != null;
  const signedIn = !!user;
  const v = useLibraryVersion();
  const { setOpen } = useVideosFrame();
  const path = useLocation().pathname;
  // On a watch page none of them is the current place.
  const here = /^\/videos(\/|$)/i.test(path) ? libraryViewOf(path) : null;
  const [counts, setCounts] = useState<LibraryCounts | null>(null);
  const [latest, setLatest] = useState<VideoNote[]>([]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    void libraryCounts(signedIn).then((c) => { if (live) setCounts(c); }).catch(() => {});
    void notesPage(signedIn, null).then((p) => { if (live) setLatest(p.notes.slice(0, 3)); }).catch(() => {});
    return () => { live = false; };
  }, [ready, signedIn, v]);

  return (
    <div className={cn("flex flex-col gap-5", !inSheet && "rounded-2xl border border-line bg-card p-3")} data-library-panel>
      <div className="flex items-center justify-between gap-2 px-2 pt-1">
        <h2 className="text-sm font-semibold text-text-base">You</h2>
        {!inSheet && (
          <button type="button" onClick={() => setOpen(false)} className="inline-flex size-8 items-center justify-center rounded-lg text-text-faint transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-ink/[0.06] hover:text-text-base active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100" aria-label="Close your videos">
            <PanelRightClose className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <nav aria-label="Your videos" className="-mt-2">
        <ul className="space-y-0.5">
          {PLACES.map(({ view, icon: Icon, count }) => {
            const n = count && counts ? counts[count] : 0;
            return (
              <li key={view}>
                <Link to={libraryPath(view)} aria-current={here === view ? "page" : undefined}
                  className={cn("flex h-10 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-150",
                    here === view ? "bg-ink/[0.08] font-semibold text-text-base" : "text-text-muted hover:bg-ink/[0.05] hover:text-text-base")}
                  data-library-link={view}>
                  <Icon className="size-[1.125rem] shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{LIBRARY_LABEL[view]}</span>
                  {n > 0 && <span className="text-xs tabular-nums text-text-faint">{n}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {latest.length > 0 && (
        <section aria-labelledby="library-latest-notes" className="border-t border-line pt-4">
          <h3 id="library-latest-notes" className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-text-faint">Latest notes</h3>
          <ul className="space-y-1">
            {latest.map((n) => (
              <li key={n.id}>
                <Link to={watchHref(n.videoId, { t: n.t ?? 0 })} state={{ item: n.item } satisfies WatchState} className="block rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-ink/[0.05]">
                  <span className="line-clamp-2 text-sm text-text-base">{n.body}</span>
                  <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-faint">
                    {n.t != null && <span className="shrink-0 font-medium tabular-nums text-accent-text">{noteTime(n.t)}</span>}
                    <span className="truncate">{n.author && !n.author.mine ? `${n.author.name} · ` : ""}{n.item.title}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="px-2 pb-1 text-xs leading-5 text-text-faint">
        {!ready ? " " : signedIn ? "Your lists are yours alone. Notes are shared with your Control Point team." : "Kept on this device. Sign in to keep them on your account."}
      </p>
    </div>
  );
}
