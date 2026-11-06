// A highlights answer's matches as a video grid (a team's: server/api/answers/highlights.ts; a scope's:
// server/api/query/highlights.ts): a tile per match, its reason ("Best score", "Closest win") as the tile's label, the
// match's YouTube picture over its match box. A tap plays the clip in the app's video dialog, as a row's play button
// does (./AnswerVideo.tsx), so one video plays at a time and nothing loads but pictures. A match with no clip keeps its
// tile, stat-led, saying "No video"; when nothing listed has a video, one line says so once. One column on a phone.
import { Play } from "lucide-react";
import type { SearchVideoItem } from "../../../shared/api";
import type { StatAnswer, StatBlock } from "../../../shared/searchStat";
import { thumbnailUrl } from "../../../shared/stream";
import { clipTime } from "../../../shared/recording";
import { useAnyVideo, useClip } from "./AnswerVideo";
import { MatchBox } from "./MatchBox";
import { cn } from "../../cn";

type Matches = Extract<StatBlock, { kind: "matches" }>;

/** A list of highlights: every row says why it's there. */
export const isHighlights = (b: Matches) => b.rows.length > 0 && b.rows.every((r) => r.note);

/** `hue`: the card is about one team, its colour on each tile's label and edge; else ink. `atEvent`: every match is at
 *  one event, named once over the grid. */
export function HighlightGrid({ b, team, hue, atEvent }: { b: Matches; team?: StatAnswer["team"]; hue?: boolean; atEvent: boolean }) {
  const any = useAnyVideo();
  const oneEvent = b.rows.every((r) => r.event.href === b.rows[0].event.href && r.season === b.rows[0].season);
  return (
    <>
      {!any && (
        <p className="mb-3 text-sm font-medium text-foreground" data-no-recording>
          {oneEvent ? "No recording for this event — stats only." : "No video for these matches — stats only."}
        </p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2" data-video-grid>
        {b.rows.map((r) => <Tile key={`${r.href}|${r.alliance}`} r={r} team={team ?? undefined} hue={hue} atEvent={atEvent} said={!any} />)}
      </ul>
    </>
  );
}

/** `said`: the line over the grid already says nothing here has video (no "No video" on each tile). */
function Tile({ r, team, hue, atEvent, said }: { r: Matches["rows"][number]; team?: { number: number; name: string | null }; hue?: boolean; atEvent: boolean; said: boolean }) {
  const { v, play } = useClip(r.href);
  const label = `${r.label} · ${r.event.label}`;
  return (
    <li className={cn("flex min-w-0 flex-col gap-2 rounded-xl border-l-[6px] pl-2", hue ? "border-team-a" : "border-foreground/70")} data-video-tile={r.label}>
      <span className={cn("self-start rounded-md px-2.5 py-1 text-sm font-bold", hue ? "bg-team-a text-background" : "bg-foreground text-background")} data-tile-note>{r.note}</span>
      {v ? (
        <button type="button" onClick={() => play(label)} aria-label={`Play ${r.note}: ${label}, ${v.kind === "match" ? "official match video" : "in the event's recording"}`}
          className="group block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60" data-tile-play={v.kind}>
          <Picture v={v} />
        </button>
      ) : !said && (
        <p className="text-xs text-muted-foreground" data-no-video>No video</p>
      )}
      {/* The box's own list, so the tile stays one list item. */}
      <ul className="contents"><MatchBox r={{ ...r, note: undefined }} team={team} atEvent={atEvent} noPlay /></ul>
    </li>
  );
}

/** The clip at 16:9, a play mark on it: a match's own video its picture; a second in the event's recording no
 *  picture (the recording's is whatever was on the field then, another match or an award), its time instead. */
function Picture({ v }: { v: SearchVideoItem }) {
  return (
    <span className="relative block aspect-video w-full overflow-hidden rounded-lg border border-border bg-black" data-video-control>
      {v.kind === "match"
        ? <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-90 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
        : <span className="absolute inset-x-0 bottom-0 px-2.5 py-2 text-xs font-medium text-white">In the event's recording, from {clipTime(v.t)}</span>}
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-12 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/40"><Play className="size-6 translate-x-px fill-current" aria-hidden /></span>
      </span>
    </span>
  );
}
