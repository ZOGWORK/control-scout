// A team's listing facts on /search ("4215 sponsors", "4215 sponsors and school", "where is 4215 from"): one compact
// card under the team's name, each fact a bold value with its name small beside it, every sponsor its own row, values
// exactly as FIRST lists them (server/api/searchCoverage.ts teamFactAnswer). Questions about the same team close it.
import { Link } from "react-router-dom";
import { Search, Shield } from "lucide-react";
import type { SearchCard, SearchCardFact } from "../../../shared/api";

const H3 = "text-xs font-semibold text-muted-foreground";

export function FactCard({ card }: { card: SearchCard & { facts: SearchCardFact[] } }) {
  const team = card.team;
  return (
    <section aria-label={card.title} className="mb-5 rounded-xl border border-accent/30 bg-card p-4 shadow-sm sm:p-5" data-fact-card>
      {team && (
        <header className="flex items-center gap-2.5">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/[0.12]"><Shield className="size-4 text-accent" aria-hidden /></span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-semibold text-foreground">
              <Link to={`/teams/${team.number}`} className="hover:text-accent-text hover:underline">{team.name ?? `Team ${team.number}`}</Link>
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{team.number}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{card.title}</p>
          </div>
        </header>
      )}
      <dl className="mt-3 divide-y divide-border rounded-lg border border-border">
        {card.facts.map((f) => <Fact key={f.label} f={f} />)}
      </dl>
      {!!card.related?.length && (
        <nav aria-label="Related questions" className="mt-3" data-block="related">
          <h3 className={`mb-1.5 ${H3}`}>Related questions</h3>
          <ul className="flex flex-wrap gap-1.5">
            {card.related.map((q) => (
              <li key={q}><Link to={`/search?q=${encodeURIComponent(q)}`} className="inline-flex min-h-8 max-md:min-h-[44px] pointer-coarse:min-h-[44px] items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-3 text-xs font-medium text-foreground hover:border-accent/60"><Search className="size-3.5 text-accent" aria-hidden />{q}</Link></li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}

/** A listed website as a link: FIRST lists some with no scheme ("www.example.org"); only http(s) ever links. */
export function hrefOf(raw: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

function Fact({ f }: { f: SearchCardFact }) {
  // One value: the value, its name under it. Several (sponsors): the name with the count, then a row each.
  if (f.values.length > 1) {
    return (
      <div className="px-3 py-2.5" data-fact={f.label}>
        <dt className="text-[11px] text-muted-foreground">{f.label} · {f.values.length}</dt>
        {f.values.map((v) => <dd key={v} className="border-t border-border/60 py-1.5 text-sm font-semibold text-foreground first-of-type:border-t-0">{v}</dd>)}
      </div>
    );
  }
  const v = f.values[0];
  return (
    <div className="flex flex-col-reverse px-3 py-2.5" data-fact={f.label}>
      <dt className="mt-0.5 text-[11px] text-muted-foreground">{f.label}{f.detail ? ` · ${f.detail}` : ""}</dt>
      <dd className="break-words text-base font-semibold text-foreground">
        {v == null ? <span className="font-normal text-muted-foreground">Not in FIRST's listing</span>
          : f.link && hrefOf(v) ? <a href={hrefOf(v)!} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">{v}</a> : v}
      </dd>
    </div>
  );
}
