// /contributors/<username>: a person who adds match videos (docs/contributors.md). Their actual name as the heading,
// the verified badge when they are verified now, their teams, and the videos THIS viewer may see (a team-only video
// shows only to that team, as everywhere else). The likes total counts those same videos, so it never claims likes on
// videos the viewer can't see. An unknown username is the page not found. Kept out of search engines: it names a person.
import { useParams, Link } from "react-router-dom";
import { Clock, Play, Video } from "lucide-react";
import { useTitle } from "../lib/meta";
import { ApiError, useApi } from "../lib/api";
import { usePersonal } from "../lib/personal";
import { useReloadOnVideoChange } from "../lib/contributors";
import { playMatchVideo } from "../lib/streamSeek";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { NotFoundView } from "../components/NotFoundView";
import { VerifiedMark, VideoCredit } from "../components/contributors/VideoCredit";
import { thumbnailUrl } from "../shared/stream";
import { PENDING_TEXT, type ContributorProfile, type ProfileVideo } from "../shared/contributors";
import { cn } from "../components/cn";

export default function ContributorPage() {
  const { username = "" } = useParams();
  const { user } = usePersonal();
  const state = useApi<ContributorProfile>(`/api/videos/contributors/${encodeURIComponent(username)}?v=${user?.id ?? 0}`);
  useReloadOnVideoChange(state.reload);
  useTitle(state.data ? `${state.data.name} · match videos` : "Contributor");
  const err = state.error as ApiError | undefined;
  if (err && (err.status === 404 || err.status === 400) && !err.offline) {
    return <NotFoundView title="No such contributor" description="That username isn't on Control Scout. Check the spelling, or search for the team instead." />;
  }
  return (
    <Async state={state}>
      {(p) => (
        <div data-contributor-profile={p.status}>
          <PageHeader
            title={<span className="inline-flex items-center gap-2">{p.name}{p.verified && <VerifiedMark className="size-6" />}</span>}
            description={p.verified ? "Verified contributor: adds match videos everyone can watch." : "Adds match videos for their team."}
          />
          {p.pending && <p className="mb-4 flex items-center gap-2 text-sm font-medium" data-review-pending><Clock className="size-4 text-accent-text" aria-hidden />{PENDING_TEXT}</p>}
          <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            {p.teams.length > 0 && (
              <div>
                <dt className="text-xs text-text-muted">{p.teams.length === 1 ? "Team" : "Teams"}</dt>
                <dd className="mt-0.5 flex flex-wrap gap-x-3">{p.teams.map((t) => <Link key={t.number} to={`/teams/${t.number}`} className="font-medium hover:underline">{t.name ? `${t.name} (${t.number})` : `Team ${t.number}`}</Link>)}</dd>
              </div>
            )}
            <div><dt className="text-xs text-text-muted">Videos</dt><dd className="mt-0.5 font-semibold tabular-nums" data-profile-videos>{p.videos.length}</dd></div>
            <div><dt className="text-xs text-text-muted">Likes</dt><dd className="mt-0.5 font-semibold tabular-nums" data-profile-likes>{p.likes}</dd></div>
          </dl>
          {p.videos.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {p.videos.map((v) => <ProfileTile key={v.id} v={v} />)}
            </ul>
          ) : (
            <EmptyState icon={Video} title="No public videos yet" description={p.verified ? "Videos they add show here." : "Their videos show to their team only."} />
          )}
          {p.videos.length > 0 && (
            <p className="mt-6 max-w-[72ch] text-xs text-text-muted">Likes count the videos shown on this page. A team-only video shows only to people on that team.</p>
          )}
        </div>
      )}
    </Async>
  );
}

function ProfileTile({ v }: { v: ProfileVideo }) {
  const won = v.red != null && v.blue != null ? (v.red > v.blue ? "red" : v.blue > v.red ? "blue" : null) : null;
  return (
    <li className="min-w-0" data-profile-tile={v.key}>
      <button type="button" onClick={() => playMatchVideo({ videoId: v.videoId, t: v.t, label: v.label, matchKey: v.key })}
        className="group relative block aspect-video w-full overflow-hidden rounded-lg border border-line bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Play ${v.label} at ${v.event}`}>
        <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-90 group-hover:opacity-100" />
        <span className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/40"><Play className="size-6 translate-x-px fill-current" aria-hidden /></span></span>
      </button>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <Link to={v.href} className="min-w-0 truncate text-sm font-semibold hover:underline">{v.label} · <span className="font-normal text-text-muted">{v.event}</span></Link>
        {v.red != null && v.blue != null && (
          <span className="shrink-0 text-sm tabular-nums">
            <span className={cn("text-red-alliance-text", won === "red" && "font-bold")}>{v.red}</span><span className="text-text-muted">–</span><span className={cn("text-blue-alliance-text", won === "blue" && "font-bold")}>{v.blue}</span>
          </span>
        )}
      </div>
      <VideoCredit c={{ ...v, profile: null }} size="sm" />
    </li>
  );
}
