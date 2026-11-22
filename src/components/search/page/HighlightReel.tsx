// A team's highlights as videos, first (v8 /search, a "highlights" answer: server/api/answers/highlights.ts): a grid of
// video cards, as a video site lays them out. Each card is the clip's picture with a play mark, the match ("Q21") over
// it and the clip's length, then "Q21 · NTX I-League Meet #1" and why it's there, the score and the day under it. A tap
// plays it in the app's video dialog (./AnswerVideo.tsx useClips), never off to YouTube, one at a time. Order: the
// standout matches first (best score, biggest win…), then every other match with a clip by the team's points, newest
// first on a tie. A season with no match clip shows the newest season that has one (the server's `season` list,
// said so), else the event's whole recording; a team with none anywhere gets the server's one line. Two columns on a
// phone, three on a wide screen; six cards, the rest a tap away.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Play, Radio } from "lucide-react";
import type { SearchVideoItem } from "../../../shared/api";
import type { StatAnswer, StatBlock } from "../../../shared/searchStat";
import { thumbnailUrl } from "../../../shared/stream";
import { clipTime } from "../../../shared/recording";
import { dateRange, seasonLabel } from "../../../lib/format";
import { useClips, useVideoKnown } from "./AnswerVideo";
import { cn } from "../../cn";

type Videos = Extract<StatBlock, { kind: "videos" }>;

/** One card: a match's clip, or an event's whole recording (`stream`). */
export interface ReelCard { href: string; label: string; event: string; date?: string | null; note?: string; own?: number; opp?: number; v: SearchVideoItem; stream?: boolean }

/** Cards before "Show all". */
const FIRST = 6;

const day = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? dateRange(d.slice(0, 10)) : d ?? null);

/**
 * The cards to show, in order, and which season they're from when it isn't the answer's own (`season`): the answer's
 * own clips; else another season's (the server lists them only when the shown season has none); else the shown
 * season's events' whole recordings. `clip` is the answer's video by a row's link.
 */
export function reelCards(stat: StatAnswer, clip: (href: string) => SearchVideoItem | undefined): { cards: ReelCard[]; season?: number } {
  const team = stat.team?.number;
  const events = new Map<string, string>();
  const standout = stat.blocks.find((b): b is Extract<StatBlock, { kind: "matches" }> => b.kind === "matches");
  for (const r of standout?.rows ?? []) events.set(r.event.href, r.event.label);
  const videos = stat.blocks.filter((b): b is Videos => b.kind === "videos");
  for (const b of videos) for (const s of b.streams ?? []) events.set(s.href, s.label);
  const of = (b: Videos) => b.tiles.flatMap((t): ReelCard[] => {
    const v = clip(t.href);
    if (!v) return [];
    const red = team != null && t.red.includes(team);
    return [{ href: t.href, label: t.label, event: t.event ?? events.get(t.href.split("?")[0]) ?? "", date: t.date, own: red ? t.redScore : t.blueScore, opp: red ? t.blueScore : t.redScore, v }];
  });
  const byPoints = (xs: ReelCard[]) => xs.map((c, i) => ({ c, i })).sort((a, b) => (b.c.own ?? 0) - (a.c.own ?? 0) || b.i - a.i).map((x) => x.c);
  const first: ReelCard[] = (standout?.rows ?? []).flatMap((r) => {
    const v = clip(r.href);
    return v ? [{ href: r.href, label: r.label, event: r.event.label, date: r.date, note: r.note, own: r.own, opp: r.opp, v }] : [];
  });
  const seen = new Set(first.map((c) => c.href));
  const own = byPoints(videos.filter((b) => b.season == null).flatMap(of).filter((c) => !seen.has(c.href) && seen.add(c.href)));
  if (first.length || own.length) return { cards: [...first, ...own] };
  const other = videos.find((b) => b.season != null);
  const theirs = other ? byPoints(of(other)) : [];
  if (other && theirs.length) return { cards: theirs, season: other.season };
  // No match clip anywhere: the events' whole recordings (from their start), said to be that.
  const streams = videos.flatMap((b) => b.streams ?? []).flatMap((s): ReelCard[] => {
    const v = clip(s.href);
    return v ? [{ href: s.href, label: v.live ? "Live stream" : "Full recording", event: s.label, v, stream: true }] : [];
  });
  return { cards: streams };
}

