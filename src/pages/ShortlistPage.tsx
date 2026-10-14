// Shortlist: bookmarked teams in one sortable table (for alliance selection
// prep), exportable to CSV.
import { Link } from "react-router-dom";
import { Bookmark, CalendarDays, Scale, Search, X } from "lucide-react";
import { useSearch } from "../components/layout/Search";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { TeamSummary } from "../shared/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { SortTable, type Col } from "../components/SortTable";
import { SeasonToggle } from "../components/SeasonToggle";
import { num } from "../lib/format";
import { useState } from "react";

export default function ShortlistPage() {
  useTitle("Shortlist");
  const search = useSearch();
  const { state, update, user } = usePersonal();
  const current = useCurrentSeason();
  const [season, setSeason] = useState(current);
  const list = state.bookmarks;
  const data = useApi<{ teams: TeamSummary[] }>(list.length ? `/api/teams-summary${qs({ teams: list.slice(0, 100).join(","), season })}` : null);
  const remove = (t: number) => update("bookmarks", (b) => b.filter((x) => x !== t));
  const cols: Col<TeamSummary>[] = [
    { key: "team", label: "Team", value: (r) => r.team, render: (r) => <Link to={`/teams/${r.team}?season=${season}`} className="hover:underline"><span className="font-mono font-medium">{r.team}</span> <span className="text-muted-foreground">{r.name}</span></Link> },
    { key: "place", label: "From", value: (r) => r.place, hideOnMobile: true, className: "max-w-48 truncate text-muted-foreground" },
    { key: "opr", label: "OPR", value: (r) => r.opr, align: "right", render: (r) => num(r.opr) },
    { key: "rank", label: "World", title: "World OPR rank", value: (r) => r.oprRank, asc: true, align: "right", render: (r) => (r.oprRank ? `#${r.oprRank}` : "—") },
    { key: "rating", label: "Rating", value: (r) => r.rating, align: "right", render: (r) => (r.rating ? <span>{num(r.rating)} <span className="text-muted-foreground">±{num(r.ratingSd, 0)}</span></span> : "—") },
    { key: "record", label: "W-L-T", value: (r) => r.record, align: "right", render: (r) => r.record ?? "—" },
    { key: "last", label: "Last event", value: (r) => r.lastEvent?.name ?? null, hideOnMobile: true, className: "max-w-56 truncate", render: (r) => r.lastEvent ? `${r.lastEvent.name}${r.lastEvent.rank ? ` (#${r.lastEvent.rank})` : ""}` : "—" },
    { key: "x", label: "", value: () => null, render: (r) => <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.team}`} onClick={() => remove(r.team)}><X /></Button> },
  ];
  return (
    <div>
      <PageHeader title="Shortlist" description={<>Teams you've bookmarked — handy for alliance selection. {user ? "Synced to your account." : <>Saved on this device; <Link to="/settings?section=profile" className="underline">sign in</Link> to sync.</>}</>}
        actions={list.length >= 2 ? <Button variant="secondary" asChild><Link to={`/compare?teams=${list.slice(0, 4).join(",")}`}><Scale /> Compare first {Math.min(4, list.length)}</Link></Button> : undefined}>
        <SeasonToggle value={season} onChange={setSeason} />
      </PageHeader>
      {!list.length ? <EmptyState icon={Bookmark} title="Your shortlist is empty" description="Press Shortlist on any team page to add it here. Building a pick list? An event's Rankings tab is the place to start." action={<div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={search.open}><Search /> Find a team</Button><Button variant="outline" asChild><Link to="/events"><CalendarDays /> Browse events</Link></Button></div>} /> : (
        <Async state={data}>{(d) => <SortTable rows={d.teams} cols={cols} rowKey={(r) => r.team} initial={{ key: "opr", dir: "desc" }} csvName={`shortlist-${season}`} />}</Async>
      )}
    </div>
  );
}
