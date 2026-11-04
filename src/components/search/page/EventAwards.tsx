// An award-at-event answer on /search ("who won inspire at East Bergen League Tournament 2026", server/api/searchAsks.ts
// "award" and "event-won"): the asked award's places as a podium (1st in the centre and higher, 2nd and 3rd beside
// it), then every award the event gave, as its Awards tab lists them, and a link to that tab. Only what the card
// carries is drawn: an older server's card (no `awards`) keeps its lines.
import { Link } from "react-router-dom";
import { ArrowRight, Award, Medal, Trophy } from "lucide-react";
import type { SearchCard, SearchCardAward } from "../../../shared/api";
import { awardLabel, seasonLabel } from "../../../shared/format";
import { Button } from "../../ui/button";
import { TONES, type Tone } from "../../StatTile";
import { cn } from "../../cn";
import { AnswerFrame, PART, TAP, repeats } from "./TeamAnswer";

/** Each place its own colour (the team page's tile tones, no gold): 1st green, 2nd blue, 3rd orange. */
const PLACE: Record<number, { tone: Tone; height: string; label: string }> = {
  1: { tone: "emerald", height: "h-28 max-sm:h-24", label: "1st" },
  2: { tone: "sky", height: "h-20 max-sm:h-16", label: "2nd" },
  3: { tone: "orange", height: "h-14 max-sm:h-12", label: "3rd" },
};

const nameOf = (a: SearchCardAward) => (a.name ?? awardLabel(a.type, a.placement)).replace(/<[^>]+>/g, "");
const awardsHref = (e: NonNullable<SearchCard["event"]>) => `/events/${e.season}/${encodeURIComponent(e.code)}?tab=awards`;

export function EventAwardsAnswer({ card, heading }: { card: SearchCard; heading?: string }) {
  const awards = card.awards ?? [];
  const ev = card.event;
  // The podium: the asked award's first three places (a placement each), in podium order 2nd, 1st, 3rd.
  const placed = card.award ? awards.filter((a) => a.type === card.award && a.placement >= 1 && a.placement <= 3) : [];
  const podium = [2, 1, 3].map((p) => placed.find((a) => a.placement === p)).filter((a): a is SearchCardAward => !!a);
  return (
    <AnswerFrame title={card.title} hideTitle={repeats(heading, card.title)}
      sub={ev ? `${ev.name} · ${seasonLabel(ev.season)} · from FIRST's award list for the event` : "From FIRST's award list for the event"}
      data={{ "data-card-kind": card.kind, "data-event-awards": "" }}>
      {card.none && <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground" data-none>{card.none}</p>}
      {podium.some((a) => a.placement === 1) && <Podium places={podium} season={ev?.season} />}
      {/* An older server's card (no award list): its lines, as before. */}
      {!awards.length && !!card.lines.length && (
        <ul className="grid gap-2 sm:grid-cols-2" data-lines>
          {card.lines.map((l) => (
            <li key={l.text}>
              <AwardRow name={l.detail ?? l.results?.[0] ?? ""} team={l.text} href={l.href} />
            </li>
          ))}
        </ul>
      )}
      {!!awards.length && (
        <section aria-label="Every award at this event" className={cn(podium.length && "mt-6")} data-all-awards>
          <h3 className={PART}>Every award at this event · {awards.length}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {awards.map((a) => (
              <li key={`${a.type}|${a.placement}|${a.team}`} data-award={a.type}>
                <AwardRow name={nameOf(a)} team={`${a.team}${a.teamName ? ` ${a.teamName}` : ""}`} href={`/teams/${a.team}${ev ? `?season=${ev.season}` : ""}`} asked={a.type === card.award} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {ev && (
        <div className="mt-5">
          <Button asChild variant="secondary" className={cn(TAP, "h-auto whitespace-normal py-2 text-left")}>
            <Link to={awardsHref(ev)} data-awards-page>Awards page for {ev.name}<ArrowRight aria-hidden /></Link>
          </Button>
        </div>
      )}
    </AnswerFrame>
  );
}

/** 1st in the centre and highest, 2nd left, 3rd right (each in its own column, so a lone winner stays centred): each step the team's number big, its name and the place. */
function Podium({ places, season }: { places: SearchCardAward[]; season?: number }) {
  return (
    <ol className="grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label="Podium" data-podium>
      {places.map((a) => {
        const p = PLACE[a.placement];
        const t = TONES[p.tone];
        const Icon = a.placement === 1 ? Trophy : Medal;
        return (
          <li key={a.placement} className={cn("flex min-w-0 flex-col items-center text-center", "row-start-1", a.placement === 1 ? "col-start-2" : a.placement === 2 ? "col-start-1" : "col-start-3")} data-place={a.placement}>
            <Link to={`/teams/${a.team}${season ? `?season=${season}` : ""}`} className={cn("group flex w-full min-w-0 flex-col items-center rounded-xl px-1 py-2 hover:bg-muted/50", TAP)}>
              <span className={cn("grid place-items-center rounded-full", t.chip, a.placement === 1 ? "size-12" : "size-10")}><Icon className={a.placement === 1 ? "size-6" : "size-5"} aria-hidden /></span>
              <span className={cn("mt-2 font-display font-semibold tabular-nums text-foreground group-hover:underline", a.placement === 1 ? "text-3xl max-sm:text-2xl" : "text-2xl max-sm:text-xl")}>{a.team}</span>
              <span className="w-full break-words text-sm font-medium leading-snug text-foreground">{a.teamName ?? `Team ${a.team}`}</span>
              <span className="mt-0.5 w-full break-words text-xs text-muted-foreground">{nameOf(a)}</span>
            </Link>
            <span className={cn("mt-2 flex w-full items-start justify-center rounded-t-xl border border-b-0 pt-2 font-display text-lg font-semibold", t.box, t.text, p.height)} aria-hidden>{p.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function AwardRow({ name, team, href, asked }: { name: string; team: string; href?: string; asked?: boolean }) {
  const body = (
    <>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", asked ? TONES.emerald.chip : "bg-muted text-muted-foreground")}><Award className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-foreground">{name}</span>
        <span className="block break-words text-sm text-muted-foreground group-hover:text-foreground">{team}</span>
      </span>
    </>
  );
  const cls = "group flex min-h-[44px] items-center gap-3 rounded-xl border border-border bg-card p-3";
  return href ? <Link to={href} className={cn(cls, "hover:bg-muted/50")}>{body}</Link> : <div className={cls}>{body}</div>;
}
