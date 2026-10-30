// The owner console's Email digest card (Rankings & content): who gets it, when the next send is (owner only:
// members are never told a time), what the last send did, and two test sends to the owner's own account: a digest
// now (built and logged like a scheduled one) and the welcome email (server/digest/ownerRoutes.ts, docs/digest.md).
import { useState } from "react";
import { Mail, Send, Sparkles } from "lucide-react";
import { Section } from "../page";
import { Async } from "../states";
import { Badge } from "../ui/basic";
import { Button } from "../ui/button";
import { toast } from "../ui/sonner";
import { apiFetch, ApiError, prime, useApi } from "../../lib/api";
import type { OwnerDigest, OwnerDigestSendResult } from "../../shared/digest";

const PATH = "/api/owner/digest";

const STATUS_WORDS: Record<string, string> = {
  sent: "sent", failed: "failed", sending: "in flight", bounced: "bounced",
  "skipped-empty": "nothing to report", "skipped-toggle-off": "switched off", "skipped-bounce": "bounced before",
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function DigestPanel() {
  const state = useApi<OwnerDigest>(PATH);
  const [busy, setBusy] = useState<null | "digest" | "welcome">(null);
  const [result, setResult] = useState<OwnerDigestSendResult | null>(null);

  const send = async (kind: "digest" | "welcome") => {
    setBusy(kind);
    setResult(null);
    try {
      const r = await apiFetch<{ result: OwnerDigestSendResult; digest: OwnerDigest }>(`${PATH}/send`, { method: "POST", json: { kind, confirm: true } });
      prime(PATH, r.digest);
      setResult(r.result);
      if (r.result.outcome === "sent") toast.success(r.result.message); else toast(r.result.message);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(null); }
  };

  return (
    <Section title="Email digest" description="The opt-in email a few times a week. Test sends go only to your own account, built exactly like a real one.">
      <Async state={state}>
        {(d) => {
          const blocked = !d.emailReady ? "Email isn't set up on this server (RESEND_API_KEY)."
            : !d.mine.enabled ? "Turn on the email digest for your account in Settings › Notifications first: test sends go to you, with your unsubscribe link."
            : null;
          return (
            <div className="rounded-xl border border-border bg-card">
              <dl className="grid gap-4 p-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Subscribers</dt>
                  <dd className="mt-0.5 font-display text-2xl font-semibold tabular-nums text-foreground">{d.subscribers}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Next scheduled send</dt>
                  <dd className="mt-0.5 text-sm font-medium text-foreground">{when(d.nextSend)}</dd>
                  <dd className="text-xs text-muted-foreground">Your time. Members are never told a time.</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Your account</dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm text-foreground">
                    <Badge variant={d.mine.enabled ? "success" : "secondary"}>{d.mine.enabled ? "On" : "Off"}</Badge>
                    following {d.mine.followed} {d.mine.followed === 1 ? "team" : "teams"}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                {d.lastSend
                  ? <>Last send <span className="font-mono text-foreground">{d.lastSend.key}</span>: {Object.entries(d.lastSend.counts).map(([k, n]) => `${n} ${STATUS_WORDS[k] ?? k}`).join(", ")}</>
                  : "No digest has gone out yet."}
              </div>
              <div className="flex flex-col gap-2.5 border-t border-border p-4 sm:flex-row sm:items-center">
                <Button disabled={!!blocked || !!busy} onClick={() => send("digest")}><Send /> {busy === "digest" ? "Sending…" : "Send me a digest now"}</Button>
                <Button variant="outline" disabled={!!blocked || !!busy} onClick={() => send("welcome")}><Sparkles /> {busy === "welcome" ? "Sending…" : "Send me the welcome email"}</Button>
              </div>
              {!d.available && d.emailReady && (
                <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">Scheduled sends are paused (the Email digest switch under Features). Test sends still work.</p>
              )}
              {(blocked || result) && (
                <p role="status" className="flex items-start gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />{blocked ?? result!.message}
                </p>
              )}
            </div>
          );
        }}
      </Async>
    </Section>
  );
}
