// Who advanced from an event: one section, shown first on the Awards tab and on the Odds tab with no team picked.
// Each advancing team is a chip in the success colour with its order (FIRST's advancement order), number and name,
// and FIRST's advancement points beneath when posted. The next event is named in words, never by its code.
import { Link } from "react-router-dom";
import type { EventDetail } from "../shared/api";
import { cn } from "./cn";

type Adv = NonNullable<EventDetail["advancement"]>;

/** FTC Events names the next event by its code ("USNJCMP") or in words ("FIRST Championship & Premier Events"). */
const CODE = /^[A-Z0-9]+$/;

/** Where the event's teams go, in words: the next event's name ("the New Jersey Championship"), FTC Events' own
 *  words when it gave words, else "the next event" (a code alone is never shown). */
export function advancesToWords(adv: Pick<Adv, "advancesTo" | "advancesToName">): string {
  const name = adv.advancesToName?.trim() || (adv.advancesTo && !CODE.test(adv.advancesTo.trim()) ? adv.advancesTo.trim().replace(/ Events$/, " events") : null);
  if (!name) return "the next event";
  return /^the\b/i.test(name) ? name : `the ${name}`;
}

/** The section's heading: "5 teams advance to the New Jersey Championship" (the teams that took a slot, else the
 *  slots). */
export function advancementHeading(adv: Adv): string {
  const took = adv.rows.filter((r) => r.status === "FIRST" && !r.declined).length;
  const n = took || adv.slots;
  const verb = took ? (n === 1 ? "team advances" : "teams advance") : n === 1 ? "slot" : "slots";
  return `${n} ${verb} to ${advancesToWords(adv)}`;
}

const statusWords = (r: Adv["rows"][number]) =>
  r.status === "FIRST" ? (r.declined ? "Declined" : null) : r.status === "ALREADY_ADVANCING" ? "Already qualified" : r.status.replace(/_/g, " ").toLowerCase();

const points = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} advancement points`;

export function AdvancedTeams({ adv, season, nameOf, className }: { adv: Adv; season: number; nameOf: (t: number) => string; className?: string }) {
  let order = 0;
  return (
    <section aria-label="Advancement" className={className} data-advanced-teams>
      <h3 className="mb-2 text-base font-semibold text-foreground">{advancementHeading(adv)}</h3>
      <ol className="flex flex-wrap gap-2">
        {adv.rows.map((r) => {
          const took = r.status === "FIRST" && !r.declined;
          if (took) order++;
          const note = statusWords(r);
          const name = nameOf(r.team);
          return (
            <li key={r.team} className="min-w-0 max-w-full" data-advanced={took ? order : undefined}>
              <Link to={`/teams/${r.team}?season=${season}`}
                className={cn("tap-44 flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                  took ? "border-success/50 bg-success/10 hover:border-success" : "border-border bg-card hover:border-foreground/30")}>
                {took && <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-success/60 bg-success/20 text-xs font-bold text-foreground tabular-nums" aria-label={`Advancement order ${order}`}>{order}</span>}
                <span className="min-w-0">
                  <span className="block break-words text-sm font-semibold text-foreground"><span className="font-mono">{r.team}</span>{name && name !== String(r.team) ? ` ${name}` : ""}</span>
                  {(r.points != null || note) && (
                    <span className="block text-xs text-muted-foreground tabular-nums">{[r.points != null ? points(r.points) : "", note ?? ""].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
