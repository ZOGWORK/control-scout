// /demo: open the demo account (server/demo/demo.ts, docs/demo.md), a shared read-only account with every personal
// feature already in use, and the tour of what to look at in it. Signed into the demo, the same page is the tour.
// Entering puts this device's own data aside and leaving puts it back (src/lib/personal.tsx), so nothing mixes.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, BookmarkCheck, CalendarDays, ClipboardList, Eye, History, ListOrdered, LogOut, PlaySquare, Settings, Shield, Sparkles,
  Star, UserRound, Users, type LucideIcon,
} from "lucide-react";
import { useTitle } from "../lib/meta";
import { apiFetch, useApi } from "../lib/api";
import { usePersonal } from "../lib/personal";
import { PageHeader } from "../components/page";
import { Button } from "../components/ui/button";
import { ShortVersion } from "../components/legal";
import { cn } from "../components/cn";
import type { DemoSummary } from "../shared/demo";
import { OPEN_INBOX } from "../components/layout/InboxBell";
import { readScoutSession, writeScoutSession } from "../lib/scoutSession";
import { DEFAULT_WATCHING } from "../shared/scoutMatch";

/** The inbox is a panel under the bell, not a page: its stop opens it. */
const INBOX = "#inbox";
interface Stop { icon: LucideIcon; title: string; body: string; to: string }

/** The workflows the demo shows, in the order a team would meet them. */
function stops(d: DemoSummary | null): Stop[] {
  const ws = d ? `space=${encodeURIComponent(d.workspaceId)}&season=${d.season}` : "";
  const event = d ? `/events/${d.season}/${d.eventCode}` : "/events";
  return [
    { icon: UserRound, title: "My team", body: d ? `Following ${d.myTeam} ${d.myTeamName}: next match, form, rating and schedule in one place.` : "Your team's next match, form and rating in one place.", to: "/my-team" },
    { icon: CalendarDays, title: "The event", body: d ? `${d.eventName}: rankings, odds of advancing, the bracket and every match.` : "Rankings, advancement odds and the bracket.", to: event },
    { icon: Star, title: "Shortlist", body: "Eight teams in pick order, with private notes and colours for alliance selection.", to: "/shortlist" },
    { icon: Sparkles, title: "Saved predictions", body: "Matchups saved from the prediction lab, with the engine's win chance and confidence.", to: "/predict" },
    { icon: Users, title: "Team scouting workspace", body: "Five scouts' match and pit entries for the whole event, with comments.", to: d ? `/scout?${ws}` : "/scout" },
    { icon: ListOrdered, title: "Shared pick list", body: "The team's ranked pick list, with notes from the scouts.", to: d ? `/scout?${ws}&view=picklist` : "/scout" },
    { icon: ClipboardList, title: "Assignments", body: "Who scouts which robot each match, and which pit visits are done.", to: d ? `/scout?${ws}&view=assignments` : "/scout" },
    { icon: History, title: "Activity", body: "Everything the team changed, newest first.", to: d ? `/scout?${ws}&view=activity` : "/scout" },
    { icon: BookmarkCheck, title: "Personal scouting", body: "Your own pit and match notes, kept apart from the team's.", to: "/scout?space=personal" },
    { icon: PlaySquare, title: "Video library", body: "Saved videos, a watch-later queue, history, and notes at a moment in a video.", to: "/videos/saved" },
    { icon: Bell, title: "Inbox", body: "Comments, assignments and pick list changes, under the bell at the top right.", to: INBOX },
    { icon: Settings, title: "Settings", body: "Notifications, the weekly email and how the app looks.", to: "/settings?section=notifications" },
  ];
}

