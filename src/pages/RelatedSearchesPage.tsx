// Related searches (/related-searches?q=…): every follow-up of a search (server/api/answers/relatedPage.ts), grouped by
// what it's about, each a link to the live search with one line from its answer, its number coloured as that answer's
// card colours it. Only searches answered directly are listed. With no query, or one nothing follows from, the
// season's starting points. The server draws the same lists in the first paint (server/seoMeta.ts).
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useApi } from "../lib/api";
import { usePreferKey } from "../components/search/SearchBox";
import { relatedApiPath, relatedQuery } from "../shared/search";
import { useTitle } from "../lib/meta";
import type { RelatedPageView } from "../shared/api";
import { cn } from "../components/cn";
import { toneOf } from "../components/search/page/FollowUps";

const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;

export default function RelatedSearchesPage() {
  const [params] = useSearchParams();
  const q = relatedQuery(params.get("q") ?? "");
  // With the visitor's preferred teams, as /search asks: a name several teams share stays theirs here too.
  const { data, error } = useApi<RelatedPageView>(relatedApiPath(q, usePreferKey()));
  const page = data?.q === q ? data : undefined;
  useTitle(q ? `Related searches: ${q}` : "Popular FTC searches");
  return (
    <div className="mx-auto w-full max-w-[720px] pt-4 sm:pt-8">
      <p className="text-xs font-semibold text-muted-foreground max-md:hidden">FTC One Search</p>
      <h1 className="mt-1 break-words font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl lg:text-3xl">
        {q ? <>Related searches: {q}</> : "Popular FTC searches"}
      </h1>
      {q && <p className="mt-2 text-sm"><Link to={searchHref(q)} className="inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2 hover:no-underline">Back to the answer for “{q}” →</Link></p>}
      {page && !page.found && q && <p className="mt-2 text-sm text-muted-foreground" data-starting-points>Nothing follows from “{q}” yet. These searches are good starting points.</p>}
      {error && !page ? <p className="mt-5 text-sm text-destructive">{error.message}</p>
        : !page ? <p className="mt-5 text-sm text-muted-foreground">Finding related searches…</p>
        : page.groups.map((g) => (
          <section key={g.title || "searches"} aria-label={g.title || "Related searches"} className="mt-6" data-group>
            {g.title && <h2 className="mb-2 text-base font-semibold text-foreground">{g.title}</h2>}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {g.items.map((x) => (
                <li key={x.q}>
                  <Link to={searchHref(x.q)} className="flex min-h-[44px] items-start gap-3 px-4 py-2.5 text-sm hover:bg-muted/50">
                    <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-foreground">{x.q}</span>
                      <span className="block break-words" data-preview>
                        <span className={cn("font-semibold tabular-nums", toneOf(x.tone, x.value, x.rest))}>{x.value}</span>
                        {x.rest && <span className="text-muted-foreground"> · {x.rest}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {/* Never a dead end: search itself, whatever is listed above. */}
      {page && <p className="mt-6 text-sm"><Link to="/search" className="inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2 hover:no-underline">Search any FTC team, event or match →</Link></p>}
    </div>
  );
}
