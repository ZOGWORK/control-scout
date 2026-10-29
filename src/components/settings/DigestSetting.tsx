// Settings › Notifications › Email: the weekly digest switch (docs/digest.md). Off until turned on; signed in only
// (it's emailed to the account's address). The switch is stored on the server, not in the synced settings, so the
// email's unsubscribe link and a bounce change it everywhere at once. Turning it on sends nothing: the toast and the
// line under the switch confirm it, and the first digest comes with the next week's round-up (no send day or time is named to members).
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { DIGEST_DESCRIPTION, type DigestStatus } from "../../shared/digest";
import { Switch } from "../ui/controls";
import { toast } from "../ui/sonner";
import { Group, Row } from "./rows";

export function DigestSetting() {
  const { user, state } = usePersonal();
  const [status, setStatus] = useState<DigestStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!user) { setStatus(null); return; }
    let live = true;
    setFailed(false);
    apiFetch<DigestStatus>("/api/digest").then((s) => { if (live) setStatus(s); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [user?.id]);

  // What this device follows right now (synced to the account), so the hint updates the moment a team is followed.
  const follows = new Set([...(state.myTeam ? [state.myTeam] : []), ...state.tracked.teams]).size;
  const change = async (on: boolean) => {
    if (!status) return;
    const before = status;
    setStatus({ ...status, enabled: on });
    setBusy(true);
    try {
      setStatus(await apiFetch<DigestStatus>("/api/digest", { method: "PUT", json: { enabled: on } }));
      toast(on ? "Weekly digest on. The first one arrives with next week's round-up." : "Weekly digest off. Nothing more will be sent.");
    } catch (e) {
      setStatus(before);
      toast.error(`Couldn't change the weekly digest: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  let note: ReactNode = null;
  if (!user) note = <><Link to="/settings?section=profile" className="underline">Sign in</Link> to get it: it goes to your account's email.</>;
  else if (failed) note = "Couldn't load this setting. Check your connection and reload.";
  else if (status && !status.available && !status.enabled) note = "Email isn't available on this server right now.";
  else if (status?.bounced) note = "Your last digest bounced, so we turned it off. Turn it back on to try again.";
  else if (status?.enabled) note = follows
    ? <>On. It goes to <span className="font-medium text-foreground">{status.email}</span> once a week.</>
    : <>On, but you don't follow any teams yet, so there's nothing to send. Pick <Link to="/my-team" className="underline">your team</Link> or track teams from their pages.</>;

  return (
    <Group title="Email" description="Opt-in. Besides this, Control Scout only ever emails you sign-in codes.">
      <Row label="Weekly digest" htmlFor="digest-weekly" description={<>{DIGEST_DESCRIPTION}{note && <span className="mt-1 block">{note}</span>}</>}>
        <Switch id="digest-weekly" checked={!!status?.enabled} disabled={!user || !status || busy || (!status.available && !status.enabled)} onCheckedChange={change} />
      </Row>
    </Group>
  );
}
