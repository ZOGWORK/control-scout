// An award-at-event answer on /search ("who won inspire at East Bergen League Tournament 2026", server/api/searchAsks.ts
// "award" and "event-won"): a "who won" question's playoff champions first; the asked award's places as a podium (1st in
// the centre and higher, 2nd and 3rd beside it), then every award the event gave, as its Awards tab lists them, and a link to that tab. Only what the card
// carries is drawn: an older server's card (no `awards`) keeps its lines.
import { Link } from "react-router-dom";
import { ArrowRight, Award, Crown, Medal, Trophy } from "lucide-react";
import type { SearchCard, SearchCardAward } from "../../../shared/api";
import { awardLabel, seasonLabel } from "../../../shared/format";
import { cn } from "../../cn";
import { SEARCH_PALETTE, meaningOf } from "../../../lib/textTones";

/** An award's colour in search's palette (Inspire, an alliance place, a judged award): the same on every card. */
const tone = (name: string) => SEARCH_PALETTE[meaningOf(name) ?? "judged"];
import { AnswerFrame, PART, SECONDARY, TAP, repeats } from "./TeamAnswer";
import { AnswerVideo } from "./AnswerVideo";
import { TeamChip } from "./MatchBox";

/** Each place told by its step's height, its icon and its label, never a colour (on a search card hue means team). */
const PLACE: Record<number, { height: string; label: string }> = {
  1: { height: "h-28 max-sm:h-24", label: "1st" },
  2: { height: "h-20 max-sm:h-16", label: "2nd" },
  3: { height: "h-14 max-sm:h-12", label: "3rd" },
};

const nameOf = (a: SearchCardAward) => (a.name ?? awardLabel(a.type, a.placement)).replace(/<[^>]+>/g, "");
const awardsHref = (e: NonNullable<SearchCard["event"]>) => `/events/${e.season}/${encodeURIComponent(e.code)}?tab=awards`;