export default function DemoPage() {
  useTitle("Demo account");
  const { user, signOut } = usePersonal();
  const summary = useApi<{ demo: DemoSummary | null }>("/api/auth/demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inDemo = !!user?.demo;
  const d = summary.data?.demo ?? null;
  // In the demo, its workspace opens on the demo's event, not the picker (a device's choice, lib/scoutSession.ts; only the
  // demo workspace's, never Personal's, which is this device's own: leaving the demo removes it, lib/personal.tsx).
  useEffect(() => {
    if (!inDemo || !d || readScoutSession(d.workspaceId)?.eventCode === d.eventCode) return;
    writeScoutSession(d.workspaceId, { season: d.season, eventCode: d.eventCode, watching: DEFAULT_WATCHING });
  }, [inDemo, d]);

  const enter = async () => {
    setBusy(true); setError(null);
    try {
      // Signed into a real account: sign out first (its data stays on this device, and comes back when it signs in).
      if (user && !user.demo) await signOut();
      await apiFetch("/api/auth/demo", { method: "POST", json: {} });
      // A fresh load: the app reads the demo account from the start, its data swapped in for this device's own.
      window.location.assign("/demo");
    } catch (e) {
      setError((e as Error)?.message || "The demo couldn't open. Try again in a moment.");
      setBusy(false);
    }
  };
  const leave = async () => { setBusy(true); await signOut(); window.location.assign("/"); };

  return (
    <div className="space-y-6">
      <PageHeader
        title={inDemo ? "You're in the demo account" : "See Control Scout fully set up"}
        description={inDemo
          ? "A shared account with every feature in use. Look around: nothing you change here is saved, and leaving puts your own data back."
          : "Open a demo account to see what Control Scout looks like for a team using all of it: a followed team, a shortlist, saved predictions, a scouting workspace with five scouts, a pick list, assignments, videos and an inbox."}
        phoneDescription={inDemo ? "Look around: nothing you change here is saved." : "A demo account with every feature in use."}
        actions={inDemo
          ? <Button variant="outline" onClick={leave} disabled={busy}><LogOut /> Leave the demo</Button>
          : <Button size="lg" onClick={enter} disabled={busy} data-demo-enter><Eye /> {busy ? "Opening…" : "Open the demo account"}</Button>}
      />
      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">{error}</p>}
      {!inDemo && (
        <ShortVersion items={[
          { icon: Eye, tone: "accent", title: "Read-only", body: "Look at everything; changes aren't saved, so everyone sees the same demo." },
          { icon: Shield, tone: "success", title: "Your data stays yours", body: user ? "Opening it signs you out here. Your data stays on this device and on your account." : "What you've saved on this device is put aside, and back when you leave." },
          { icon: CalendarDays, tone: "info", title: "Real FTC data", body: d ? `Built from ${d.eventName} and refreshed every few hours.` : "Teams, events, matches and predictions are real, refreshed every few hours." },
          { icon: ClipboardList, tone: "warning", title: "Sample scouting", body: "Scouting answers, notes and comments are samples of what a team would write." },
        ]} />
      )}
      <section aria-labelledby="demo-tour" className="space-y-3">
        <h2 id="demo-tour" className="font-display text-lg font-semibold">{inDemo ? "Where to look" : "What's inside"}</h2>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stops(d).map((s, i) => (
            <li key={s.title} className="min-w-0">
              {inDemo && s.to === INBOX ? (
                <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_INBOX))} className="lift flex h-full w-full gap-3 rounded-xl border border-border bg-card p-3 text-left hover:border-accent/60" data-demo-stop>
                  <StopBody s={s} n={i + 1} />
                </button>
              ) : inDemo ? (
                <Link to={s.to} className={cn("lift flex h-full gap-3 rounded-xl border border-border bg-card p-3 hover:border-accent/60")} data-demo-stop>
                  <StopBody s={s} n={i + 1} />
                </Link>
              ) : (
                <div className="flex h-full gap-3 rounded-xl border border-border bg-card p-3"><StopBody s={s} n={i + 1} /></div>
              )}
            </li>
          ))}
        </ol>
      </section>
      {!inDemo && (
        <div className="flex justify-center">
          <Button size="lg" onClick={enter} disabled={busy} className="max-sm:w-full"><Eye /> {busy ? "Opening…" : "Open the demo account"}</Button>
        </div>
      )}
    </div>
  );
}

function StopBody({ s, n }: { s: Stop; n: number }) {
  const Icon = s.icon;
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-text" aria-hidden><Icon className="size-4" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold"><span className="sr-only">{n}. </span>{s.title}</span>
        <span className="block text-xs text-text-muted">{s.body}</span>
      </span>
    </>
  );
}
