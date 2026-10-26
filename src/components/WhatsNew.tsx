// Control Scout's "What's new" (its own changelog, not Control Point's): one dialog for the whole app,
// opened from the sidebar, the phone's More sheet, the account menu or Settings › About. A dot marks a
// release this device hasn't opened yet. The changelog itself loads with the dialog, never with the app.
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Megaphone } from "lucide-react";
import { currentRelease, hasUnseenRelease, markReleaseSeen } from "../lib/changelog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/overlay";
import { Badge } from "./ui/basic";
import { cn } from "./cn";

const Content = lazy(() => import("./WhatsNewContent"));

const OPEN = "cs-open-whats-new", SEEN = "cs-whats-new-seen-changed";
type ReturnTo = () => HTMLElement | null | undefined;
/** Open What's new from anywhere. `returnTo` is where focus goes when it closes if its opener has gone by then
 *  (the phone's More sheet closes as it opens, taking its row along: focus goes back to More). */
export const openWhatsNew = (returnTo?: ReturnTo) => window.dispatchEvent(new CustomEvent<ReturnTo | undefined>(OPEN, { detail: returnTo }));

const subscribe = (f: () => void) => { window.addEventListener(SEEN, f); window.addEventListener("storage", f); return () => { window.removeEventListener(SEEN, f); window.removeEventListener("storage", f); }; };
/** Whether this device has a release it hasn't opened What's new for. */
export const useUnseenRelease = () => useSyncExternalStore(subscribe, () => hasUnseenRelease(), () => false);

/** The dialog, mounted once (in the shell). */
export function WhatsNewHost() {
  const [open, setOpen] = useState(false);
  const returnTo = useRef<ReturnTo | undefined>(undefined);
  useEffect(() => {
    const on = (e: Event) => { returnTo.current = (e as CustomEvent<ReturnTo | undefined>).detail; setOpen(true); markReleaseSeen(); window.dispatchEvent(new Event(SEEN)); };
    window.addEventListener(OPEN, on);
    return () => window.removeEventListener(OPEN, on);
  }, []);
  const v = currentRelease();
  // Opened by an event, not a trigger: DialogContent hands focus back to whatever opened it, or to `returnTo` (ui/overlay).
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent returnFocus={() => returnTo.current?.()} className="max-h-[88dvh] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-6 max-sm:px-4 py-4">
          <DialogTitle className="flex items-center gap-2">What's new{v && <Badge variant="outline">v{v}</Badge>}</DialogTitle>
          <DialogDescription>Every release of Control Scout, newest first.</DialogDescription>
        </DialogHeader>
        {open && <Suspense fallback={<div className="h-64" aria-busy="true" />}><Content /></Suspense>}
      </DialogContent>
    </Dialog>
  );
}

/** The sidebar / More sheet row: "What's new", with a dot for an unseen release. `dense`: the sidebar's tighter row. */
export function WhatsNewRow({ collapsed, dense, onOpen, returnTo }: { collapsed?: boolean; dense?: boolean; onOpen?: () => void; returnTo?: ReturnTo }) {
  const unseen = useUnseenRelease();
  return (
    <button type="button" onClick={() => { onOpen?.(); openWhatsNew(returnTo); }} title={collapsed ? "What's new" : undefined}
      aria-label={unseen ? "What's new (new release)" : "What's new"}
      className={cn("group relative flex w-full items-center rounded-lg font-medium text-text-muted outline-none", dense ? "h-8 gap-2.5 px-2.5 text-sm" : "h-10 gap-3 px-3 text-[0.9375rem]", "hover:bg-text-base/[0.05] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60", collapsed && "justify-center px-0")}>
      <span className="relative">
        <Megaphone className="size-[18px] shrink-0" aria-hidden />
        {unseen && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-secondary" aria-hidden />}
      </span>
      {!collapsed && <span className="truncate">What's new</span>}
    </button>
  );
}
