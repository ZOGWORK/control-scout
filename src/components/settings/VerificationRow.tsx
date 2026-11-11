// Settings › Account: where the account stands as a video contributor (docs/contributors.md), in the same words as
// /get-verified and the match page: Get Verified, Review Pending, verified (with their profile), not approved, revoked.
import { Link } from "react-router-dom";
import { BadgeCheck, Clock } from "lucide-react";
import { Row } from "./rows";
import { Button } from "../ui/button";
import { useMyContributorStatus } from "../../lib/contributors";
import { PENDING_TEXT, NOT_APPROVED_TEXT } from "../../shared/contributors";
import type { AccountUser } from "../../lib/personal";

export function VerificationRow({ user }: { user: AccountUser }) {
  const me = useMyContributorStatus();
  const s = me.data;
  const profile = user.username ? `/contributors/${user.username}` : null;
  let body: React.ReactNode = <span className="text-sm text-text-muted">…</span>;
  if (s) {
    if (s.status === "verified") body = <span className="inline-flex flex-wrap items-center gap-2 text-sm font-medium"><BadgeCheck className="size-4 text-accent-text" aria-hidden />Verified{profile && <Link to={profile} className="font-normal underline">Your profile</Link>}</span>;
    else if (s.status === "pending") body = <span className="inline-flex items-center gap-2 text-sm"><Clock className="size-4 text-accent-text" aria-hidden />{PENDING_TEXT}</span>;
    else if (s.status === "rejected" && s.rejected?.reapplyAfter && Date.parse(s.rejected.reapplyAfter) > Date.now()) body = <span className="text-sm text-text-muted">{s.rejected.reason ?? NOT_APPROVED_TEXT}</span>;
    else body = <Button size="sm" variant="secondary" asChild><Link to="/get-verified" data-get-verified><BadgeCheck /> {s.status === "revoked" ? "Apply again" : "Get Verified"}</Link></Button>;
  }
  return (
    <Row label="Match videos" description="Verified contributors add match videos everyone can watch. Others share with their team." stack={s?.status === "pending"}>
      <div data-settings-verification={s?.status}>{body}</div>
    </Row>
  );
}
