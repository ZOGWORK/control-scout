// A played match's videos people added, on its page (docs/contributors.md), in the open, never behind a fold:
//   - the video this viewer may see, when it's the one the match plays (FIRST's own video first, src/shared/contributors.ts
//     pickMatchVideo), with its credit;
//   - the way to add one: "Get Verified" first for anyone not verified (signed out: sign in to apply), "Review Pending"
//     while an application waits, "Add a Link" (public) once verified, and "Share with your team" for an unverified
//     account on a team. Each shows "Will show as: Video by <name>" first. A personal link stays in the Video section
//     below, on the device, as before.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Clock, Globe2, Link2, Users } from "lucide-react";
import type { MatchView } from "../../shared/api";
import { DISCOVERY_NOTE, PENDING_TEXT, NOT_APPROVED_TEXT, pickMatchVideo, tierLabel, type MembershipTeam, type MyContributorStatus } from "../../shared/contributors";
import { creditLine } from "../../shared/username";
import { addVideo, announceVideosChanged, useMatchVideos, useReloadOnVideoChange, type AddVideoBody } from "../../lib/contributors";
import { usePersonal } from "../../lib/personal";
import { useAccountSetup } from "../AccountSetup";
import { useOpenSignIn } from "../layout/AccountMenu";
import { ContributorPlayer } from "./ContributorPlayer";
import { Button } from "../ui/button";
import { FieldError, Input } from "../ui/basic";
import { toast } from "../ui/sonner";
import { cn } from "../cn";

export function MatchContributorPanel({ m }: { m: MatchView }) {
  const { user } = usePersonal();
  const state = useMatchVideos(m.season, m.code, m.key);
  useReloadOnVideoChange(state.reload);
  if (!m.played) return null;
  const d = state.data;
  const pick = d ? pickMatchVideo(m.video, d.video, m.clip) : null;
  const teamName = (n: number | null) => d?.me?.teams.find((t) => t.number === n)?.name ?? null;
  return (
    <section className="mt-7 space-y-4" aria-label="Match videos people added" data-videos-path={state.data ? "match" : undefined}>
      {pick?.kind === "contributor" && <ContributorPlayer v={pick.video} label={m.label} teamName={teamName(pick.video.team)} />}
      {d && <AddArea m={m} me={d.me ?? null} own={d.own ?? []} signedIn={!!user} firstPlays={!!m.video} />}
    </section>
  );
}

const BOX = "rounded-xl border border-line bg-card p-4";

