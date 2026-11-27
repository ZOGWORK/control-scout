// The watch page: one video big, and what to watch next beside it, page after page (GET /api/videos/up-next/:videoId,
// server/api/upNext.ts). A creator video (Behind the Bot…): opened from a team's badge, that team's own episodes come
// first, then the rest of the series, newest first, without end. A match clip from the Videos feed: the feed itself
// carries on beside it. The player is youtube-nocookie with its message channel on (lib/ytBridge.ts), so the watch is
// reported at 5 s, half way and the end (lib/useWatchReports.ts), as the feed learns from.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { ChevronDown, Tv } from "lucide-react";
import { apiFetch } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { clipParams } from "../lib/streamSeek";
import { bridgedSrc } from "../lib/ytBridge";
import { useWatchReports, type Watched } from "../lib/useWatchReports";
import { feedPath } from "../lib/feedPath";
import { sentHistory } from "../lib/videoHistory";
import { seasonLabel } from "../lib/format";
import { encodeHistory, isFeedFilter, watchKindOf, type FeedAnswer, type FeedItem } from "../shared/videosFeed";
import { embedUrl, thumbnailUrl } from "../shared/stream";
import { clipTime } from "../shared/recording";
import { seriesLabel, type CreatorVideo } from "../shared/creatorVideos";
import { watchHref, type UpNextAnswer } from "../shared/watch";
import type { WatchState } from "../components/FeedCard";
import { ErrorState } from "../components/states";
import { ClipImage } from "../components/search/page/ClipImage";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";

const int = (s: string | null) => { const n = Number(s); return s != null && s !== "" && Number.isInteger(n) && n >= 0 ? n : null; };
const shortDate = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

interface Paged<T, A> { first: A | null; items: T[]; next: string | null; loading: boolean; error: unknown; retry: () => void; end: RefObject<HTMLDivElement | null> }

