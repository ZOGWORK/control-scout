// A team featured in a creator video (src/shared/creatorVideos.ts, server/videos/creatorVideos.ts): the public
// "Featured on Behind the Bot" badge in the team page's header, the page's Featured in section listing each video, and
// the small chip on team rows (search results, event team lists, rankings). Everyone sees them, signed in or not, and
// every tap plays the video in the app's dialog (lib/streamSeek.ts), never a jump to YouTube.
import { Clapperboard, Play } from "lucide-react";
import { Section } from "./page";
import { cn } from "./cn";
import { useApi } from "../lib/api";
import { playInDialog } from "../lib/streamSeek";
import { seasonLabel } from "../lib/format";
import { thumbnailUrl } from "../shared/stream";
import { watchUrl } from "../shared/recording";
import { seriesLabel, type FeaturedVideo } from "../shared/creatorVideos";

/** In the app's dialog; on YouTube in a new tab only where the dialog isn't mounted. */
const play = (v: FeaturedVideo) => {
  if (!playInDialog({ videoId: v.videoId, t: 0, label: v.title, highlight: true })) window.open(watchUrl(v.videoId), "_blank", "noopener,noreferrer");
};

/** Behind the Bot's episodes about this team, newest first. */
const episodes = (featured: readonly FeaturedVideo[] | undefined) => (featured ?? []).filter((v) => v.series === "behind-the-bot");

/**
 * The header's badge: "Featured on Behind the Bot", playing the episode in the app. A team on more than one season's
 * Behind the Bot gets one badge per episode, each with its season.
 */
export function FeaturedBadge({ featured, className }: { featured: readonly FeaturedVideo[] | undefined; className?: string }) {
  const list = episodes(featured);
  if (!list.length) return null;
  const several = new Set(list.map((v) => v.season)).size > 1;
  return (
    <div className={cn("flex flex-wrap gap-2", className)} data-featured-badges>
      {list.map((v) => (
        <button key={v.videoId} type="button" onClick={() => play(v)} title={`Play "${v.title}"`} data-featured-badge={v.videoId}
          className="tap-44 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 pl-2 pr-3 text-xs font-medium text-text-base outline-none transition-colors hover:bg-accent/[0.16] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-sm:min-h-10">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"><Play className="size-3 translate-x-px fill-current" aria-hidden /></span>
          <span className="truncate">Featured on Behind the Bot{several && v.season != null ? ` · ${seasonLabel(v.season)}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

/** Featured in: every creator video whose title names the team, each playing in the app. Closed at first. */
export function FeaturedSection({ featured }: { featured: readonly FeaturedVideo[] | undefined }) {
  const list = featured ?? [];
  if (!list.length) return null;
  return (
    <Section id="featured" collapsible icon={Clapperboard} title="Featured in" count={`${list.length} video${list.length === 1 ? "" : "s"}`}
      summary={`${list.length} FUN Robotics Network video${list.length === 1 ? "" : "s"} about this team`}
      description="Videos from FUN Robotics Network whose title names this team, newest first. They play here; views still count on their channel.">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-featured-list>
        {list.map((v) => {
          const series = seriesLabel(v.series);
          return (
            <li key={v.videoId}>
              <button type="button" onClick={() => play(v)} className="group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-card text-left outline-none transition-colors still-hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none" data-featured-video={v.videoId}>
                <span className="relative block aspect-video w-full overflow-hidden bg-black">
                  <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                  <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-black/70 text-white"><Play className="size-5 translate-x-px fill-current" aria-hidden /></span></span>
                </span>
                <span className="block p-3">
                  <span className="line-clamp-2 text-sm font-medium text-text-base">{v.title}</span>
                  <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-text-faint">
                    {series && <span className="text-accent">{series}</span>}
                    {v.season != null && <span className="tabular-nums">{seasonLabel(v.season)}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const EMPTY: ReadonlySet<number> = new Set();
let shared: { teams: number[]; set: ReadonlySet<number> } | null = null;
/** The teams featured on Behind the Bot (GET /api/featured-teams, one short list kept by the app's reads). */
export function useFeaturedTeams(): ReadonlySet<number> {
  const { data } = useApi<{ teams: number[] }>("/api/featured-teams");
  if (!data?.teams) return EMPTY;
  if (shared?.teams !== data.teams) shared = { teams: data.teams, set: new Set(data.teams) };
  return shared.set;
}

/** The small chip on a team row: the team was featured on Behind the Bot. Nothing for any other team. */
export function FeaturedChip({ team, className }: { team: number; className?: string }) {
  const featured = useFeaturedTeams();
  if (!featured.has(team)) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-px text-[11px] font-medium leading-4 text-accent v8:text-[0.6875rem]", className)}
      title="Featured on Behind the Bot" data-featured-chip>
      <Clapperboard className="size-3" aria-hidden /><span>Behind the Bot</span>
    </span>
  );
}
