// /teams/:number/highlights: a team's standout matches of its latest season with matches, the same card Search
// gives for "<number> highlights" (server/teamHighlightsPage.ts), at an address of its own. Its first HTML carries the
// whole answer as text (server/seoMeta.ts); the card here draws it with its match videos. Linked from the team page,
// and it links back.
import { Sparkles } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { StatAnswerCard } from "../components/search/page/StatAnswer";
import { AnswerVideoProvider } from "../components/search/page/AnswerVideo";
import { teamHeading } from "../shared/teamTitle";
import type { SearchVideo } from "../shared/api";
import type { StatAnswer } from "../shared/searchStat";

interface TeamHighlights { team: { number: number; name: string | null }; stat: StatAnswer; video?: SearchVideo }

export default function TeamHighlightsPage() {
  const { number = "" } = useParams();
  const ok = /^\d{1,6}$/.test(number) && Number(number) > 0;
  const n = Number(number);
  const state = useApi<TeamHighlights>(ok ? `/api/teams/${n}/highlights` : null);
  const who = state.data ? teamHeading(state.data.team.number, state.data.team.name) : `Team ${number}`;
  useTitle(`${who} highlights${state.data?.stat.scope[0] ? `, ${state.data.stat.scope[0]}` : ""}`);
  if (!ok) return <EmptyState icon={Sparkles} title="No such team" description="This address doesn't name an FTC team." />;
  // No highlights page for this team (it hasn't played a match with scores, or it isn't a team we list): said plainly,
  // with the way to its page, never a broken-looking error.
  const err = state.error as ApiError | undefined;
  if (err?.status === 404 && !err.offline) {
    return <EmptyState icon={Sparkles} title="No highlights yet" description="Highlights show here once this team has played a match with scores."
      action={<Link to={`/teams/${n}`} className="inline-flex h-[44px] items-center rounded-lg border border-border bg-card px-3 text-sm font-medium hover:border-accent/60">Team {n}</Link>} />;
  }
  return (
    <div className="space-y-5">
      <Async state={state}>
        {(d) => (
          <>
            {/* The card names the team and links its page (Full team page): the header names the page only. */}
            <PageHeader title={`${teamHeading(d.team.number, d.team.name)} highlights`}
              description="Its standout matches of the season: best score, biggest win, latest playoff win, best Auto and closest win, each with its video when there is one."
              phoneDescription="Its standout matches of the season." />
            <AnswerVideoProvider video={d.video}>
              <StatAnswerCard stat={d.stat} />
            </AnswerVideoProvider>
          </>
        )}
      </Async>
    </div>
  );
}