export function HighlightReel({ stat, className }: { stat: StatAnswer; className?: string }) {
  const { clip, play } = useClips();
  const known = useVideoKnown();
  const [all, setAll] = useState(false);
  const { cards, season } = reelCards(stat, clip);
  if (!cards.length) {
    // Nothing plays: the server's one line (a team with no video in any season), once the video has been read.
    const empty = known ? stat.blocks.find((b): b is Videos => b.kind === "videos" && !!b.empty)?.empty : undefined;
    return empty ? (
      <p className={cn("rounded-xl border border-line bg-card px-4 py-3 text-sm text-foreground", className)} data-reel-empty>
        {empty.text}{empty.href && <> <Link to={empty.href} className="font-medium underline decoration-line underline-offset-2 max-md:inline-flex max-md:min-h-[44px] max-md:items-center">Open the team's page</Link></>}
      </p>
    ) : null;
  }
  const shown = all ? cards : cards.slice(0, FIRST);
  const streams = cards[0].stream;
  return (
    <section aria-label="Videos" className={className} data-reel={season ?? "own"}>
      <h2 className="mb-2 flex flex-wrap items-baseline gap-x-1.5 text-xs text-text-faint">
        <span>{streams ? (cards.length === 1 ? "Event recording" : "Event recordings") : "Videos"}</span>
        <span className="tabular-nums">{cards.length}</span>
        {season != null && <span data-reel-season>· from {seasonLabel(season)}, none from {stat.scope[0] ?? "this season"} yet</span>}
        {streams && <span>· no match clips yet</span>}
      </h2>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-4 lg:grid-cols-3" data-reel-grid>
        {shown.map((c) => <Card key={c.href} c={c} onPlay={() => play(c.v, c.stream ? c.event : `${c.label} · ${c.event}`)} />)}
      </ul>
      {cards.length > FIRST && (
        <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-line text-sm text-text-muted hover:bg-ink/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" data-reel-more>
          <ChevronDown className={cn("size-4 transition-transform duration-200 ease-out motion-reduce:transition-none", all && "rotate-180")} aria-hidden />{all ? "Show fewer" : `Show all ${cards.length}`}
        </button>
      )}
    </section>
  );
}

/** What a card plays, in words, for its button's name. */
function what(v: SearchVideoItem): string {
  if (v.kind === "match") return "official match video";
  if (v.kind === "contributor") return `video by ${v.contributor?.name ?? "a contributor"}`;
  if (v.kind === "recording") return `in the event's recording, from ${clipTime(v.t)}`;
  return v.live ? "the event's live stream" : "the event's whole recording";
}

function Card({ c, onPlay }: { c: ReelCard; onPlay: () => void }) {
  const length = c.v.end != null && c.v.end > c.v.t ? clipTime(c.v.end - c.v.t) : null;
  const score = c.own != null && c.opp != null ? `${c.own}–${c.opp}` : null;
  const when = day(c.date);
  return (
    <li className="min-w-0" data-reel-card={c.label}>
      <button type="button" onClick={onPlay} aria-label={`Play ${c.stream ? c.event : `${c.label} · ${c.event}`}${c.note ? `, ${c.note}` : ""}: ${what(c.v)}`}
        className="group block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background" data-reel-play={c.v.kind}>
        <span className="relative block aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
          <img src={thumbnailUrl(c.v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }}
            className="absolute inset-0 size-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid size-10 place-items-center rounded-full bg-black/65 text-white ring-1 ring-white/30 transition-colors duration-150 group-hover:bg-black/80 group-focus-visible:bg-black/80 motion-reduce:transition-none">
              {c.stream ? <Radio className="size-5" aria-hidden /> : <Play className="size-5 translate-x-px fill-current" aria-hidden />}
            </span>
          </span>
          {!c.stream && <span className="absolute left-1.5 top-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white" data-reel-match>{c.label}</span>}
          {(length || c.v.live) && (
            <span className={cn("absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white", c.v.live ? "bg-live" : "bg-black/80")} data-reel-length>
              {c.v.live ? "Live" : length}
            </span>
          )}
        </span>
        <span className="mt-2 line-clamp-2 break-words text-sm font-medium leading-snug text-foreground" data-reel-title>{c.stream || !c.event ? c.event || c.label : `${c.label} · ${c.event}`}</span>
        {(c.note || score || c.stream) && (
          <span className="mt-0.5 block truncate text-xs text-text-muted">
            {c.stream ? c.label : <>{c.note && <>{c.note}{score && " · "}</>}{score && <span className="tabular-nums">{score}</span>}</>}
          </span>
        )}
        {when && <span className="block truncate text-xs text-text-faint">{when}</span>}
      </button>
    </li>
  );
}
