// A team featured in a creator video (src/shared/creatorVideos.ts, server/videos/creatorVideos.ts): the public
// Behind the Bot badge ("Behind the Bot ×4": a tab on the Standing card's top edge, a retro sticker on classic), the page's Featured in
// section listing each video, and the small chip on team rows (search results, event team lists, rankings). Everyone
// sees them, signed in or not, and every tap opens the app's watch page (pages/WatchPage.tsx), never a jump to YouTube.
import { Link } from "react-router-dom";
import { Clapperboard, Play, Tv } from "lucide-react";
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
 * The team's Behind the Bot badge: "Behind the Bot ×4" when the team was on it four times (no count for one), opening
 * the watch page on the newest episode with the team's other episodes first in Up next, then the rest of the series.
 * `tab` (v8): a notch on the top edge of the Standing card, in the card's own colour so it reads as part of it, with
 * the accent along its top; `patch` (classic): the same lettering as a small retro sticker under the actions.
 */
export function FeaturedBadge({ featured, team, variant = "patch", className }: { featured: readonly FeaturedVideo[] | undefined; team: number; variant?: "tab" | "patch"; className?: string }) {
  const list = episodes(featured);
  if (!list.length) return null;
  const n = list.length;
  const label = `Behind the Bot${n > 1 ? `, ${n} episodes` : ""}: watch ${n > 1 ? "them" : "it"}`;
  const words = (
    <>
      <Tv className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
      <span className="font-mono text-[0.6875rem] font-bold uppercase leading-none tracking-[0.14em]">Behind the Bot</span>
      {n > 1 && <span className="rounded-[3px] bg-accent px-1 py-px font-mono text-[0.6875rem] font-black leading-4 tabular-nums text-accent-ink" data-featured-count>×{n}</span>}
    </>
  );
  if (variant === "tab") {
    return (
      <Link to={watchHref(list[0].videoId, { team })} data-featured-badge={n} aria-label={label} title={label}
        className={cn(
          "group inline-flex h-7 items-center gap-1.5 rounded-t-[9px] border border-b-0 border-line border-t-2 border-t-accent bg-card px-2.5 text-accent-text outline-none",
          "origin-bottom transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent/[0.08] active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none motion-reduce:active:scale-100",
          className)}>
        {words}
      </Link>
    );
  }
  return (
    <Link to={watchHref(list[0].videoId, { team })} data-featured-badge={n} aria-label={label} title={label}
      className={cn(
        "inline-flex select-none items-center gap-1.5 rounded-[6px] border-2 border-accent bg-accent/[0.08] px-2 py-1 text-accent-text outline-none",
        "shadow-[2px_2px_0_0_var(--color-accent)] transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--color-accent)]",
        "active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0",
        className)}>
      {words}
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
              <Link to={watchHref(v.videoId, { team })} className="group flex w-full flex-col overflow-hidden rounded-xl border border-line bg-card text-left outline-none transition-colors still-hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none" data-featured-video={v.videoId}>
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
