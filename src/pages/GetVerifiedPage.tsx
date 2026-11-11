// /get-verified: the application to become a verified contributor (docs/contributors.md). The questions in order,
// the five agreements each ticked by hand, and "Will show as: Video by <name>" before sending. While it waits:
// Review Pending, with a way to withdraw and nothing to edit. Signed out: sign in first. No username yet: set one up
// first (the credit needs the actual name). Rejected: the owner's reason when they gave one, and when to re-apply.
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Clock, LogIn } from "lucide-react";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { applyForVerification, useMyContributorStatus, withdrawApplication } from "../lib/contributors";
import { useAccountSetup } from "../components/AccountSetup";
import { useOpenSignIn } from "../components/layout/AccountMenu";
import { PageHeader } from "../components/page";
import { LoadingBlock } from "../components/states";
import { Button } from "../components/ui/button";
import { FieldError, Input, Textarea } from "../components/ui/basic";
import { toast } from "../components/ui/sonner";
import {
  AGREEMENTS, APPLICANT_ROLES, APPLICANT_ROLE_LABEL, NOT_APPROVED_TEXT, PENDING_TEXT, RECORDED_CHOICES, RECORDED_LABEL, TEXT_MAX, WHY_MIN,
  type ApplicationField, type ApplicationInput, type MyContributorStatus,
} from "../shared/contributors";
import { creditLine } from "../shared/username";
import { cn } from "../components/cn";

const BLANK: ApplicationInput = { teamNumber: null, teamName: "", role: "", roleOther: "", events: "", channelUrl: "", sampleUrl: "", recorded: "", why: "", extra: "", agreements: {} };

export default function GetVerifiedPage() {
  useTitle("Get Verified");
  const { user } = usePersonal();
  const openSignIn = useOpenSignIn();
  const { ensure } = useAccountSetup();
  const me = useMyContributorStatus();
  const header = <PageHeader title="Get Verified" description="Verified contributors add match videos everyone can watch, credited with their actual name." />;
  if (!user) {
    return (
      <div>{header}
        <Box data-get-verified="signed-out">
          <p className="text-sm">Sign in to apply. Your application, and later your videos, are tied to your account.</p>
          <Button className="mt-3" onClick={openSignIn}><LogIn /> Sign in</Button>
        </Box>
      </div>
    );
  }
  if (me.data === undefined) return <div>{header}<LoadingBlock rows={6} /></div>;
  const s = me.data;
  if (!s.ready) {
    return (
      <div>{header}
        <Box data-get-verified="setup">
          <p className="text-sm">Applying needs a username and your actual name: the name is what your videos will show.</p>
          <Button className="mt-3" onClick={async () => { if (await ensure()) void me.reload(); }}>Add a username</Button>
        </Box>
      </div>
    );
  }
  if (s.status === "verified") {
    return <div>{header}<Box data-get-verified="verified"><p className="flex items-center gap-2 text-sm font-medium"><BadgeCheck className="size-5 text-accent-text" aria-hidden />You're verified. Add videos from any played match's page.</p></Box></div>;
  }
  if (s.status === "pending") return <div>{header}<Pending s={s} onChange={() => void me.reload()} /></div>;
  if (s.status === "rejected" && s.rejected?.reapplyAfter && Date.parse(s.rejected.reapplyAfter) > Date.now()) {
    return (
      <div>{header}
        <Box data-get-verified="rejected">
          <p className="text-sm font-medium">{s.rejected.reason ? `Not approved this time: ${s.rejected.reason}` : NOT_APPROVED_TEXT}</p>
          <p className="mt-1 text-sm text-text-muted">You can re-apply after {new Date(s.rejected.reapplyAfter).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.</p>
        </Box>
      </div>
    );
  }
  return (
    <div>{header}
      {s.status === "revoked" && <p className="mb-4 max-w-2xl text-sm text-text-muted">Your public publishing was revoked. You can apply again; the site owner will see your earlier record.</p>}
      {s.status === "rejected" && s.rejected?.reason && <p className="mb-4 max-w-2xl text-sm text-text-muted">Last time: {s.rejected.reason}</p>}
      <ApplicationForm s={s} onSent={() => void me.reload()} />
    </div>
  );
}

function Box({ children, className, ...rest }: { children: ReactNode; className?: string; [k: `data-${string}`]: string }) {
  return <div className={cn("max-w-2xl rounded-xl border border-line bg-card p-4", className)} {...rest}>{children}</div>;
}

function Pending({ s, onChange }: { s: MyContributorStatus; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const since = s.pending?.since ? new Date(s.pending.since).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null;
  return (
    <Box data-get-verified="pending">
      <p className="flex items-center gap-2 font-medium" data-review-pending><Clock className="size-4 text-accent-text" aria-hidden />{PENDING_TEXT}</p>
      <p className="mt-1 text-sm text-text-muted">
        {s.pending?.source === "invite" ? "Sent from your invite link" : "Application sent"}{since ? ` on ${since}` : ""}. You can't edit this while it's being reviewed.
      </p>
      <p className="mt-1 text-sm text-text-muted">Will show as: <span className="font-medium text-text-base">{s.credit}</span></p>
      {s.pending?.source !== "invite" && (
        confirm ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm">Withdraw your application?</span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await withdrawApplication(); toast.success("Application withdrawn"); onChange(); }
              catch (e: any) { toast.error(e?.message ?? "Not withdrawn"); setBusy(false); }
            }}>Withdraw</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
          </div>
        ) : <Button className="mt-3" size="sm" variant="secondary" onClick={() => setConfirm(true)} data-withdraw>Withdraw application</Button>
      )}
    </Box>
  );
}

