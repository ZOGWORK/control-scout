// Owner console › Video contributors (docs/contributors.md, server/videos/ownerRoutes.ts). One queue of verification
// requests, invite claims and applications together, oldest first, each with its label, the sample video and the
// honest result of the checks. Then: approve someone directly or send an invite (its link shown this once), the
// contributors with their name history, the reports (grouped by link, most-reported first, 5+ flagged), every link
// with its actions, the invites, and the team roster. Nothing happens to a link on reports alone: only these buttons.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Copy, ExternalLink, Flag, Mail, Play, ShieldOff, Trash2, UserPlus, Users, Video } from "lucide-react";
import { Section, EmptyState } from "../page";
import { Async } from "../states";
import { Badge, Input, Textarea } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, markStale, useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import { thumbnailUrl } from "../../shared/stream";
import { APPLICANT_ROLE_LABEL, RECORDED_LABEL, REPORT_FLAG_AT, type ApplicantRole, type MembershipTeam, type RecordedChoice, type VideoTier } from "../../shared/contributors";
import { cn } from "../cn";

const PATH = "/api/owner/contributors";

interface Person { id: number; name: string | null; username: string | null; email: string | null }
interface App {
  id: number; teamNumber: number; teamName: string; role: ApplicantRole; roleOther: string | null; events: string; channelUrl: string; channelCheck: "yes" | "no" | "unknown";
  sampleUrl: string; sampleVideoId: string | null; recorded: RecordedChoice; why: string; extra: string | null; agreements: { text: string; checked: boolean }[]; submittedAt: string;
}
interface Request {
  user: Person; source: "invite" | "application"; since: string; teams: MembershipTeam[];
  invite: { intendedEmail: string; note: string | null; claimedAt: string | null; emailMatches: boolean } | null;
  application: App | null; history: { id: number; status: string; submittedAt: string }[];
}
interface Contributor {
  user: Person; status: string; source: string; decidedAt: string | null; decidedBy: string | null; reasonShared: string | null; privateNote: string | null;
  reapplyAfter: string | null; revokedAt: string | null; revokeReason: string | null; promoted: number; liveLinks: number; teams: MembershipTeam[];
  names: { at: string; field: "name" | "username"; from: string | null; to: string | null }[]; noName: boolean;
}
interface OwnerLink {
  id: number; match: string; label: string; event: string; href: string; videoId: string; url: string; t: number; contributor: Person;
  tier: VideoTier; team: number | null; status: string; createdAt: string; overFirst: boolean; preferred: boolean;
  alsoOn: { id: number; label: string; event: string }[]; facts: { status: string; length: number | null; region?: boolean; at: string } | null;
  openReports: number; likes: number; removedBy: string | null;
}
interface ReportGroup {
  link: OwnerLink; open: number; flagged: boolean; oldest: string; reasons: { reason: string; label: string; n: number }[];
  reports: { id: number; reason: string; label: string; note: string | null; at: string; reporter: Person; reporterDismissed: number }[];
}
interface Invite { id: string; email: string; note: string | null; createdAt: string; expiresAt: string; state: string; claimedBy: Person | null; claimedAt: string | null; noLongerNeeded: boolean }
interface RosterRow { team: number; teamName: string | null; user: Person; grantedBy: string; grantedAt: string; revokedAt: string | null; note: string | null }
export interface OwnerContributors {
  counts: { requests: number; reports: number }; requests: Request[]; contributors: Contributor[]; links: OwnerLink[]; recentlyRemoved: OwnerLink[];
  reports: ReportGroup[]; invites: Invite[]; roster: RosterRow[];
}

const who = (p: Person) => p.name?.trim() || p.username || p.email || `Account ${p.id}`;
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const teamsText = (ts: MembershipTeam[]) => ts.length ? ts.map((t) => `${t.name ? `${t.name} ` : ""}${t.number} (${t.sources.map((s) => (s === "controlPoint" ? "Control Point" : "roster")).join(" + ")})`).join(", ") : "No team on file";
const TIER_TEXT: Record<VideoTier, string> = { public: "Public", team: "Team only", self: "Only them" };
const CHANNEL_TEXT = { yes: "Channel found on YouTube", no: "No such channel on YouTube", unknown: "Couldn't check the channel (YouTube didn't answer)" } as const;

