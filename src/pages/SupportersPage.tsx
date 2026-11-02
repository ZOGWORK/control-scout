// /supporters: everyone who has sponsored Control Scout on GitHub, as each chose there. Public sponsors by
// their GitHub name, private ones only as a count. No amounts or tiers, ever (server/sponsors.ts reads none).
// Linked from /donate only; kept out of search engines (it lists people's names).
import { Heart, UserRound, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useTitle } from "../lib/meta";
import { useApi } from "../lib/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import type { SupportersResponse } from "../shared/sponsor";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default function SupportersPage() {
  useTitle("Supporters");
  const state = useApi<SupportersResponse>("/api/supporters");
  const donate = <Button variant="secondary" asChild><Link to="/donate"><Heart /> How to support</Link></Button>;
  return (
    <div>
      <PageHeader title="Supporters" description="The people who chip in toward Control Scout's running costs. Thank you." actions={donate} />
      <Async state={state} empty={(d) => {
        if (!d.configured) return <EmptyState icon={Users} title="Not set up yet" description="This list reads from GitHub Sponsors, and that link isn't switched on yet." />;
        if (!d.supporters.length && !d.anonymous) return <EmptyState icon={Heart} title="No supporters yet" description="Anyone who sponsors Control Scout on GitHub shows up here, by name or anonymously, as they choose." action={donate} />;
        return null;
      }}>
        {(d) => (
          <>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.supporters.map((s) => (
                <li key={s.login} className="flex items-center gap-3 rounded-2xl border border-line p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text"><UserRound className="size-[18px]" aria-hidden /></span>
                  <div className="min-w-0">
                    <a href={`https://github.com/${encodeURIComponent(s.login)}`} target="_blank" rel="noreferrer noopener" className="block truncate font-semibold text-foreground hover:underline">{s.name ?? s.login}</a>
                    <p className="text-xs text-text-muted">Since {monthYear(s.since)}</p>
                  </div>
                </li>
              ))}
              {d.anonymous > 0 && (
                <li className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/12 text-info"><Users className="size-[18px]" aria-hidden /></span>
                  <p className="font-semibold text-foreground">{d.anonymous === 1 ? "1 anonymous supporter" : `${d.anonymous} anonymous supporters`}</p>
                </li>
              )}
            </ul>
            <p className="mt-6 max-w-[72ch] text-sm text-text-muted">
              Sponsors choose on GitHub whether to be public. Public sponsors are listed by their GitHub name; private ones are only counted. Amounts are never shown. The list updates within the hour.
            </p>
          </>
        )}
      </Async>
    </div>
  );
}
