// The top bar's "Report a bug" button (far right, next to the clock and the bell). Its dialog (a bottom sheet on
// phones: ./BugReportForm.tsx) loads when the button is first pressed, so the form's code isn't part of every page's
// start-up bundle (the search audit, S14).
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Bug, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/overlay";

/** Said plainly before and after sending: the repository is public, so the issue is too. */
export const PUBLIC_NOTE = "This files a public GitHub Issue on ZOGWORK/control-scout. Anyone can see it.";
/** Where a report goes that shouldn't be public. */
export const PRIVATE_EMAIL = "sushil.m@icloud.com";

const BugReportForm = lazy(() => import("./BugReportForm").then((m) => ({ default: m.BugReportForm })));

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

/** While the form's code arrives (once): a quiet spinner in the dialog's place, the dialog still named. */
const Loading = ({ sheet = false }: { sheet?: boolean }) => {
  const [Title, Description] = sheet ? [SheetTitle, SheetDescription] : [DialogTitle, DialogDescription];
  return (
    <div className="flex min-h-40 items-center justify-center text-text-muted" role="status">
      <Title className="sr-only">Report a bug</Title>
      <Description className="sr-only">Loading the form</Description>
      <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
    </div>
  );
};

/** The button for the top bar: a small icon-and-label on wide screens, a 44px icon on phones. `corner`: a quiet 44px
 *  circle in the bottom-right corner of its page instead (the v8 sample Home, which has no bar). Placed on the page,
 *  not fixed to the screen: a page that fits shows it in the screen's corner, and a long one (a phone) shows it at the
 *  very end, below everything, so it never sits over a row. */
export function BugReportButton({ corner = false }: { corner?: boolean } = {}) {
  // Sheet or dialog is picked when it opens and kept until it closes: turning a phone sideways mid-report would
  // otherwise swap the overlay and lose what was typed and attached.
  const [open, setOpen] = useState<null | "sheet" | "dialog">(null);
  const phone = usePhone();
  const ref = useRef<HTMLButtonElement>(null);
  const close = (o: boolean) => { if (!o) setOpen(null); };
  const back = () => ref.current;
  // Pointing at the button (or focusing it) starts loading the form, so it's usually there by the click.
  const warm = () => { void import("./BugReportForm"); };
  const button = corner ? (
    <button ref={ref} type="button" onClick={() => setOpen(phone ? "sheet" : "dialog")} onPointerEnter={warm} onFocus={warm} aria-label="Report a bug" aria-haspopup="dialog" title="Report a bug"
      className="absolute right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex size-11 items-center justify-center rounded-full border border-ink/10 bg-[#121214] v8light:bg-card [html.dim_&]:bg-card text-text-muted shadow-[0_4px_16px_rgb(0_0_0/0.35)] outline-none transition-colors hover:border-danger/40 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/60 sm:right-6 sm:bottom-6"
      data-testid="bug-report-button" data-corner>
      <Bug className="size-5" aria-hidden />
    </button>
  ) : (
    <button ref={ref} type="button" onClick={() => setOpen(phone ? "sheet" : "dialog")} onPointerEnter={warm} onFocus={warm} aria-label="Report a bug" aria-haspopup="dialog" title="Report a bug"
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 text-xs font-medium text-text-muted outline-none transition-colors hover:border-danger/40 hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring/60 max-md:w-8 max-md:justify-center max-md:border-transparent max-md:px-0 pointer-coarse:max-md:size-[44px]"
      data-testid="bug-report-button">
      <Bug className="size-4 max-md:size-5" aria-hidden />
      <span className="hidden md:inline">Report a bug</span>
    </button>
  );
  return (
    <>
      {button}
      {open === "sheet" && <Sheet open onOpenChange={close}><SheetContent side="bottom" className="gap-3 px-4 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" returnFocus={back}><Suspense fallback={<Loading sheet />}><BugReportForm phone onDone={() => close(false)} /></Suspense></SheetContent></Sheet>}
      {open === "dialog" && <Dialog open onOpenChange={close}><DialogContent className="max-w-xl" returnFocus={back}><Suspense fallback={<Loading />}><BugReportForm onDone={() => close(false)} /></Suspense></DialogContent></Dialog>}
    </>
  );
}
