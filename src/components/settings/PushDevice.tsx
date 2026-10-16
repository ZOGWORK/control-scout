// Settings › Notifications › Push notifications: this device's web push (src/lib/push.ts, docs/push.md).
// Off until a tap on "Turn on notifications", the only place the browser's permission is asked. Wherever push
// can't work, one line says why. "Turn off" stays available whenever this browser holds a subscription, even
// with the server unreachable or push switched off.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/basic";
import { toast } from "../ui/sonner";
import { Group, Row } from "./rows";
import { PUSH_DAILY_LIMIT } from "../../shared/push";
import { disablePush, enablePush, hasLocalSubscription, readPushStatus, type PushStatus } from "../../lib/push";

/** One line per push state: why it's dormant, or what it does. */
const PUSH_HINT: Record<PushStatus, string> = {
  checking: "Checking this device…",
  unsupported: "This browser can't receive push notifications. Alerts still arrive while Control Scout is open in a tab.",
  "ios-install": "On iPhone and iPad, notifications need Control Scout on your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
  "no-worker": "This page hasn't started its background worker yet. Reload the page, then try again.",
  unavailable: "Notifications aren't available on this server right now. Alerts still arrive while Control Scout is open in a tab.",
  "signed-out": "Sign in to turn them on: they follow your team, tracked teams and tracked events from your account.",
  denied: "Blocked for this site. To allow them, open the site settings (the icon next to the address), set Notifications to Allow, then reload.",
  off: "Off on this device. Turning them on asks your browser for permission.",
  on: `On for this device: reminders 15 minutes before your teams' matches, upsets and event starts, even with Control Scout closed. At most ${PUSH_DAILY_LIMIT} a day.`,
};

/** Push for this device: off until a tap on "Turn on notifications" (the only place permission is asked). */
export function PushDevice({ signedIn, onPermission }: { signedIn: boolean; onPermission: (p: NotificationPermission) => void }) {
  const [status, setStatus] = useState<PushStatus>("checking");
  /** This browser holds a subscription: "Turn off" stays available even when the server can't be reached or push is off. */
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => Promise.all([
    readPushStatus(signedIn).catch((): PushStatus => "unavailable"),
    hasLocalSubscription().catch(() => false),
  ]);
  useEffect(() => {
    let live = true;
    refresh().then(([s, l]) => { if (live) { setStatus(s); setLocal(l); } });
    return () => { live = false; };
  }, [signedIn]);
  const run = async (fn: () => Promise<PushStatus>, target: PushStatus, done: string) => {
    setBusy(true);
    try {
      const s = await fn();
      // Turning off can happen while push is unavailable: show what's true now, not just "off".
      if (s === "off") { const [now, l] = await refresh(); setStatus(now); setLocal(l); } else { setStatus(s); setLocal(s === "on"); }
      if (typeof Notification !== "undefined") onPermission(Notification.permission);
      if (s === target) toast(done);
    } catch (e) {
      toast.error(`Couldn't change notifications: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };
  return (
    <Group title="Push notifications" description="Match reminders, upsets and event starts on this device, even when Control Scout is closed. Turn them on for each phone or computer separately.">
      <Row label="This device" description={<>{PUSH_HINT[status]}{status === "signed-out" && <> <Link to="/settings?section=profile" className="underline">Sign in</Link></>}</>}>
        <div className="flex items-center gap-2">
          <Badge variant={status === "on" ? "success" : status === "denied" ? "destructive" : "secondary"}>{status === "on" ? "On" : status === "denied" ? "Blocked" : status === "off" ? "Off" : status === "checking" ? "Checking" : "Unavailable"}</Badge>
          {status === "off" && <Button size="sm" disabled={busy} onClick={() => run(enablePush, "on", "Notifications on for this device")}><BellRing /> Turn on notifications</Button>}
          {(status === "on" || (local && status !== "off" && status !== "checking")) && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(disablePush, "off", "Notifications turned off")}>Turn off</Button>}
        </div>
      </Row>
    </Group>
  );
}