async function post<T = unknown>(path: string, json: unknown, method = "POST"): Promise<T> {
  return apiFetch<T>(path, { method, json });
}

export function ContributorsPanel() {
  const state = useApi<OwnerContributors>(PATH);
  const reload = () => { markStale(PATH); void state.reload(); };
  useEffect(() => {
    if (window.location.hash === "#reports" && state.data) document.getElementById("reports")?.scrollIntoView({ block: "start" });
  }, [state.data]);
  return (
    <Async state={state}>
      {(d) => (
        <div className="space-y-2" data-owner-contributors>
          <p className="mb-6 text-sm text-text-muted" data-owner-counts>{d.counts.requests} request{d.counts.requests === 1 ? "" : "s"} · {d.counts.reports} reported link{d.counts.reports === 1 ? "" : "s"}</p>
          <Section title="Requests" description="Invite claims and applications together, oldest first. Approving makes their links public; rejecting starts a 7-day wait.">
            {d.requests.length ? <ul className="space-y-4">{d.requests.map((r) => <RequestCard key={r.user.id} r={r} onDone={reload} />)}</ul>
              : <EmptyState icon={BadgeCheck} title="No requests waiting" description="New invite claims and applications show here." />}
          </Section>
          <Section title="Add a contributor" description="Approve someone you already know, or send them an invite link (single use, 14 days). Both need an existing account.">
            <AddContributor onDone={reload} />
          </Section>
          <Section id="reports" title="Reports" description={`Grouped by link, most-reported first. ${REPORT_FLAG_AT}+ reports are flagged. A link stays up until you act.`}>
            {d.reports.length ? <ul className="space-y-4">{d.reports.map((g) => <ReportCard key={g.link.id} g={g} onDone={reload} />)}</ul>
              : <EmptyState icon={Flag} title="No open reports" description="Reports people send from a video's menu show here." />}
          </Section>
          <Section title="Contributors" description="Everyone verified, revoked or rejected, newest decision first, with every name they've used.">
            {d.contributors.length ? <ul className="space-y-3">{d.contributors.map((c) => <ContributorCard key={c.user.id} c={c} onDone={reload} />)}</ul>
              : <EmptyState icon={Users} title="No contributors yet" description="Approved and rejected people show here." />}
          </Section>
          <Section title="Links" collapsible summary={`${d.links.length} live or hidden link${d.links.length === 1 ? "" : "s"}, newest first`} description="Every live or hidden link, newest first. Team-only contributors' links are here too.">
            {d.links.length ? <ul className="space-y-3">{d.links.map((l) => <LinkCard key={l.id} l={l} onDone={reload} />)}</ul>
              : <EmptyState icon={Video} title="No links yet" description="Videos people add to matches show here." />}
          </Section>
          {d.recentlyRemoved.length > 0 && (
            <Section title="Recently removed" collapsible summary={`${d.recentlyRemoved.length} removed link${d.recentlyRemoved.length === 1 ? "" : "s"}`}>
              <ul className="space-y-2">{d.recentlyRemoved.map((l) => (
                <li key={l.id} className="rounded-lg border border-line p-3 text-sm"><Link to={l.href} className="font-medium hover:underline">{l.label} · {l.event}</Link> <span className="text-text-muted">by {who(l.contributor)} · removed by {l.removedBy ?? "—"}</span></li>
              ))}</ul>
            </Section>
          )}
          <Section title="Invites" description="Newest first. The link itself was shown once, when made; only its hash is kept.">
            {d.invites.length ? <ul className="space-y-2">{d.invites.map((i) => <InviteRow key={i.id} i={i} onDone={reload} />)}</ul>
              : <EmptyState icon={Mail} title="No invites yet" description="Make one under Add a contributor." />}
          </Section>
          <Section title="Team roster" description="People you put on a team by hand, for team-only videos (Control Point workspaces count without this).">
            <RosterSection rows={d.roster} onDone={reload} />
          </Section>
        </div>
      )}
    </Async>
  );
}

