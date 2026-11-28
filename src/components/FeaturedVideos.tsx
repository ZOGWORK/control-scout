// A team featured in a creator video (src/shared/creatorVideos.ts, server/videos/creatorVideos.ts): the public
// Behind the Bot badge ("Behind the Bot ×4": a small arcade plate just above the Standing card, shining now and then), the page's Featured in
// section listing each video, and the small chip on team rows (search results, event team lists, rankings). Everyone
// sees them, signed in or not, and every tap opens the app's watch page (pages/WatchPage.tsx), never a jump to YouTube.
import { Link } from "react-router-dom";
import { Clapperboard, Play } from "lucide-react";
import { Section } from "./page";
import { cn } from "./cn";
import { useApi } from "../lib/api";
import { seasonLabel } from "../lib/format";
import { thumbnailUrl } from "../shared/stream";
import { watchHref } from "../shared/watch";
import { seriesLabel, type FeaturedVideo } from "../shared/creatorVideos";

/** Behind the Bot's episodes about this team, newest first. */
const episodes = (featured: readonly FeaturedVideo[] | undefined) => (featured ?? []).filter((v) => v.series === "behind-the-bot");

/** The team's Behind the Bot episodes, for a badge: how many, and where it opens. */
export const btbEpisodes = (featured: readonly FeaturedVideo[] | undefined) => episodes(featured);

/**
 * The team's Behind the Bot badge: an arcade-style plate, "Behind the Bot ×4" (no count for one), purple with white
 * pixel lettering and a white count and stepped corners and a hard shadow, with a silver shine sweeping across now and
 * then (index.css btb-shine; still with reduced motion). It opens the watch page on the newest episode, the team's
 * other episodes first in Up next, then the rest of the series.
 */
export function FeaturedBadge({ featured, team, className }: { featured: readonly FeaturedVideo[] | undefined; team: number; className?: string }) {
  const list = episodes(featured);
  if (!list.length) return null;
  const n = list.length;
  const label = `Behind the Bot${n > 1 ? `, ${n} episodes` : ""}: watch ${n > 1 ? "them" : "it"}`;
  return (
    <Link to={watchHref(list[0].videoId, { team })} data-featured-badge={n} aria-label={label} title={label}
      className={cn(
        "group tap-44 inline-flex outline-none [filter:drop-shadow(2px_2px_0_#1e0b4b)]",
        "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:translate-x-px active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-x-0 motion-reduce:active:translate-y-0",
        "focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className)}>
      <span className="relative inline-flex h-[22px] items-center gap-1.5 overflow-hidden bg-[#5b21b6] pl-1.5 pr-[3px] text-[#e4dcfb] [clip-path:polygon(3px_0,calc(100%-3px)_0,100%_3px,100%_calc(100%-3px),calc(100%-3px)_100%,3px_100%,0_calc(100%-3px),0_3px)]">
        <span className="font-pixel text-[12px] uppercase leading-none tracking-[0.06em]">Behind the Bot</span>
        {n > 1 && <span className="bg-[#e4dcfb] px-[3px] py-[2px] font-pixel text-[11px] leading-none text-[#4c1d95]" data-featured-count>×{n}</span>}
        <span aria-hidden className="btb-shine pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
      </span>
    </Link>
  );
}

/** Featured in: every creator video whose title names the team, each opening the watch page. Closed at first. */
export function FeaturedSection({ featured, team }: { featured: readonly FeaturedVideo[] | undefined; team: number }) {
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
              <Link to={watchHref(v.videoId, { team })} className="group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-card text-left outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] still-hover:bg-ink/[0.03] active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none motion-reduce:active:scale-100" data-featured-video={v.videoId}>
                <span className="relative block aspect-video w-full overflow-hidden bg-black">
                  <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                  <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 scale-90 place-items-center rounded-full bg-black/70 text-white opacity-0 ring-1 ring-white/20 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 pointer-coarse:scale-100 pointer-coarse:opacity-100 motion-reduce:transition-none"><Play className="size-5 translate-x-px fill-current" aria-hidden /></span></span>
                </span>
                <span className="block p-3">
                  <span className="line-clamp-2 text-sm font-medium text-text-base">{v.title}</span>
                  <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-text-faint">
                    {series && <span className="text-accent">{series}</span>}
                    {v.season != null && <span className="tabular-nums">{seasonLabel(v.season)}</span>}
                  </span>
                </span>
              </Link>
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
/** `fit`: the chip sits on one line beside a team's number and name inside a `@container/chiprow`; when that row is too
 *  narrow for both (a rankings table on a tablet), the words go and the clapperboard stays (its title still says it),
 *  so the chip never spills into the next column. */
export function FeaturedChip({ team, className, fit }: { team: number; className?: string; fit?: boolean }) {
  const featured = useFeaturedTeams();
  if (!featured.has(team)) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-1.5 py-px text-[11px] font-medium leading-4 text-accent v8:text-[0.6875rem]", className)}
      title="Featured on Behind the Bot" data-featured-chip>
      <Clapperboard className="size-3" aria-hidden /><span className={cn(fit && "@max-[17rem]/chiprow:sr-only")}>Behind the Bot</span>
    </span>
  );
}
