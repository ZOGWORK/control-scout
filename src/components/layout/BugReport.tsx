// The top bar's "Report a bug" button (far right, next to the clock and the bell) and its dialog (a bottom sheet on
// phones). No account needed. The person picks what kind of problem, describes it, and can attach screenshots
// (pasted with Ctrl+V / ⌘V anywhere in the dialog, picked from disk, or dropped on it) and one short video under 5 MB.
// The page, version, screen, device and theme go with it and are listed in the dialog, so nothing is hidden.
// Sending: POST /api/bug-reports, one PUT per attachment, then POST …/done (server/bugReports.ts), which emails it.
import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { AlertCircle, Bug, CheckCircle2, Clapperboard, Gauge, ImagePlus, LayoutTemplate, Loader2, MessageCircle, Send, DatabaseZap, Wrench, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/overlay";
import { Button } from "../ui/button";
import { Input, Label, RequiredMark, Textarea } from "../ui/basic";
import { cn } from "../cn";
import { apiFetch, ApiError } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { useTheme } from "../../hooks/useTheme";
import { APP_VERSION } from "../../lib/errorReporting";
import {
  attachmentProblem, attachmentsProblem, BUG_CATEGORIES, BUG_LIMITS, formatBytes, IMAGE_TYPES, isImageType, isVideoType, VIDEO_TYPES,
  type BugCategory, type BugContext, type BugReportCreated,
} from "../../shared/bugReport";

const ICONS: Record<BugCategory, typeof Bug> = { data: DatabaseZap, broken: Wrench, layout: LayoutTemplate, slow: Gauge, other: MessageCircle };
const HINTS: Record<BugCategory, string> = {
  data: "Which team, event or match, and what's wrong. Results come from FIRST, so we'll check there too.",
  broken: "What you did, what you expected, and what happened instead.",
  layout: "What looks off. A screenshot helps most here.",
  slow: "Which page, and roughly how long it took.",
  other: "Anything else that isn't working the way it should.",
};
const PALETTE_NAME = { light: "Light", dim: "Dim", dark: "Dark", midnight: "Midnight" } as const;
const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(",");
/** ⌘V on Apple keyboards, Ctrl+V elsewhere. */
const pasteKeys = () => (/Mac|iPhone|iPad/.test(typeof navigator !== "undefined" ? navigator.platform || navigator.userAgent : "") ? "⌘V" : "Ctrl+V");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface Attachment { id: number; file: File; url: string }

let nextId = 1;

/** Image files on a paste or drop: files first, then file items (some browsers fill only one of the two). */
export function filesFrom(data: Pick<DataTransfer, "files" | "items"> | null): File[] {
  if (!data) return [];
  const files = Array.from(data.files ?? []);
  if (files.length) return files;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/** A clipboard image arrives as "image.png" every time: give it a name that says what it is. */
function named(f: File, i: number): File {
  if (f.name && f.name !== "image.png") return f;
  const ext = f.type.split("/")[1] ?? "png";
  return new File([f], `pasted-screenshot-${i}.${ext}`, { type: f.type, lastModified: f.lastModified });
}

/**
 * Adds `incoming` to what's attached: each file that fits is kept, the first one refused says why. Never more than
 * the limits allow (screenshots, one video), and each file checked for type and size.
 */
export function addFiles(current: File[], incoming: File[]): { add: File[]; problem: string | null } {
  const add: File[] = [];
  let problem: string | null = null;
  for (const f of incoming) {
    const p = attachmentProblem(f.type, f.size) ?? attachmentsProblem([...current, ...add, f].map((x) => ({ type: x.type, bytes: x.size })));
    if (p) { problem ??= p; continue; }
    add.push(f);
  }
  return { add, problem };
}

/** "Chrome on Windows": enough to know where it happened, without the whole user-agent string. */
export function deviceOf(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "unknown system";
  return `${browser} on ${os}`;
}

function useContextDetails(): BugContext {
  const loc = useLocation();
  const { palette } = useTheme();
  const w = typeof window !== "undefined" ? window : null;
  return {
    page: `${loc.pathname}${loc.search}`,
    release: APP_VERSION,
    viewport: w ? `${w.innerWidth}×${w.innerHeight}${w.devicePixelRatio && w.devicePixelRatio !== 1 ? ` @${Math.round(w.devicePixelRatio * 100) / 100}x` : ""}` : "",
    device: typeof navigator !== "undefined" ? deviceOf(navigator.userAgent) : "",
    theme: PALETTE_NAME[palette],
  };
}

const PHONE = "(max-width: 767px)";
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq) return;
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
}