function Card({ children, className, ...rest }: { children: ReactNode; className?: string; [k: `data-${string}`]: string | undefined }) {
  return <li className={cn("rounded-xl border border-line bg-card p-4", className)} {...rest}>{children}</li>;
}

function useAct(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onDone(); }
    catch (e) { toast.error((e as ApiError).message); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

function Sample({ id, url }: { id: string | null; url: string }) {
  const [on, setOn] = useState(false);
  if (!id) return <a href={url} target="_blank" rel="noreferrer noopener" className="text-sm underline">{url}</a>;
  return (
    <div className="w-full max-w-sm">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-black">
        {on ? <iframe className="absolute inset-0 size-full" src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title="Sample video" allow="autoplay; encrypted-media; fullscreen" />
          : (
            <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 grid place-items-center" aria-label="Play the sample video">
              <img src={thumbnailUrl(id)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-85 group-hover:opacity-100" />
              <span className="relative grid size-12 place-items-center rounded-full bg-black/70 text-white"><Play className="size-6 translate-x-px fill-current" aria-hidden /></span>
            </button>
          )}
      </div>
      <a href={url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted underline">Open on YouTube <ExternalLink className="size-3" aria-hidden /></a>
    </div>
  );
}

function RequestCard({ r, onDone }: { r: Request; onDone: () => void }) {
  const { busy, run } = useAct(onDone);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const a = r.application;
  return (
    <Card data-request={r.source}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={r.source === "invite" ? "info" : "soft"}>{r.source === "invite" ? "Invite" : "Application"}</Badge>
        <span className="font-semibold">{who(r.user)}</span>
        {r.user.username && <span className="text-sm text-text-muted">@{r.user.username}</span>}
        <span className="text-sm text-text-muted">{r.user.email} · waiting {ago(r.since)}</span>
      </div>
      <p className="mt-1 text-sm text-text-muted">Teams: {teamsText(r.teams)}</p>
      {r.invite && (
        <p className={cn("mt-1 text-sm", r.invite.emailMatches ? "text-text-muted" : "font-medium text-warning")}>
          Invite for {r.invite.intendedEmail}{r.invite.emailMatches ? "" : " — claimed by a different email"}{r.invite.note ? ` · note: ${r.invite.note}` : ""}
        </p>
      )}
      {a && (
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-text-muted">1. Team</dt><dd>{a.teamName} ({a.teamNumber})</dd>
          <dt className="text-text-muted">2. Role</dt><dd>{a.role === "other" ? a.roleOther : APPLICANT_ROLE_LABEL[a.role] ?? a.role}</dd>
          <dt className="text-text-muted">3. Events</dt><dd className="whitespace-pre-wrap">{a.events}</dd>
          <dt className="text-text-muted">4. Channel</dt>
          <dd><a href={a.channelUrl} target="_blank" rel="noreferrer noopener" className="underline">{a.channelUrl}</a><span className={cn("ml-2 text-xs", a.channelCheck === "no" ? "text-danger" : "text-text-muted")} data-channel-check={a.channelCheck}>{CHANNEL_TEXT[a.channelCheck]}</span></dd>
          <dt className="text-text-muted">5. Sample</dt><dd><Sample id={a.sampleVideoId} url={a.sampleUrl} /></dd>
          <dt className="text-text-muted">6. Recorded by</dt><dd>{RECORDED_LABEL[a.recorded] ?? a.recorded}</dd>
          <dt className="text-text-muted">7. Why</dt><dd className="whitespace-pre-wrap">{a.why}</dd>
          {a.extra && <><dt className="text-text-muted">8. Anything else</dt><dd className="whitespace-pre-wrap">{a.extra}</dd></>}
          <dt className="text-text-muted">Checks</dt><dd data-honest-check>{a.sampleVideoId ? "Checked: link exists and plays." : "Checked: couldn't confirm the link plays (YouTube didn't answer)."} Not checked: that this person recorded it.</dd>
          <dt className="text-text-muted">Agreements</dt><dd>{a.agreements.every((x) => x.checked) ? "All five ticked" : `${a.agreements.filter((x) => x.checked).length} of 5 ticked`}</dd>
        </dl>
      )}
      {r.history.length > 1 && <p className="mt-2 text-xs text-text-muted">Applications from this account: {r.history.map((h) => `${day(h.submittedAt)} ${h.status}`).join(" · ")}</p>}
      {rejecting ? (
        <div className="mt-3 space-y-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason to share with them (optional)" aria-label="Reason to share" />
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Private note, only you see it (optional)" aria-label="Private note" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() => post(`${PATH}/${r.user.id}/reject`, { reason, privateNote: note }), `Rejected ${who(r.user)}`)}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => run(() => post(`${PATH}/${r.user.id}/approve`, {}), `Approved ${who(r.user)}`)} data-approve><BadgeCheck /> Approve</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(true)} data-reject>Reject…</Button>
        </div>
      )}
    </Card>
  );
}

function AddContributor({ onDone }: { onDone: () => void }) {
  const { busy, run } = useAct(onDone);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const invite = () => run(async () => {
    const r = await post<{ link: string; expiresAt: string }>(`${PATH}/invites`, { email, note });
    setLink(r.link);
  }, "Invite made: copy the link now");
  return (
    <div className="max-w-xl space-y-2">
      <Input value={email} onChange={(e) => { setEmail(e.target.value); setLink(null); }} placeholder="Their account's email" type="email" aria-label="Email" className="h-10" />
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the invite (optional, only you see it)" aria-label="Invite note" className="h-10" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !email.trim()} onClick={invite} data-make-invite><Mail /> Make invite link</Button>
        <Button size="sm" variant="outline" disabled={busy || !email.trim()} onClick={() => run(() => post(`${PATH}/verify-by-email`, { email }), "Verified")} data-direct-approve><UserPlus /> Approve directly</Button>
      </div>
      {link && (
        <div className="rounded-lg border border-accent/50 bg-accent/[0.06] p-3 text-sm" data-invite-link>
          <p className="font-medium">This link shows only now. Send it to them yourself.</p>
          <div className="mt-2 flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="h-10 font-mono text-xs" />
            <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(link).then(() => toast.success("Copied"), () => toast.error("Copy it by hand")); }}><Copy /> Copy</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContributorCard({ c, onDone }: { c: Contributor; onDone: () => void }) {
  const { busy, run } = useAct(onDone);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const tone = c.status === "verified" ? "success" : c.status === "revoked" ? "destructive" : "secondary";
  // Every change of actual name or username, oldest first (from the audit log).
  const changes = c.names.filter((n) => n.from !== n.to);
  return (
    <Card data-contributor={c.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tone}>{c.status[0].toUpperCase() + c.status.slice(1)}</Badge>
        <span className="font-semibold">{who(c.user)}</span>
        {c.user.username && <Link to={`/contributors/${c.user.username}`} className="text-sm text-text-muted hover:underline">@{c.user.username}</Link>}
        <span className="text-sm text-text-muted">{c.user.email}</span>
        {c.noName && <Badge variant="destructive">No actual name</Badge>}
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {c.source === "invite" ? "Invite" : c.source === "direct" ? "Approved directly" : "Application"} · decided {day(c.decidedAt)}{c.decidedBy ? ` by ${c.decidedBy}` : ""} · {c.liveLinks} live link{c.liveLinks === 1 ? "" : "s"}{c.promoted ? ` · ${c.promoted} made public on approval` : ""}
      </p>
      <p className="mt-0.5 text-sm text-text-muted">Teams: {teamsText(c.teams)}</p>
      {changes.length > 0 && <p className="mt-0.5 text-xs text-text-muted" data-name-history>Name history: {changes.map((n) => `${n.field === "username" ? "username" : "name"} ${n.from ?? "none"} → ${n.to ?? "none"} (${day(n.at)})`).join("; ")}</p>}
      {c.reasonShared && <p className="mt-0.5 text-xs text-text-muted">Told them: {c.reasonShared}</p>}
      {c.privateNote && <p className="mt-0.5 text-xs text-text-muted">Private note: {c.privateNote}</p>}
      {c.revokeReason && <p className="mt-0.5 text-xs text-text-muted">Revoked {day(c.revokedAt)}: {c.revokeReason}</p>}
      {c.status === "rejected" && c.reapplyAfter && <p className="mt-0.5 text-xs text-text-muted">Can re-apply after {day(c.reapplyAfter)}</p>}
      {c.status === "verified" && (revoking ? (
        <div className="mt-3 space-y-2">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Why (only you see it)" aria-label="Revoke reason" />
          <p className="text-xs text-text-muted">Their links drop to their team, or to only them when they're not on the link's team. Nothing is deleted.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(() => post(`${PATH}/${c.user.id}/revoke`, { reason }), `Revoked ${who(c.user)}`)}>Revoke</Button>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(false)}>Cancel</Button>
          </div>
        </div>
      ) : <Button size="sm" variant="outline" className="mt-3" onClick={() => setRevoking(true)} data-revoke><ShieldOff /> Revoke…</Button>)}
      {(c.status === "revoked" || c.status === "rejected") && (
        <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => run(() => post(`${PATH}/${c.user.id}/approve`, { direct: true }), `Verified ${who(c.user)}`)}><BadgeCheck /> Verify again</Button>
      )}
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  hide: "Hide", unhide: "Show again", teamOnly: "Make team only", selfOnly: "Only them", publish: "Publish", prefer: "Pick for this match",
  overFirst: "Play before FIRST's video", underFirst: "FIRST's video first", check: "Check on YouTube", remove: "Remove", dismiss: "Dismiss reports",
};

function LinkActions({ l, onDone, extra = [] }: { l: OwnerLink; onDone: () => void; extra?: string[] }) {
  const { busy, run } = useAct(onDone);
  const acts = [
    ...extra,
    l.status === "hidden" ? "unhide" : "hide",
    l.tier !== "public" ? "publish" : null,
    l.tier !== "team" && l.team != null ? "teamOnly" : null,
    l.tier !== "self" ? "selfOnly" : null,
    l.preferred ? null : "prefer",
    l.overFirst ? "underFirst" : "overFirst",
    "check",
  ].filter(Boolean) as string[];
  const act = (a: string) => {
    if (a === "remove" && !window.confirm(`Remove ${l.label} by ${who(l.contributor)} for everyone? Its likes go with it.`)) return;
    void run(() => post(`${PATH}/links/${l.id}`, { action: a }), `${ACTION_LABEL[a]}: done`);
  };
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {acts.map((a) => <Button key={a} size="sm" variant="outline" disabled={busy} onClick={() => act(a)} data-link-action={a}>{ACTION_LABEL[a]}</Button>)}
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => act("remove")} data-link-action="remove"><Trash2 /> Remove</Button>
    </div>
  );
}

function LinkHead({ l }: { l: OwnerLink }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <a href={l.url} target="_blank" rel="noreferrer noopener" className="shrink-0"><img src={thumbnailUrl(l.videoId)} alt="" loading="lazy" className="h-12 w-20 rounded object-cover" /></a>
        <div className="min-w-0">
          <Link to={l.href} className="font-semibold hover:underline">{l.label} · {l.event}</Link>
          <p className="text-sm text-text-muted">by {who(l.contributor)}{l.contributor.username ? ` (@${l.contributor.username})` : ""} · {ago(l.createdAt)} · ♥ {l.likes}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        <Badge variant={l.tier === "public" ? "success" : "secondary"}>{TIER_TEXT[l.tier]}{l.tier === "team" && l.team ? ` · ${l.team}` : ""}</Badge>
        {l.status === "hidden" && <Badge variant="destructive">Hidden</Badge>}
        {l.preferred && <Badge variant="info">Picked</Badge>}
        {l.overFirst && <Badge variant="info">Before FIRST's</Badge>}
        {l.openReports > 0 && <Badge variant="destructive">{l.openReports} report{l.openReports === 1 ? "" : "s"}</Badge>}
        {l.facts && <span className="text-text-muted">YouTube {l.facts.status}{l.facts.length ? ` · ${Math.round(l.facts.length / 60)} min` : ""}{l.facts.region ? " · region-blocked somewhere" : ""} · checked {ago(l.facts.at)}</span>}
        {l.alsoOn.length > 0 && <span className="text-text-muted">Same video on {l.alsoOn.map((o) => `${o.label} (${o.event})`).join(", ")}</span>}
      </div>
    </>
  );
}

function LinkCard({ l, onDone }: { l: OwnerLink; onDone: () => void }) {
  return <Card data-owner-link={l.id}><LinkHead l={l} /><LinkActions l={l} onDone={onDone} /></Card>;
}

function ReportCard({ g, onDone }: { g: ReportGroup; onDone: () => void }) {
  return (
    <Card className={cn(g.flagged && "border-danger/60")} data-report-group={g.link.id}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {g.flagged && <Badge variant="destructive"><Flag /> {g.open} reports</Badge>}
        {!g.flagged && <Badge variant="secondary">{g.open} report{g.open === 1 ? "" : "s"}</Badge>}
        <span className="text-text-muted">{g.reasons.map((r) => `${r.label} ×${r.n}`).join(" · ")} · oldest {ago(g.oldest)}</span>
      </div>
      <LinkHead l={g.link} />
      <ul className="mt-2 space-y-1 text-xs text-text-muted">
        {g.reports.map((r) => (
          <li key={r.id}>{r.label}{r.note ? `: “${r.note}”` : ""} — {who(r.reporter)} {r.reporter.email ? `(${r.reporter.email})` : ""}, {ago(r.at)}{r.reporterDismissed ? ` · ${r.reporterDismissed} earlier report${r.reporterDismissed === 1 ? "" : "s"} dismissed` : ""}</li>
        ))}
      </ul>
      <LinkActions l={g.link} onDone={onDone} extra={["dismiss"]} />
    </Card>
  );
}

function InviteRow({ i, onDone }: { i: Invite; onDone: () => void }) {
  const { busy, run } = useAct(onDone);
  const tone = i.state === "valid" ? "success" : i.state === "claimed" ? "info" : "secondary";
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3 text-sm" data-invite-row={i.state}>
      <Badge variant={tone}>{i.state[0].toUpperCase() + i.state.slice(1)}</Badge>
      <span className="font-medium">{i.email}</span>
      <span className="text-text-muted">made {day(i.createdAt)} · {i.state === "valid" ? `until ${day(i.expiresAt)}` : i.claimedBy ? `claimed by ${who(i.claimedBy)} ${day(i.claimedAt)}` : ""}{i.note ? ` · ${i.note}` : ""}</span>
      {i.noLongerNeeded && <Badge variant="secondary">Already verified</Badge>}
      {i.state === "valid" && <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => run(() => post(`${PATH}/invites/${i.id}`, {}, "DELETE"), "Invite removed")}>Remove</Button>}
    </li>
  );
}

