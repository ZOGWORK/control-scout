// Settings › Notifications › Email: the email digest switch (docs/digest.md). Off until turned on; signed in only
// (it's emailed to the account's address). The switch is stored on the server, not in the synced settings, so the
// email's unsubscribe link and a bounce change it everywhere at once. Turning it on sends nothing: the toast and the
// line under the switch confirm it. The first time an account turns it on, a welcome email says what to expect
// (server/digest/welcome.ts); the first digest comes within a few days (a few times a week at random times: no send day
// or time is named to members).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { optimistic } from "../../lib/optimistic";
import { usePersonal } from "../../lib/personal";
import { DIGEST_DESCRIPTION, type DigestStatus } from "../../shared/digest";
import { Switch } from "../ui/controls";
import { toast } from "../ui/sonner";
import { Group, Row } from "./rows";

export function DigestSetting() {
  const { user, state } = usePersonal();
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!user) { setStatus(null); return; }
    let live = true;
    setFailed(false);
    apiFetch<DigestStatus>("/api/digest").then((s) => { if (live) setStatus(s); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [user?.id]);

  // What this device follows right now (synced to the account), so the hint updates the moment a team is followed.
  const follows = new Set([...(state.myTeam ? [state.myTeam] : []), ...state.tracked.teams]).size;
  // The account signed in now: a tap still queued behind a slow one is dropped if it changed, never sent as the next one.
  const account = useRef(user?.id);
  account.current = user?.id;
  const change = (on: boolean) => {
    if (!status) return;
    const mine = user?.id;
    void optimistic({
      key: `digest:${mine}`,
      apply: () => { const before = status; setStatus({ ...status, enabled: on }); return () => setStatus(before); },
      send: () => apiFetch<DigestStatus>("/api/digest", { method: "PUT", json: { enabled: on } }),
      reconcile: setStatus,
      what: on ? "email digest on" : "email digest off",
      stale: () => account.current !== mine,
    }).then((r) => {
      if (r.ok && r.current) toast(!on ? "Email digest off. Nothing more will be sent." : r.value.welcomeSent ? "Email digest on. A welcome email is on its way." : "Email digest on. You'll get the first one within a few days.");
    });
  };

  let note: ReactNode = null;
  if (!user) note = <><Link to="/settings?section=profile" className="underline">Sign in</Link> to get it: it goes to your account's email.</>;
  else if (failed) note = "Couldn't load this setting. Check your connection and reload.";
  else if (status && !status.available && !status.enabled) note = "Email isn't available on this server right now.";
  else if (status?.bounced) note = "Your last digest bounced, so we turned it off. Turn it back on to try again.";
  else if (status?.enabled) note = follows
    ? <>On. It goes to <span className="font-medium text-foreground">{status.email}</span> a few times a week.</>
    : <>On, but you don't follow any teams yet, so there's nothing to send. Pick <Link to="/my-team" className="underline">your team</Link> or track teams from their pages.</>;

  return (
    <Group title="Email" description="Opt-in. Besides this, Control Scout only ever emails you sign-in codes.">
      <Row label="Email digest" htmlFor="digest-weekly" description={<>{DIGEST_DESCRIPTION}{note && <span className="mt-1 block">{note}</span>}</>}>
        <Switch id="digest-weekly" checked={!!status?.enabled} disabled={!user || !status || (!status.available && !status.enabled)} onCheckedChange={change} />
      </Row>
    </Group>
  );
}