/** The button for the top bar: a small icon-and-label on wide screens, a 44px icon on phones. */
export function BugReportButton() {
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const button = (
    <button type="button" onClick={() => setOpen(true)} aria-label="Report a bug" aria-haspopup="dialog" title="Report a bug"
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 text-xs font-medium text-text-muted outline-none transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/60 max-md:w-8 max-md:justify-center max-md:border-transparent max-md:px-0 pointer-coarse:max-md:size-[44px]"
      data-testid="bug-report-button">
      <Bug className="size-4 max-md:size-5" aria-hidden />
      <span className="hidden md:inline">Report a bug</span>
    </button>
  );
  return (
    <>
      {button}
      {open && (phone
        ? <Sheet open onOpenChange={setOpen}><SheetContent side="bottom" className="gap-3 px-4 pt-5"><BugReportForm phone onDone={() => setOpen(false)} /></SheetContent></Sheet>
        : <Dialog open onOpenChange={setOpen}><DialogContent className="max-w-xl"><BugReportForm onDone={() => setOpen(false)} /></DialogContent></Dialog>)}
    </>
  );
}

type Status = "idle" | "sending" | "sent";

function BugReportForm({ phone = false, onDone }: { phone?: boolean; onDone: () => void }) {
  const { user } = usePersonal();
  const context = useContextDetails();
  const [category, setCategory] = useState<BugCategory | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [website, setWebsite] = useState(""); // honeypot: hidden from people
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const ids = { cat: useId(), msg: useId(), email: useId(), files: useId() };
  const pasted = useRef(0);
  useEffect(() => { if (user?.email) setEmail((e) => e || user.email!); }, [user?.email]);
  // Thumbnails are object URLs: let them go when the dialog closes.
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => { for (const a of filesRef.current) URL.revokeObjectURL(a.url); }, []);

  // Worked out from the current list, outside any state updater (an updater may run twice: no URL or id made twice).
  const attach = useCallback((incoming: File[], fromPaste = false) => {
    if (!incoming.length) return;
    const cur = filesRef.current;
    const { add, problem } = addFiles(cur.map((a) => a.file), fromPaste ? incoming.map((f) => named(f, ++pasted.current)) : incoming);
    setFileProblem(problem);
    if (!add.length) return;
    const next = [...cur, ...add.map((file) => ({ id: nextId++, file, url: URL.createObjectURL(file) }))];
    filesRef.current = next;
    setFiles(next);
  }, []);
  const remove = (id: number) => {
    const cur = filesRef.current;
    const gone = cur.find((a) => a.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    const next = cur.filter((a) => a.id !== id);
    filesRef.current = next;
    setFileProblem(null);
    setFiles(next);
  };

  // Ctrl+V / ⌘V anywhere in the dialog: images on the clipboard become attachments; text pastes as usual.
  const onPaste = (e: ClipboardEvent) => {
    const got = filesFrom(e.clipboardData).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!got.length) return;
    e.preventDefault();
    attach(got, true);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); attach(filesFrom(e.dataTransfer)); };

  const msgLen = message.trim().length;
  const errors = {
    category: category ? null : "Choose what kind of problem it is.",
    message: msgLen < BUG_LIMITS.messageMin ? `Tell us a little more (at least ${BUG_LIMITS.messageMin} characters).` : msgLen > BUG_LIMITS.messageMax ? `Keep it under ${BUG_LIMITS.messageMax.toLocaleString("en-US")} characters.` : null,
    email: email.trim() && !EMAIL.test(email.trim()) ? "That doesn't look like an email address." : null,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setFailure(null);
    const first = (["category", "message", "email"] as const).find((k) => errors[k]);
    if (first) {
      if (first === "category") document.querySelector<HTMLInputElement>(`input[name="${ids.cat}"]`)?.focus();
      else document.getElementById(first === "message" ? ids.msg : ids.email)?.focus();
      return;
    }
    setStatus("sending");
    try {
      setProgress("Sending your report…");
      const created = await apiFetch<BugReportCreated>("/api/bug-reports", {
        method: "POST", _online: true,
        json: { category, message: message.trim(), email: email.trim() || undefined, context, website, files: files.map((a) => ({ type: a.file.type, bytes: a.file.size })) },
      });
      const headers = { "X-Bug-Token": created.token };
      const skipped: string[] = [];
      for (const [n, a] of files.entries()) {
        setProgress(`Uploading ${files.length === 1 ? "the attachment" : `attachment ${n + 1} of ${files.length}`}…`);
        try {
          await apiFetch(`/api/bug-reports/${created.id}/files/${n}`, { method: "PUT", body: a.file, headers: { ...headers, "Content-Type": a.file.type }, _online: true });
        } catch (err) { skipped.push(`${a.file.name}: ${(err as ApiError).message}`); }
      }
      await apiFetch(`/api/bug-reports/${created.id}/done`, { method: "POST", json: {}, headers, _online: true });
      setStatus("sent");
      if (skipped.length) setFailure(`Your report was sent, but ${skipped.length === 1 ? "one attachment" : `${skipped.length} attachments`} didn't upload. ${skipped.join(" ")}`);
    } catch (err) {
      setStatus("idle");
      setFailure((err as ApiError)?.offline ? "You're offline. Your report is still here: send it again once you're back online." : (err as ApiError)?.message || "Couldn't send your report. Try again in a moment.");
    } finally { setProgress(""); }
  };

  const Title = phone ? SheetTitle : DialogTitle;
  const Desc = phone ? SheetDescription : DialogDescription;
  const Header = phone ? SheetHeader : DialogHeader;

  if (status === "sent") {
    return (
      <div role="status" className="flex flex-col items-center py-6 text-center">
        <Header className="sr-only"><Title>Bug report sent</Title><Desc>Thanks for the report.</Desc></Header>
        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-success/12 text-success"><CheckCircle2 className="size-6" aria-hidden /></span>
        <p className="font-display text-lg font-semibold text-foreground">Thanks! We've got your report.</p>
        <p className="mt-1 max-w-sm text-sm text-text-muted">{email.trim() ? <>If we need more, we'll write to <strong className="text-foreground">{email.trim()}</strong>.</> : "We'll look into it."}</p>
        {failure && <p className="mt-3 max-w-sm text-xs text-warning">{failure}</p>}
        <Button className="mt-5" onClick={onDone}>Done</Button>
      </div>
    );
  }

  const shots = files.filter((a) => isImageType(a.file.type)).length;
  const videos = files.filter((a) => isVideoType(a.file.type)).length;
  return (
    <form noValidate onSubmit={submit} onPaste={onPaste} className="space-y-4" data-testid="bug-report-form"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={onDrop}>
      <Header>
        <Title className="flex items-center gap-2"><span className="flex size-7 items-center justify-center rounded-lg bg-danger/15 text-danger"><Bug className="size-4" aria-hidden /></span>Report a bug</Title>
        <Desc>{phone ? "Tell us what went wrong. A screenshot or a short screen recording helps." : <>Tell us what went wrong. Paste a screenshot with {pasteKeys()} to show us.</>}</Desc>
      </Header>

      <fieldset>
        <legend className="mb-2 flex items-center gap-1 text-sm font-medium text-foreground">What kind of problem? <RequiredMark /></legend>
        <div role="radiogroup" aria-invalid={tried && !!errors.category} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUG_CATEGORIES.map((c) => {
            const Icon = ICONS[c.id];
            const on = category === c.id;
            return (
              <label key={c.id} className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60",
                on ? "border-accent bg-accent-soft text-foreground" : "border-line text-text-muted hover:border-text-muted/40 hover:text-foreground",
              )}>
                <input type="radio" name={ids.cat} value={c.id} checked={on} onChange={() => setCategory(c.id)} className="sr-only" />
                <Icon className={cn("size-4 shrink-0", on ? "text-accent-text" : "")} aria-hidden />{c.label}
              </label>
            );
          })}
        </div>
        {category && <p className="mt-2 text-xs text-text-muted">{HINTS[category]}</p>}
        {tried && errors.category && <p className="mt-1.5 text-xs text-danger">{errors.category}</p>}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={ids.msg} className="flex items-center gap-1">What happened? <RequiredMark /></Label>
        <Textarea id={ids.msg} rows={phone ? 3 : 4} value={message} maxLength={BUG_LIMITS.messageMax + 100} onChange={(e) => setMessage(e.target.value)}
          placeholder="What you did, what you expected, what happened instead…" aria-invalid={tried && !!errors.message}
          aria-describedby={`${ids.msg}-hint`} className="resize-y" />
        <p id={`${ids.msg}-hint`} className={cn("text-xs", tried && errors.message ? "text-danger" : "text-text-muted")}>{tried && errors.message ? errors.message : `At least ${BUG_LIMITS.messageMin} characters.`}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground" id={ids.files}>Screenshots or a video <span className="font-normal text-text-muted">(optional)</span></span>
          <span className="text-xs tabular-nums text-text-muted">{shots}/{BUG_LIMITS.images} images · {videos}/{BUG_LIMITS.videos} video</span>
        </div>
        <button type="button" onClick={() => pick.current?.click()} aria-describedby={ids.files}
          className={cn("flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-3 py-4 text-center text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            dragging ? "border-accent bg-accent-soft text-foreground" : "border-line text-text-muted hover:border-text-muted/50 hover:text-foreground")}
          data-testid="bug-attach">
          <span className="flex items-center gap-2 font-medium"><ImagePlus className="size-4" aria-hidden /> {phone ? "Add screenshots or a video" : "Paste, drop or choose files"}</span>
          <span className="text-xs text-text-muted">Images up to {formatBytes(BUG_LIMITS.imageBytes)} each · one video under {formatBytes(BUG_LIMITS.videoBytes)}</span>
        </button>
        <input ref={pick} type="file" accept={ACCEPT} multiple className="hidden" tabIndex={-1} aria-hidden
          onChange={(e) => { attach(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {fileProblem && <p role="alert" className="flex items-start gap-1.5 text-xs text-danger"><AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />{fileProblem}</p>}
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Attachments">
            {files.map((a) => (
              <li key={a.id} className="group relative overflow-hidden rounded-lg border border-line bg-text-base/[0.04]" data-testid="bug-attachment">
                {isVideoType(a.file.type)
                  ? <div className="flex h-16 w-24 flex-col items-center justify-center gap-0.5 text-text-muted"><Clapperboard className="size-5" aria-hidden /><span className="text-[10px] tabular-nums">{formatBytes(a.file.size)}</span></div>
                  : <img src={a.url} alt={a.file.name} className="h-16 w-24 object-cover" />}
                <button type="button" onClick={() => remove(a.id)} aria-label={`Remove ${a.file.name}`}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/70 text-white outline-none hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:size-8">
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={ids.email}>Email <span className="font-normal text-text-muted">(optional, only to reply to you)</span></Label>
        <Input id={ids.email} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
          aria-invalid={tried && !!errors.email} />
        {tried && errors.email && <p className="text-xs text-danger">{errors.email}</p>}
      </div>

      <details className="rounded-xl border border-line px-3 py-2 text-xs text-text-muted" data-testid="bug-context">
        <summary className="cursor-pointer select-none font-medium text-foreground">Also sent: this page, version {context.release}, your screen and browser</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt>Page</dt><dd className="min-w-0 break-all font-mono">{context.page}</dd>
          <dt>Version</dt><dd>{context.release}</dd>
          <dt>Screen</dt><dd>{context.viewport}</dd>
          <dt>Browser</dt><dd>{context.device}</dd>
          <dt>Theme</dt><dd>{context.theme}</dd>
        </dl>
      </details>

      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      </div>

      {failure && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm text-foreground">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />{failure}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-muted" aria-live="polite">{progress || "No account needed."}</p>
        <Button type="submit" disabled={status === "sending"} className="w-full sm:w-auto">
          {status === "sending" ? <><Loader2 className="animate-spin" /> Sending…</> : <><Send /> Send report</>}
        </Button>
      </div>
    </form>
  );
}
