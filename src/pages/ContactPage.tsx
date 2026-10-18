// /contact: a form that reaches the team (POST /api/contact: stored, and
// emailed to the team's inbox), plus the other ways to get in touch. Checks
// each field as you leave it and again on send; the server's own checks and
// errors (limit reached, offline, down) show inline too.
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { AlertCircle, Bug, CheckCircle2, DatabaseZap, ExternalLink, Lightbulb, Loader2, MessageCircle, Send } from "lucide-react";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { PageHeader } from "../components/page";
import { Button } from "../components/ui/button";
import { Input, Label, RequiredMark, Textarea } from "../components/ui/basic";
import { cn } from "../components/cn";
import { CONTACT_LIMITS, CONTACT_TOPICS, type ContactTopic } from "../shared/contact";

type Field = "name" | "email" | "topic" | "message";
type Errors = Partial<Record<Field, string>>;

const TOPIC_ICONS: Record<ContactTopic, typeof Bug> = { bug: Bug, data: DatabaseZap, feature: Lightbulb, other: MessageCircle };
const TOPIC_HINTS: Record<ContactTopic, string> = {
  bug: "What you did, what happened, and the page's address.",
  data: "The team, event or match, and what's wrong. Results come from FIRST, so we'll check them there too.",
  feature: "What would help you or your team, and when you'd use it.",
  other: "Anything else: questions, privacy requests, feedback.",
};
const isTopic = (s: string | null): s is ContactTopic => CONTACT_TOPICS.some((t) => t.id === s);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The same rules as the server (server/contact.ts validateContact). */
function check(f: Record<Field, string>): Errors {
  const e: Errors = {};
  if (f.name.trim().length > CONTACT_LIMITS.name) e.name = `Keep your name under ${CONTACT_LIMITS.name} characters.`;
  const email = f.email.trim();
  if (!email) e.email = "Enter your email so we can reply.";
  else if (email.length > 254 || !EMAIL.test(email)) e.email = "That doesn't look like an email address.";
  if (!isTopic(f.topic)) e.topic = "Choose a topic.";
  const m = f.message.trim().length;
  if (m < CONTACT_LIMITS.messageMin) e.message = `Tell us a little more (at least ${CONTACT_LIMITS.messageMin} characters).`;
  else if (m > CONTACT_LIMITS.messageMax) e.message = `Keep it under ${CONTACT_LIMITS.messageMax.toLocaleString("en-US")} characters.`;
  return e;
}

