// /verify-video?token=…: an invite to become a verified contributor (docs/contributors.md). The link is single use,
// good for 14 days, and only its hash is kept. Opening it says what it is; claiming binds it to the signed-in account
// (sign-in and username set-up first), and one tap sends the request to the owner's queue. A claimed, expired or
// removed link says so plainly; someone else's claimed link never says whose.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BadgeCheck, Clock, LogIn, MailCheck } from "lucide-react";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { claimInviteLink, readInviteLink, requestFromInviteLink, useMyContributorStatus } from "../lib/contributors";
import { useAccountSetup } from "../components/AccountSetup";
import { useOpenSignIn } from "../components/layout/AccountMenu";
import { PageHeader } from "../components/page";
import { LoadingBlock } from "../components/states";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/sonner";
import { PENDING_TEXT, type InviteRead } from "../shared/contributors";

export default function VerifyVideoPage() {
  useTitle("Video contributor invite");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user } = usePersonal();
  const openSignIn = useOpenSignIn();
  const { ensure } = useAccountSetup();
  const me = useMyContributorStatus();
  const [invite, setInvite] = useState<InviteRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!token) { setInvite({ state: "invalid" }); return; }
    readInviteLink(token).then((r) => { if (live) setInvite(r); }, () => { if (live) setInvite({ state: "invalid" }); });
    return () => { live = false; };
  }, [token, user?.id]);
  const header = <PageHeader title="Become a verified contributor" description="An invite from Control Scout's site owner to add match videos everyone can watch." />;
  const box = "max-w-2xl rounded-xl border border-line bg-card p-4";
  if (!invite) return <div>{header}<LoadingBlock rows={3} /></div>;

  // Already verified, or this request already sent: say so whatever the link's state.
  if (me.data?.status === "verified") {
    return <div>{header}<div className={box} data-invite="verified"><p className="flex items-center gap-2 text-sm font-medium"><BadgeCheck className="size-5 text-accent-text" aria-hidden />You're verified. Add videos from any played match's page.</p></div></div>;
  }
  if (me.data?.status === "pending" && (invite.mine || me.data.pending?.source === "invite")) {
    return <div>{header}<div className={box} data-invite="pending"><p className="flex items-center gap-2 font-medium" data-review-pending><Clock className="size-4 text-accent-text" aria-hidden />{PENDING_TEXT}</p></div></div>;
  }
  if (invite.state === "claimed" && !invite.mine) return <div>{header}<Gone text="This invite was already claimed." /></div>;
  if (invite.state === "expired" || invite.state === "revoked" || invite.state === "invalid") return <div>{header}<Gone text="This link is no longer valid." /></div>;

  if (!user) {
    return (
      <div>{header}
        <div className={box} data-invite="signed-out">
          <p className="text-sm">Sign in (or create an account) to accept this invite. It works once, for one account.</p>
          <Button className="mt-3" onClick={openSignIn}><LogIn /> Sign in</Button>
        </div>
      </div>
    );
  }
  const go = async () => {
    if (!(await ensure("Accepting the invite needs a username and your actual name."))) return;
    setBusy(true); setErr(null);
    try {
      if (!invite.mine) await claimInviteLink(token);
      const r = await requestFromInviteLink(token);
      toast.success(r.already ? "Your request is already waiting" : "Request sent");
      setInvite({ ...invite, state: "claimed", mine: true });
      void me.reload();
    } catch (e: any) {
      const b = e?.body as { error?: string; code?: string } | undefined;
      setErr(b?.error ?? e?.message ?? "Not sent.");
      if (b?.code === "claimed") setInvite({ state: "claimed", mine: false });
    } finally { setBusy(false); }
  };
  return (
    <div>{header}
      <div className={box} data-invite="valid">
        <p className="flex items-center gap-2 text-sm font-medium"><MailCheck className="size-4 text-accent-text" aria-hidden />You've been invited to add public match videos.</p>
        <p className="mt-1 text-sm text-text-muted">Verified videos show to everyone, credited "Video by" your actual name.{invite.expiresAt ? ` This link works until ${new Date(invite.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.` : ""}</p>
        {me.data?.status === "pending" && <p className="mt-2 text-sm">Accepting withdraws the application you sent: the invite request replaces it.</p>}
        {me.data?.credit && <p className="mt-2 text-sm">Will show as: <span className="font-semibold">{me.data.credit}</span></p>}
        {err && <p role="alert" className="mt-2 text-sm font-medium text-destructive">{err}</p>}
        <Button className="mt-3 min-h-11" disabled={busy} onClick={() => void go()} data-invite-accept><BadgeCheck /> {busy ? "Sending…" : "Accept and send request"}</Button>
      </div>
    </div>
  );
}

function Gone({ text }: { text: string }) {
  return (
    <div className="max-w-2xl rounded-xl border border-line bg-card p-4" data-invite="gone">
      <p className="text-sm font-medium">{text}</p>
      <p className="mt-1 text-sm text-text-muted">Ask the site owner for a new link, or <Link to="/get-verified" className="underline">apply to get verified</Link>.</p>
    </div>
  );
}
