// /teams/:number/record-split: a team's record of its latest season with matches, qualifications and playoffs apart,
// the same card Search gives for "<number> record" (server/teamRecordPage.ts), at an address of its own. Its first HTML
// carries the whole answer as text (server/seoMeta.ts). Linked from the team page, and it links back.
import { Trophy } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { StatAnswerCard } from "../components/search/page/StatAnswer";
import { teamHeading } from "../shared/teamTitle";
import type { StatAnswer } from "../shared/searchStat";

interface TeamRecord { team: { number: number; name: string | null }; stat: StatAnswer }

export default function TeamRecordSplitPage() {
  const { number = "" } = useParams();
  const ok = /^\d{1,6}$/.test(number) && Number(number) > 0;
  const n = Number(number);
  const state = useApi<TeamRecord>(ok ? `/api/teams/${n}/record-split` : null);
  const who = state.data ? teamHeading(state.data.team.number, state.data.team.name) : `Team ${number}`;
  useTitle(`${who} record, quals vs playoffs${state.data?.stat.scope[0] ? `, ${state.data.stat.scope[0]}` : ""}`);
  if (!ok) return <EmptyState icon={Trophy} title="No such team" description="This address doesn't name an FTC team." />;
  // No page for this team (its latest season has no playoff match, or no qualification match, or it isn't a team we
  // list): said plainly, with the way to its page.
  const err = state.error as ApiError | undefined;
  if (err?.status === 404 && !err.offline) {
    return <EmptyState icon={Trophy} title="No playoff record yet" description="This shows once a team has played both qualification and playoff matches in a season."
      action={<Link to={`/teams/${n}`} className="inline-flex h-[44px] items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:border-accent/60">Team {n}</Link>} />;
  }
  return (
    <div className="space-y-5">
      <Async state={state}>
        {(d) => (
          <>
            {/* The card names the team and links its page (Full team page): the header names the page only. */}
            <PageHeader title={`${teamHeading(d.team.number, d.team.name)} record`}
              description="Its wins, losses and ties of the season, qualification matches and playoffs apart."
              phoneDescription="Quals and playoffs apart." />
            <StatAnswerCard stat={d.stat} />
          </>
        )}
      </Async>
    </div>
  );
}