export function EventAwardsAnswer({ card, heading }: { card: SearchCard; heading?: string }) {
  const awards = card.awards ?? [];
  const ev = card.event;
  // The podium: the asked award's first three places (a placement each), in podium order 2nd, 1st, 3rd.
  const placed = card.award ? awards.filter((a) => a.type === card.award && a.placement >= 1 && a.placement <= 3) : [];
  const podium = [2, 1, 3].map((p) => placed.find((a) => a.placement === p)).filter((a): a is SearchCardAward => !!a);
  // The rest of the event's awards: the podium's places aren't listed again (each fact once).
  const shown = podium.some((a) => a.placement === 1);
  const rest = shown ? awards.filter((a) => !podium.includes(a)) : awards;
  return (
    <AnswerFrame title={card.title} hideTitle={repeats(heading, card.title)}
      sub={ev ? `${ev.name} · ${seasonLabel(ev.season)} · from FIRST's award list for the event` : "From FIRST's award list for the event"}
      data={{ "data-card-kind": card.kind, "data-event-awards": "" }}>
      {card.none && <p className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground" data-none>{card.none}</p>}
      {!!card.champions?.length && <Champions champions={card.champions} />}
      {shown && <Podium places={podium} season={ev?.season} />}
      <AnswerVideo />
      {/* An older server's card (no award list): its lines, as before. */}
      {!awards.length && !card.champions?.length && !!card.lines.length && (
        <ul className="grid gap-2 sm:grid-cols-2" data-lines>
          {card.lines.map((l) => (
            <li key={l.text}>
              <AwardRow name={l.detail ?? l.results?.[0] ?? ""} team={l.text} href={l.href} />
            </li>
          ))}
        </ul>
      )}
      {!!rest.length && (
        <section aria-label={shown ? "Other awards at this event" : "Every award at this event"} className={cn(shown && "mt-6")} data-all-awards>
          <h3 className={PART}>{shown ? "Other awards at this event" : "Every award at this event"} · {rest.length}</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {rest.map((a) => (
              <li key={`${a.type}|${a.placement}|${a.team}`} data-award={a.type}>
                <AwardRow name={nameOf(a)} team={`${a.team}${a.teamName ? ` ${a.teamName}` : ""}`} href={`/teams/${a.team}${ev ? `?season=${ev.season}` : ""}`} asked={a.type === card.award} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {ev && (
        <div className="mt-5">
          <Link to={awardsHref(ev)} className={cn(SECONDARY, TAP)} data-awards-page data-secondary>Awards page for {ev.name}<ArrowRight className="size-4 shrink-0" aria-hidden /></Link>
        </div>
      )}
    </AnswerFrame>
  );
}

/** "Who won <event>": its playoff champions first, each alliance's teams as chips in the colour they played the final in. */
function Champions({ champions }: { champions: NonNullable<SearchCard["champions"]> }) {
  return (
    <section aria-label="Champions" className="mb-5 grid gap-3 sm:grid-cols-2" data-champions>
      {champions.map((c) => (
        <div key={c.href} className="rounded-xl border border-accent/60 bg-accent/[0.06] p-3" data-champion>
          <Link to={c.href} className={cn("flex items-center gap-1.5 font-display text-base font-semibold text-accent-text hover:underline", TAP)}>
            <Crown className="size-4 shrink-0" aria-hidden /> {c.label}{c.number != null ? ` · Alliance ${c.number}` : ""}
          </Link>
          <p className="mt-2 flex flex-wrap gap-1">{c.teams.map((t) => <TeamChip key={t.href} t={t} side={c.alliance} />)}</p>
        </div>
      ))}
    </section>
  );
}

/** 1st in the centre and highest, 2nd left, 3rd right (each in its own column, so a lone winner stays centred): each step the team's number big, its name and the place. */
function Podium({ places, season }: { places: SearchCardAward[]; season?: number }) {
  return (
    <ol className="grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label="Podium" data-podium>
      {places.map((a) => {
        const p = PLACE[a.placement];
        const Icon = a.placement === 1 ? Trophy : Medal;
        return (
          <li key={a.placement} className={cn("flex min-w-0 flex-col items-center text-center", "row-start-1", a.placement === 1 ? "col-start-2" : a.placement === 2 ? "col-start-1" : "col-start-3")} data-place={a.placement}>
            <Link to={`/teams/${a.team}${season ? `?season=${season}` : ""}`} className={cn("group flex w-full min-w-0 flex-col items-center rounded-xl px-1 py-2 hover:bg-muted/50", TAP)}>
              <span className={cn("grid place-items-center rounded-full", tone(nameOf(a)).fill, a.placement === 1 ? "size-12" : "size-10")}><Icon className={a.placement === 1 ? "size-6" : "size-5"} aria-hidden /></span>
              <span className={cn("mt-2 font-display font-semibold tabular-nums text-foreground group-hover:underline", a.placement === 1 ? "text-3xl max-sm:text-2xl" : "text-2xl max-sm:text-xl")}>{a.team}</span>
              <span className="w-full break-words text-sm font-medium leading-snug text-foreground">{a.teamName ?? `Team ${a.team}`}</span>
              <span className={cn("mt-0.5 w-full break-words text-xs font-semibold", tone(nameOf(a)).text)}>{nameOf(a)}</span>
            </Link>
            <span className={cn("mt-2 flex w-full items-start justify-center rounded-t-xl pt-2 font-display text-lg font-semibold", tone(nameOf(a)).fill, p.height)} aria-hidden>{p.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function AwardRow({ name, team, href, asked }: { name: string; team: string; href?: string; asked?: boolean }) {
  const body = (
    <>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone(name).fill, asked && "ring-2 ring-foreground")}><Award className="size-4" aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className={cn("block break-words text-sm font-semibold", tone(name).text)}>{name}</span>
        <span className="block break-words text-sm text-muted-foreground group-hover:text-foreground">{team}</span>
      </span>
    </>
  );
  // A thick left bar and a wash in the award's colour: Inspire, an alliance place and a judged award told apart at a glance.
  const cls = cn("group flex min-h-[44px] items-center gap-3 rounded-xl border border-l-[6px] border-border p-3", tone(name).edge, tone(name).tint);
  return href ? <Link to={href} className={cn(cls, "hover:bg-muted/50")}>{body}</Link> : <div className={cls}>{body}</div>;
}