export default function ContactPage() {
  useTitle("Contact");
  const [params] = useSearchParams();
  const { user } = usePersonal();
  const initialTopic = params.get("topic");
  const [form, setForm] = useState<Record<Field, string>>({ name: "", email: user?.email ?? "", topic: isTopic(initialTopic) ? initialTopic : "", message: "" });
  // A field shows its error once it has been left (or after a send attempt).
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [serverFields, setServerFields] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [website, setWebsite] = useState(""); // honeypot: hidden from people
  const ids = { name: useId(), email: useId(), topic: useId(), message: useId() };
  // Signed in: fill in the account's email once it's known (never over what was typed).
  useEffect(() => { if (user?.email) setForm((f) => (f.email ? f : { ...f, email: user.email! })); }, [user?.email]);

  // The server's reason wins for a field until that field is edited (edits clear it to undefined, which must not hide our own check).
  const checked = check(form);
  const errors: Errors = Object.fromEntries((["name", "email", "topic", "message"] as Field[]).map((f) => [f, serverFields[f] ?? checked[f]]));
  const shown = (f: Field) => (touched[f] || serverFields[f] ? errors[f] : undefined);
  const set = (f: Field, v: string) => { setForm((x) => ({ ...x, [f]: v })); setServerFields((x) => ({ ...x, [f]: undefined })); };
  const leave = (f: Field) => setTouched((t) => ({ ...t, [f]: true }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, email: true, topic: true, message: true });
    setFailure(null);
    const local = check(form);
    if (Object.keys(local).length) {
      const first = (["name", "email", "topic", "message"] as Field[]).find((f) => local[f])!;
      // The topic's legend can't take focus: go to its first choice instead.
      if (first === "topic") document.querySelector<HTMLInputElement>('input[name="topic"]')?.focus();
      else document.getElementById(ids[first])?.focus();
      return;
    }
    setStatus("sending");
    // The confirmation names the address actually sent, even if the field is edited while sending.
    const submitted = form;
    try {
      const res = await fetch("/api/contact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...submitted, website }),
      });
      const body = await res.json().catch(() => null) as { error?: string; fields?: Errors } | null;
      if (res.ok) { setSentTo(submitted.email.trim()); setStatus("sent"); return; }
      setStatus("idle");
      if (res.status === 400 && body?.fields) { setServerFields(body.fields); setFailure(body.error ?? "Check the highlighted fields."); return; }
      if (res.status === 429) { setFailure(body?.error ?? "Too many messages from here. Please try again later."); return; }
      setFailure("We couldn't send your message just now. Please try again in a minute.");
    } catch {
      setStatus("idle");
      setFailure(navigator.onLine === false ? "You're offline. Your message is still here, so send it once you're back online." : "We couldn't reach Control Scout. Please try again in a minute.");
    }
  };

  const reset = () => { setForm((f) => ({ name: f.name, email: f.email, topic: "", message: "" })); setTouched({}); setServerFields({}); setFailure(null); setStatus("idle"); };
  const topic = isTopic(form.topic) ? form.topic : null;

  return (
    <div>
      <PageHeader title="Contact us" description="Found a bug, spotted wrong data, or have an idea? Tell us here." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="self-start rounded-2xl border border-line bg-card/70 p-4 sm:p-6">
          {status === "sent" ? (
            <motion.div role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center py-8 text-center">
              <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-success/12 text-success"><CheckCircle2 className="size-7" aria-hidden /></span>
              <h2 className="font-display text-xl font-semibold text-foreground">Message sent. Thank you!</h2>
              <p className="mt-2 max-w-md text-sm text-text-muted">We've got it. If it needs an answer, we'll reply to <strong className="text-foreground">{sentTo}</strong>.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={reset}>Send another</Button>
                <Button variant="secondary" asChild><Link to="/">Back to home</Link></Button>
              </div>
            </motion.div>
          ) : (
            <form noValidate onSubmit={submit} className="space-y-5" aria-describedby={failure ? "contact-failure" : undefined}>
              <fieldset>
                <legend className="mb-2 flex items-center gap-1 text-sm font-medium text-foreground" id={ids.topic}>What's it about? <RequiredMark /></legend>
                <div role="radiogroup" aria-labelledby={ids.topic} aria-invalid={!!shown("topic")} aria-describedby={shown("topic") ? `${ids.topic}-err` : undefined} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CONTACT_TOPICS.map((t) => {
                    const Icon = TOPIC_ICONS[t.id];
                    const on = form.topic === t.id;
                    return (
                      <label key={t.id} className={cn(
                        "flex min-h-[64px] cursor-pointer flex-col items-start justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60",
                        on ? "border-accent bg-accent-soft text-foreground" : "border-line text-text-muted hover:border-text-muted/40 hover:text-foreground",
                      )}>
                        <input type="radio" name="topic" value={t.id} checked={on} onChange={() => { set("topic", t.id); leave("topic"); }} className="sr-only" />
                        <Icon className={cn("size-[18px]", on ? "text-accent-text" : "")} aria-hidden />{t.label}
                      </label>
                    );
                  })}
                </div>
                {topic && !shown("topic") && <p className="mt-2 text-xs text-text-muted">{TOPIC_HINTS[topic]}</p>}
                <FieldError id={`${ids.topic}-err`} msg={shown("topic")} />
              </fieldset>

              <div className="grid gap-5 sm:grid-cols-2">
                <FieldWrap label={<>Name <span className="font-normal text-text-muted">(optional)</span></>} htmlFor={ids.name} error={shown("name")}>
                  <Input id={ids.name} autoComplete="name" value={form.name} onChange={(e) => set("name", e.target.value)} onBlur={() => leave("name")}
                    aria-invalid={!!shown("name")} aria-describedby={shown("name") ? `${ids.name}-err` : undefined} />
                </FieldWrap>
                <FieldWrap label={<>Email <RequiredMark /></>} htmlFor={ids.email} error={shown("email")} hint="Only used to reply to you.">
                  <Input id={ids.email} type="email" inputMode="email" autoComplete="email" required value={form.email} onChange={(e) => set("email", e.target.value)} onBlur={() => leave("email")}
                    aria-invalid={!!shown("email")} aria-describedby={`${ids.email}-${shown("email") ? "err" : "hint"}`} />
                </FieldWrap>
              </div>

              <FieldWrap label={<>Message <RequiredMark /></>} htmlFor={ids.message} error={shown("message")}
                hint={`${form.message.trim().length.toLocaleString("en-US")} / ${CONTACT_LIMITS.messageMax.toLocaleString("en-US")}`}>
                <Textarea id={ids.message} required rows={7} maxLength={CONTACT_LIMITS.messageMax + 200} value={form.message} onChange={(e) => set("message", e.target.value)} onBlur={() => leave("message")}
                  aria-invalid={!!shown("message")} aria-describedby={`${ids.message}-${shown("message") ? "err" : "hint"}`} className="resize-y" />
              </FieldWrap>

              {/* Honeypot: off-screen and skipped by keyboard and screen readers; bots that fill it are ignored. */}
              <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
                <label>Website<input tabIndex={-1} autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
              </div>

              {failure && (
                <div id="contact-failure" role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-foreground">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />{failure}
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-text-muted">We keep messages so we can follow up. See the <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">privacy policy</Link>.</p>
                <Button type="submit" disabled={status === "sending"} className="w-full sm:w-auto">
                  {status === "sending" ? <><Loader2 className="animate-spin" /> Sending…</> : <><Send /> Send message</>}
                </Button>
              </div>
            </form>
          )}
        </div>

        <aside aria-label="Other ways to reach us" className="space-y-4">
          <OtherWay icon={DatabaseZap} tone="text-info bg-info/12" title="Wrong match data?">
            Scores and results come from <a className="underline underline-offset-2 hover:text-foreground" href="https://ftc-events.firstinspires.org" target="_blank" rel="noreferrer noopener">FIRST</a>. If a result is wrong there too, the event's scorekeeper or <i>FIRST</i> can fix it at the source, and Control Scout picks up the fix on its next sync.
          </OtherWay>
          <OtherWay icon={ExternalLink} tone="text-accent-text bg-accent-soft" title="Control Point">
            Accounts are shared with our sister app for FTC team workspaces. <a className="underline underline-offset-2 hover:text-foreground" href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener">tryctrlpoint.org</a>
          </OtherWay>
          <OtherWay icon={MessageCircle} tone="text-success bg-success/12" title="Before you write">
            The <Link className="underline underline-offset-2 hover:text-foreground" to="/faq">FAQ</Link> answers the common questions. <Link className="underline underline-offset-2 hover:text-foreground" to="/methodology">How it works</Link> explains every number and prediction. The <Link className="underline underline-offset-2 hover:text-foreground" to="/privacy">privacy policy</Link> and <Link className="underline underline-offset-2 hover:text-foreground" to="/terms">terms</Link> cover your data and the rules.
          </OtherWay>
        </aside>
      </div>
    </div>
  );
}

function FieldWrap({ label, htmlFor, error, hint, children }: { label: ReactNode; htmlFor: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="gap-1">{label}</Label>
      {children}
      {error ? <FieldError id={`${htmlFor}-err`} msg={error} /> : hint ? <p id={`${htmlFor}-hint`} className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <p id={id} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{msg}</p>;
}

function OtherWay({ icon: Icon, tone, title, children }: { icon: typeof Bug; tone: string; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-line p-4">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", tone)}><Icon className="size-[18px]" aria-hidden /></span>
      <div className="min-w-0 text-sm leading-relaxed text-text-muted">
        <p className="mb-0.5 font-semibold text-foreground">{title}</p>
        {children}
      </div>
    </div>
  );
}