function ApplicationForm({ s, onSent }: { s: MyContributorStatus; onSent: () => void }) {
  const [v, setV] = useState<ApplicationInput>(() => ({ ...BLANK, teamNumber: s.teams[0]?.number ?? null, teamName: s.teams[0]?.name ?? "" }));
  const [errors, setErrors] = useState<Partial<Record<ApplicationField, string>>>({});
  const [top, setTop] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const set = <K extends keyof ApplicationInput>(k: K, x: ApplicationInput[K]) => { setV((o) => ({ ...o, [k]: x })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const fid = (k: string) => `${id}-${k}`;
  const err = (k: ApplicationField) => errors[k] ? { "aria-invalid": true as const, "aria-describedby": fid(`${k}-err`) } : {};
  const send = async () => {
    setBusy(true); setTop(null);
    try {
      await applyForVerification(v);
      toast.success("Application sent");
      window.scrollTo({ top: 0 });
      onSent();
    } catch (e: any) {
      const b = e?.body as { error?: string; errors?: Partial<Record<ApplicationField, string>> } | undefined;
      if (b?.errors) {
        setErrors(b.errors);
        const first = Object.keys(b.errors)[0];
        if (first) document.getElementById(fid(first))?.focus();
      }
      setTop(b?.error ?? e?.message ?? "Not sent.");
    } finally { setBusy(false); }
  };
  const allTicked = AGREEMENTS.every(([k]) => v.agreements[k]);
  return (
    <form className="max-w-2xl space-y-6" noValidate onSubmit={(e) => { e.preventDefault(); void send(); }} data-application-form>
      <Q n={1} label="Your FTC team number" htmlFor={fid("teamNumber")} error={errors.teamNumber} errId={fid("teamNumber-err")}>
        <Input id={fid("teamNumber")} inputMode="numeric" value={v.teamNumber ?? ""} onChange={(e) => set("teamNumber", e.target.value.replace(/\D/g, "") ? Number(e.target.value.replace(/\D/g, "")) : null)} className="h-11 w-40 text-base sm:h-10 sm:text-sm" {...err("teamNumber")} />
      </Q>
      <Q n={2} label="Your team's name" htmlFor={fid("teamName")} error={errors.teamName} errId={fid("teamName-err")}>
        <Input id={fid("teamName")} value={v.teamName} maxLength={120} onChange={(e) => set("teamName", e.target.value)} className="h-11 text-base sm:h-10 sm:text-sm" {...err("teamName")} />
      </Q>
      <Q n={3} label="Your role on the team" error={errors.role ?? errors.roleOther} errId={fid("role-err")} group>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Your role on the team" id={fid("role")} tabIndex={-1}>
          {APPLICANT_ROLES.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/[0.08]">
              <input type="radio" name="role" checked={v.role === r} onChange={() => set("role", r)} className="accent-[var(--color-accent)]" />{APPLICANT_ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        {v.role === "other" && <Input id={fid("roleOther")} aria-label="Your role" value={v.roleOther} maxLength={80} onChange={(e) => set("roleOther", e.target.value)} placeholder="Your role" className="mt-2 h-11 text-base sm:h-10 sm:text-sm" {...err("roleOther")} />}
      </Q>
      <Q n={4} label="Events you've recorded or plan to record" htmlFor={fid("events")} error={errors.events} errId={fid("events-err")}>
        <Textarea id={fid("events")} value={v.events} maxLength={TEXT_MAX} rows={2} onChange={(e) => set("events", e.target.value)} placeholder="e.g. NJ Bergen qualifier, Jan 18" {...err("events")} />
      </Q>
      <Q n={5} label="Your YouTube channel" htmlFor={fid("channelUrl")} error={errors.channelUrl} errId={fid("channelUrl-err")}>
        <Input id={fid("channelUrl")} value={v.channelUrl} inputMode="url" autoCapitalize="none" spellCheck={false} onChange={(e) => set("channelUrl", e.target.value)} placeholder="https://www.youtube.com/@yourchannel" className="h-11 text-base sm:h-10 sm:text-sm" {...err("channelUrl")} />
      </Q>
      <Q n={6} label="One match video you recorded" htmlFor={fid("sampleUrl")} error={errors.sampleUrl} errId={fid("sampleUrl-err")}>
        <Input id={fid("sampleUrl")} value={v.sampleUrl} inputMode="url" autoCapitalize="none" spellCheck={false} onChange={(e) => set("sampleUrl", e.target.value)} placeholder="https://youtu.be/…" className="h-11 text-base sm:h-10 sm:text-sm" {...err("sampleUrl")} />
      </Q>
      <Q n={7} label="Who recorded the videos you'll add?" error={errors.recorded} errId={fid("recorded-err")} group>
        <div className="space-y-1.5" role="radiogroup" aria-label="Who recorded the videos you'll add?" id={fid("recorded")} tabIndex={-1}>
          {RECORDED_CHOICES.map((r) => (
            <label key={r} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-line px-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/[0.08]">
              <input type="radio" name="recorded" checked={v.recorded === r} onChange={() => set("recorded", r)} className="accent-[var(--color-accent)]" />{RECORDED_LABEL[r]}
            </label>
          ))}
        </div>
      </Q>
      <Q n={8} label="Why do you want to add match videos?" htmlFor={fid("why")} error={errors.why} errId={fid("why-err")} hint={`At least a sentence (${WHY_MIN}+ characters).`}>
        <Textarea id={fid("why")} value={v.why} maxLength={TEXT_MAX} rows={3} onChange={(e) => set("why", e.target.value)} {...err("why")} />
        <p className="mt-1 text-right text-[11px] tabular-nums text-text-muted">{v.why.trim().length}/{TEXT_MAX}</p>
      </Q>
      <Q label="Anything else the site owner should know? (optional)" htmlFor={fid("extra")} error={errors.extra} errId={fid("extra-err")}>
        <Textarea id={fid("extra")} value={v.extra} maxLength={TEXT_MAX} rows={2} onChange={(e) => set("extra", e.target.value)} {...err("extra")} />
      </Q>
      <fieldset className="space-y-2" id={fid("agreements")} tabIndex={-1} aria-describedby={errors.agreements ? fid("agreements-err") : undefined}>
        <legend className="mb-1 text-sm font-semibold">Before you apply</legend>
        {AGREEMENTS.map(([k, text]) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent/60">
            <input type="checkbox" checked={!!v.agreements[k]} onChange={(e) => { setV((o) => ({ ...o, agreements: { ...o.agreements, [k]: e.target.checked } })); setErrors((x) => ({ ...x, agreements: undefined })); }} className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]" data-agreement={k} />
            {text}
          </label>
        ))}
        <FieldError id={fid("agreements-err")}>{errors.agreements}</FieldError>
      </fieldset>
      <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
        <p className="text-sm" data-credit-preview>Will show as: <span className="font-semibold">{s.credit ?? creditLine("you")}</span></p>
        <p className="mt-1 text-xs text-text-muted">Your actual name shows on every video you add. Change it in <Link to="/settings" className="underline">Settings</Link>.</p>
      </div>
      {top && <p role="alert" className="text-sm font-medium text-destructive" data-form-error>{top}</p>}
      <Button type="submit" disabled={busy || !allTicked} className="min-h-11 w-full sm:w-auto" data-apply-submit>{busy ? "Checking…" : "Send application"}</Button>
      {!allTicked && <p className="text-xs text-text-muted">Tick all five to apply.</p>}
    </form>
  );
}

function Q({ n, label, htmlFor, error, errId, hint, group, children }: { n?: number; label: string; htmlFor?: string; error?: string; errId: string; hint?: string; group?: boolean; children: ReactNode }) {
  const text = <>{n != null && <span className="mr-1.5 text-text-muted">{n}.</span>}{label}</>;
  return (
    <div>
      {group ? <p className="mb-1.5 text-sm font-semibold">{text}</p> : <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold">{text}</label>}
      {hint && <p className="-mt-1 mb-1.5 text-xs text-text-muted">{hint}</p>}
      {children}
      <FieldError id={errId}>{error}</FieldError>
    </div>
  );
}