function RosterSection({ rows, onDone }: { rows: RosterRow[]; onDone: () => void }) {
  const { busy, run } = useAct(onDone);
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-4">
      <div className="flex max-w-2xl flex-wrap gap-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Account email" type="email" aria-label="Roster email" className="h-10 min-w-0 flex-1" />
        <Input value={team} onChange={(e) => setTeam(e.target.value.replace(/\D/g, ""))} placeholder="Team" inputMode="numeric" aria-label="Team number" className="h-10 w-24" />
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Roster note" className="h-10 min-w-0 flex-1" />
        <Button size="sm" className="h-10" disabled={busy || !email.trim() || !team} onClick={() => run(() => post(`${PATH}/roster`, { email, team: Number(team), note }), "Added to the roster")}><UserPlus /> Add</Button>
      </div>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={`${r.team}:${r.user.id}`} className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-line p-3 text-sm", r.revokedAt && "opacity-60")} data-roster-row>
              <span className="font-medium">{r.teamName ? `${r.teamName} ` : ""}{r.team}</span>
              <span>{who(r.user)} <span className="text-text-muted">{r.user.email}</span></span>
              <span className="text-text-muted">added {day(r.grantedAt)} by {r.grantedBy}{r.note ? ` · ${r.note}` : ""}{r.revokedAt ? ` · removed ${day(r.revokedAt)}` : ""}</span>
              {!r.revokedAt && <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => run(() => post(`${PATH}/roster/${r.team}/${r.user.id}`, {}, "DELETE"), "Removed from the roster")}>Remove</Button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-text-muted">No one on the roster yet.</p>}
    </div>
  );
}