function AddArea({ m, me, own, signedIn, firstPlays }: { m: MatchView; me: MyContributorStatus | null; own: { id: number; shown: boolean; tier: string; team: number | null; name: string }[]; signedIn: boolean; firstPlays: boolean }) {
  const openSignIn = useOpenSignIn();
  const { ensure } = useAccountSetup();
  if (!signedIn || !me) {
    return (
      <div className={cn(BOX, "flex flex-wrap items-center justify-between gap-3")} data-add-video="signed-out">
        <p className="min-w-0 text-sm text-text-muted">Recorded this match? Verified contributors add match videos for everyone.</p>
        <Button variant="secondary" onClick={() => { toast("Sign in to apply to add videos."); openSignIn(); }} data-get-verified><BadgeCheck /> Get Verified</Button>
      </div>
    );
  }
  const status = me.status;
  const teams = me.teams;
  const mineLines = own.length > 0 && (
    <ul className="space-y-1 text-xs text-text-muted" data-own-videos>
      {own.map((o) => <li key={o.id}>Your video: {tierLabel({ tier: o.tier as "public", team: o.team }, teams.find((t) => t.number === o.team)?.name)}{o.shown ? "" : firstPlays ? " · not playing: FIRST's official video plays first" : " · not playing: this match already has a video (the site owner can swap them)"}</li>)}
    </ul>
  );
  if (!me.ready) {
    return (
      <div className={cn(BOX, "flex flex-wrap items-center justify-between gap-3")} data-add-video="setup">
        <p className="min-w-0 text-sm text-text-muted">Adding match videos needs a username and your actual name.</p>
        <Button variant="secondary" onClick={() => void ensure()}>Add a username</Button>
      </div>
    );
  }
  if (status === "verified") {
    return (
      <div className="space-y-2">
        <AddForm m={m} me={me} mode="public" teams={teams} />
        {mineLines}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className={cn(BOX, "flex flex-wrap items-center justify-between gap-3")} data-add-video={status}>
        {status === "pending" ? (
          <p className="flex items-center gap-2 text-sm font-medium" data-review-pending><Clock className="size-4 text-accent-text" aria-hidden />{PENDING_TEXT}</p>
        ) : (
          <>
            <div className="min-w-0 text-sm">
              {status === "revoked" ? <p className="font-medium">Your public publishing was revoked.</p>
                : status === "rejected" ? <p className="font-medium">Not verified yet. <span className="font-normal text-text-muted">{me.rejected?.reason ?? NOT_APPROVED_TEXT}</span></p>
                  : <p className="text-text-muted">Want this video public for everyone? Verified contributors' links show to the whole world.</p>}
            </div>
            {status !== "revoked" && (me.rejected?.reapplyAfter
              ? <p className="text-xs text-text-muted">You can re-apply after {new Date(me.rejected.reapplyAfter).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.</p>
              : <Button asChild variant="secondary"><Link to="/get-verified" data-get-verified><BadgeCheck /> Get Verified</Link></Button>)}
          </>
        )}
      </div>
      {teams.length ? <AddForm m={m} me={me} mode="team" teams={teams} /> : (
        <p className="text-sm text-text-muted" data-no-team>Add a team to share with your team, or get verified to share with everyone. Until then, a link you add in Video below stays on your own list.</p>
      )}
      {mineLines}
    </div>
  );
}

type Ask = { code: "long" | "duplicate"; text: string; href?: string };

function AddForm({ m, me, mode, teams }: { m: MatchView; me: MyContributorStatus; mode: "public" | "team"; teams: MembershipTeam[] }) {
  const [url, setUrl] = useState("");
  const [team, setTeam] = useState<number | null>(teams[0]?.number ?? null);
  const [t, setT] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [confirmed, setConfirmed] = useState<{ long?: boolean; duplicate?: boolean }>({});
  const [busy, setBusy] = useState(false);
  const { ensure } = useAccountSetup();
  const ids = { url: useId(), err: useId(), t: useId() };
  const teamOf = (n: number | null) => teams.find((x) => x.number === n);
  const send = async (more: { long?: boolean; duplicate?: boolean } = {}) => {
    if (!(await ensure())) return;
    const c = { ...confirmed, ...more };
    setConfirmed(c); setBusy(true); setErr(null);
    const seconds = parseTime(t);
    const body: AddVideoBody = { url: url.trim(), team: mode === "team" ? team : null, t: seconds, confirmLong: !!c.long, confirmDuplicate: !!c.duplicate };
    try {
      const r = await addVideo(m.season, m.code, m.key, body);
      setUrl(""); setT(""); setAsk(null); setConfirmed({});
      toast.success(r.shown ? tierLabel(r.video, teamOf(r.video.team)?.name) : r.firstPlays ? "Saved. FIRST's official video plays first for this match, so yours doesn't show yet." : `Saved. This match already has a video by ${r.occupiedBy ?? "someone else"}, so yours doesn't show yet: the site owner can swap them.`);
      if (r.warnings.includes("unchecked")) toast("Couldn't check this video — if it's private or deleted, it won't play.");
      if (r.warnings.includes("region")) toast("YouTube says this video is blocked in some countries, so it may not play for everyone.");
      announceVideosChanged();
    } catch (e: any) {
      const b = e?.body as { code?: string; error?: string; duplicate?: { href: string } } | undefined;
      if (b?.code === "long" || b?.code === "duplicate") setAsk({ code: b.code, text: b.error ?? "", href: b.duplicate?.href });
      else setErr(b?.error ?? e?.message ?? "Not added.");
    } finally { setBusy(false); }
  };
  const isPublic = mode === "public";
  return (
    <form className={cn(BOX, isPublic && "border-accent/50")} noValidate onSubmit={(e) => { e.preventDefault(); void send(); }} data-add-form={mode}>
      <p className="flex items-center gap-2 font-display text-base font-semibold">
        {isPublic ? <Globe2 className="size-4 text-accent-text" aria-hidden /> : <Users className="size-4 text-accent-text" aria-hidden />}
        {isPublic ? "Add a Link — public, for everyone" : "Share with your team"}
      </p>
      <p className="mt-1 text-xs text-text-muted" data-credit-preview>
        Will show as: <span className="font-medium text-text-base">{me.credit ?? creditLine("you")}</span>
        {isPublic ? " · PUBLIC: everyone can see it, signed in or not." : <> · Visible to {teamOf(team)?.name ? `${teamOf(team)!.name} (${team})` : `team ${team}`} only.</>}
      </p>
      {!isPublic && teams.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which team">
          {teams.map((x) => (
            <button key={x.number} type="button" role="radio" aria-checked={team === x.number} onClick={() => setTeam(x.number)}
              className={cn("min-h-9 rounded-md border px-2.5 text-xs pointer-coarse:min-h-11", team === x.number ? "border-accent bg-accent/10 font-semibold" : "border-line text-text-muted")}>{x.name ?? `Team ${x.number}`} ({x.number})</button>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2 max-sm:flex-col">
        <label htmlFor={ids.url} className="sr-only">YouTube link for {m.label}</label>
        <Input id={ids.url} value={url} onChange={(e) => { setUrl(e.target.value); setErr(null); setAsk(null); setConfirmed({}); }} placeholder="https://youtu.be/…" inputMode="url" autoCapitalize="none" spellCheck={false}
          className="h-11 min-w-0 flex-1 text-base sm:h-10 sm:text-sm" aria-invalid={err ? true : undefined} aria-describedby={err ? ids.err : undefined} />
        <Button type="submit" disabled={busy || !url.trim()} className="max-sm:min-h-11"><Link2 /> {busy ? "Checking…" : isPublic ? "Publish for everyone" : "Share with my team"}</Button>
      </div>
      <FieldError id={ids.err}>{err}</FieldError>
      {ask && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert" data-add-warning={ask.code}>
          <p>{ask.text}{ask.href && <> <Link to={ask.href} className="underline">Check it</Link></>}</p>
          {ask.code === "long" && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={ids.t} className="text-xs">Match starts at</label>
              <Input id={ids.t} value={t} onChange={(e) => setT(e.target.value)} placeholder="12:34" className="h-10 w-24" inputMode="numeric" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void send(ask.code === "long" ? { long: true } : { duplicate: true })} disabled={busy}>
              {ask.code === "duplicate" ? `Yes, use it for ${m.label} too` : t ? "Use this start time" : "Publish anyway"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAsk(null); setConfirmed({}); }}>Cancel</Button>
          </div>
        </div>
      )}
      {!isPublic && <p className="mt-2 text-[11px] text-text-muted">{DISCOVERY_NOTE}</p>}
    </form>
  );
}

/** "12:34", "1:02:05" or "754" → seconds; blank or unreadable → null. */
export function parseTime(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  const p = v.split(":").map(Number);
  if (p.some((x) => !Number.isFinite(x)) || p.length > 3) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
}