/** Loads the first page once per key, then each next page as the reader nears the list's end. */
function usePaged<T, A extends { next: string | null }>(key: string, fetchPage: (cursor: string | null) => Promise<A>, itemsOf: (a: A) => T[]): Paged<T, A> {
  const [s, set] = useState<{ first: A | null; items: T[]; next: string | null; loading: boolean; error: unknown }>({ first: null, items: [], next: null, loading: true, error: null });
  const asked = useRef(0);
  const load = useCallback(async (cursor: string | null) => {
    const ask = cursor ? asked.current : ++asked.current;
    set((p) => (cursor ? { ...p, loading: true, error: null } : { first: null, items: [], next: null, loading: true, error: null }));
    try {
      const a = await fetchPage(cursor);
      if (ask !== asked.current) return;
      set((p) => ({ first: cursor ? p.first : a, items: [...(cursor ? p.items : []), ...itemsOf(a)], next: a.next, loading: false, error: null }));
    } catch (e) {
      if (ask === asked.current) set((p) => ({ ...p, loading: false, error: e }));
    }
    // fetchPage and itemsOf follow the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void load(null); }, [load]);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = end.current;
    if (!el || !s.next || s.loading || s.error || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void load(s.next); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [s.next, s.loading, s.error, load]);
  return { ...s, retry: () => void load(s.items.length ? s.next : null), end };
}

/** One row of Up next: its picture, title and where it's from. */
function UpNextRow({ to, state, videoId, picture, title, meta, length, current }: { to: string; state?: WatchState; videoId: string; picture?: ReactNode; title: string; meta: string; length: number | null; current?: boolean }) {
  return (
    <li>
      <Link to={to} state={state} aria-current={current ? "page" : undefined} data-up-next={videoId}
        className={cn("group flex gap-3 rounded-xl p-1.5 outline-none transition-colors duration-150 hover:bg-ink/[0.05] active:bg-ink/[0.08] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none", current && "bg-ink/[0.06]")}>
        <span className="relative block aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-black sm:w-44">
          {picture ?? <img src={thumbnailUrl(videoId)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />}
          {length != null && length > 0 && <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-px text-[0.6875rem] font-medium tabular-nums text-white">{clipTime(length)}</span>}
          {current && <span className="absolute inset-0 grid place-items-center bg-black/55 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-white">Now playing</span>}
        </span>
        <span className="min-w-0 py-0.5">
          <span className="line-clamp-2 text-sm font-medium leading-5 text-text-base">{title}</span>
          {meta && <span className="mt-1 block truncate text-xs text-text-muted">{meta}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Loading rows, a retry, or the end, under a list; and the mark that loads the next page when it nears view. */
function UpNextTail({ up, done }: { up: Pick<Paged<unknown, unknown>, "loading" | "error" | "next" | "items" | "retry" | "end">; done: string }) {
  return (
    <>
      {up.loading && (
        <ul className="mt-1 space-y-1" aria-busy data-skeleton>
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex gap-3 p-1.5">
              <span className="aspect-video w-40 shrink-0 animate-pulse rounded-lg bg-ink/[0.06] motion-reduce:animate-none sm:w-44" />
              <span className="flex-1 space-y-2 py-1">
                <span className="block h-3.5 w-11/12 animate-pulse rounded bg-ink/[0.06] motion-reduce:animate-none" />
                <span className="block h-3 w-1/2 animate-pulse rounded bg-ink/[0.06] motion-reduce:animate-none" />
              </span>
            </li>
          ))}
        </ul>
      )}
      {!!up.error && <div className="px-1.5 py-3"><Button variant="outline" size="sm" onClick={up.retry}>Couldn't load more. Try again</Button></div>}
      {!up.loading && !up.error && !up.next && up.items.length > 0 && done && <p className="px-1.5 pt-3 text-xs text-text-faint">{done}</p>}
      <div ref={up.end} aria-hidden className="h-px" />
    </>
  );
}

const creatorMeta = (v: Pick<CreatorVideo, "channel" | "publishedAt">) => [v.channel, shortDate(v.publishedAt)].filter(Boolean).join(" · ");

/** Up next for a creator video: the team's own Behind the Bot episodes first (opened from its badge, the same count
 *  as the badge), then its other videos, then the rest of the series, endlessly. */
function CreatorUpNext({ videoId, team, up }: { videoId: string; team: number | null; up: Paged<CreatorVideo, UpNextAnswer> }) {
  const own = up.first?.team;
  const series = seriesLabel(up.first?.video?.series ?? "behind-the-bot") ?? "this series";
  const name = own ? `${own.number}${own.name ? ` ${own.name}` : ""}` : "";
  const episodes = own?.videos.filter((v) => v.series === "behind-the-bot") ?? [];
  const others = own?.videos.filter((v) => v.series !== "behind-the-bot") ?? [];
  const row = (v: CreatorVideo) => <UpNextRow key={v.videoId} to={watchHref(v.videoId, { team })} videoId={v.videoId} title={v.title} meta={creatorMeta(v)} length={v.durationS} current={v.videoId === videoId} />;
  return (
    <div className="space-y-7" data-up-next-list>
      {episodes.length > 0 && (
        <section aria-labelledby="up-next-team" data-up-next-team>
          <h2 id="up-next-team" className="mb-2 flex items-center gap-2 px-1.5 text-sm font-semibold text-text-base">
            <Tv className="size-4 shrink-0 text-accent-text" aria-hidden />
            <span className="min-w-0 truncate">{name} on Behind the Bot</span>
            {episodes.length > 1 && <span className="ml-auto shrink-0 bg-[#5b21b6] px-[3px] py-[2px] font-pixel text-[11px] leading-none text-[#e4dcfb]" data-up-next-count>×{episodes.length}</span>}
          </h2>
          <ul className="space-y-1">{episodes.map(row)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="up-next-team-more" data-up-next-team-more>
          <h2 id="up-next-team-more" className="mb-2 px-1.5 text-sm font-semibold text-text-base">More with {name}</h2>
          <ul className="space-y-1">{others.map(row)}</ul>
        </section>
      )}
      <section aria-labelledby="up-next-more">
        <h2 id="up-next-more" className="mb-2 px-1.5 text-sm font-semibold text-text-base">{own && own.videos.length ? `More ${series}` : "Up next"}</h2>
        <ul className="space-y-1">
          {up.items.map((v) => <UpNextRow key={v.videoId} to={watchHref(v.videoId, { team })} videoId={v.videoId} title={v.title} meta={creatorMeta(v)} length={v.durationS} />)}
        </ul>
        <UpNextTail up={up} done={`That's every ${series} episode.`} />
      </section>
    </div>
  );
}

/** Up next for a match clip: the person's own Videos feed carries on beside it. */
function FeedUpNext({ videoId, filter }: { videoId: string; filter: string | undefined }) {
  const f = isFeedFilter(filter) ? filter : "all";
  const { state: personal, user } = usePersonal();
  const device = useMemo(() => (user ? null : {
    myTeam: personal.myTeam,
    teams: [...new Set([...personal.tracked.teams, ...personal.bookmarks])].filter((n) => n !== personal.myTeam),
    history: encodeHistory(sentHistory()),
  }), [user, personal.myTeam, personal.tracked.teams, personal.bookmarks]);
  const up = usePaged<FeedItem, FeedAnswer>(`feed|${f}|${!!user}`, (c) => apiFetch<FeedAnswer>(feedPath(f, c, device)), (a) => a.items);
  return (
    <section aria-labelledby="up-next-feed" data-up-next-list>
      <h2 id="up-next-feed" className="mb-2 px-1.5 text-sm font-semibold text-text-base">Up next</h2>
      <ul className="space-y-1">
        {up.items.filter((i) => !i.youtubeOnly && i.videoId !== videoId).map((i) => (
          <UpNextRow key={i.key} to={watchHref(i.videoId, { t: i.t, end: i.end })} state={{ item: i, filter: f }} videoId={i.videoId} picture={<ClipImage v={i} />} title={i.title}
            meta={[i.reason, i.event?.name ?? i.channel].filter(Boolean).join(" · ")} length={i.end != null && i.end > i.t ? i.end - i.t : i.duration ?? null} />
        ))}
      </ul>
      <UpNextTail up={up} done="You've reached the end of your feed." />
    </section>
  );
}

export default function WatchPage() {
  const { videoId = "" } = useParams();
  const [sp] = useSearchParams();
  const loc = useLocation();
  const t = int(sp.get("t")) ?? 0;
  const end = int(sp.get("end"));
  const team = int(sp.get("team")) || null;
  const state = loc.state as WatchState | null;
  const fromFeed = state?.item && state.item.videoId === videoId ? state.item : null;
  const { user } = usePersonal();
  const valid = /^[A-Za-z0-9_-]{11}$/.test(videoId);

  const up = usePaged<CreatorVideo, UpNextAnswer>(`${videoId}|${team ?? ""}`,
    (c) => apiFetch<UpNextAnswer>(`/api/videos/up-next/${encodeURIComponent(videoId)}${team || c ? `?${new URLSearchParams({ ...(team ? { team: String(team) } : {}), ...(c ? { cursor: c } : {}) })}` : ""}`),
    (a) => a.items);
  const creator = up.first?.video ?? null;
  const title = fromFeed?.title ?? creator?.title ?? (up.loading ? "" : "Video");
  useTitle(title || "Watch");
  useEffect(() => { window.scrollTo({ top: 0 }); }, [videoId, t]);

  const frame = useRef<HTMLIFrameElement | null>(null);
  const watched: Watched | null = fromFeed
    ? { key: fromFeed.key, kind: watchKindOf(fromFeed), t: fromFeed.t, end: fromFeed.end, duration: fromFeed.duration }
    : creator ? { key: `c:${creator.videoId}`, kind: creator.series === "behind-the-bot" ? "behindTheBot" : "creator", t: 0, duration: creator.durationS ?? undefined } : null;
  useWatchReports(frame, watched, !!user);

  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [videoId]);
  if (!valid) return <ErrorState error={new Error("That isn't a video we can play.")} />;
  const series = seriesLabel(creator?.series);
  const meta = [creator?.channel ?? fromFeed?.channel ?? fromFeed?.event?.name, shortDate(creator?.publishedAt ?? fromFeed?.published), creator?.season != null ? seasonLabel(creator.season) : null].filter(Boolean).join(" · ");
  const teams = creator?.teams ?? fromFeed?.teams ?? [];

  return (
    <div className="grid gap-x-8 gap-y-10 pt-2 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_26rem]" data-watch-page>
      <div className="min-w-0">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
          <iframe key={`${videoId}:${t}:${end ?? ""}`} ref={frame} className="absolute inset-0 size-full" title={title ? `${title} video` : "Video"}
            src={bridgedSrc(embedUrl(videoId), { autoplay: 1, rel: 0, playsinline: 1, ...clipParams({ t, end }) })}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" data-watch-player />
        </div>
        <div className="mt-4">
          {title ? <h1 className="text-pretty text-xl font-semibold leading-7 tracking-tight text-text-base" data-watch-title>{title}</h1>
            : <div className="h-7 w-2/3 animate-pulse rounded bg-ink/[0.06] motion-reduce:animate-none" />}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-text-muted">
            {series && <span className="rounded-md border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-text">{series}</span>}
            {meta && <span>{meta}</span>}
            {fromFeed?.href && <Link to={fromFeed.href} className="font-medium text-text-base underline-offset-2 hover:underline">Match details</Link>}
          </div>
          {teams.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5" data-watch-teams>
              {teams.slice(0, 12).map((n) => <Link key={n} to={`/teams/${n}`} className="rounded-full border border-ink/[0.12] px-2.5 py-1 text-xs font-medium tabular-nums text-text-muted transition-[color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-ink/25 hover:text-text-base active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100">Team {n}</Link>)}
            </div>
          )}
          {creator?.description && (
            <div className="mt-4 rounded-xl bg-ink/[0.04] p-3.5">
              <p className={cn("whitespace-pre-line break-words text-sm leading-6 text-text-muted", !more && "line-clamp-3")} data-watch-description>{creator.description}</p>
              <button type="button" onClick={() => setMore((m) => !m)} className="tap-44 mt-1 inline-flex items-center gap-1 text-sm font-medium text-text-base hover:underline" aria-expanded={more}>
                {more ? "Show less" : "Show more"}<ChevronDown className={cn("size-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none", more && "rotate-180")} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
      <aside aria-label="Up next" className="min-w-0">
        {up.error && !up.first ? <ErrorState error={up.error as Error} onRetry={up.retry} />
          : up.loading && !up.first ? <UpNextTail up={up} done="" />
          : creator ? <CreatorUpNext videoId={videoId} team={team} up={up} />
          : <FeedUpNext videoId={videoId} filter={state?.filter} />}
      </aside>
    </div>
  );
}
