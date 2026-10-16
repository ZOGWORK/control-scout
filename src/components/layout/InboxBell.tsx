// The notification inbox's bell, top right of the header (never in the sidebar; docs/inbox.md). Signed
// in only. The badge is the unread count (synced across devices); a click opens the list: a panel under
// the bell on wider screens, a bottom sheet on phones. Tapping an item marks it read and opens the place
// it's about: the entry, the workspace's activity, its template, or the owner portal's storage panel.
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ClipboardCheck, HardDrive, LayoutList, ListOrdered, Loader2, MessageSquare, PencilLine, Settings, Users } from "lucide-react";
import { usePersonal } from "../../lib/personal";
import { useInbox, type InboxState } from "../../lib/inbox";
import { agoShort } from "../../lib/format";
import type { InboxCategory, InboxItem } from "../../shared/inbox";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/overlay";
import { Button } from "../ui/button";
import { cn } from "../cn";

const PHONE = "(max-width: 767px)";
function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PHONE).matches);
  useEffect(() => {
    const m = window.matchMedia?.(PHONE);
    if (!m) return;
    const on = () => setPhone(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return phone;
}

const ICON: Record<InboxCategory, { icon: ComponentType<{ className?: string }>; tone: string }> = {
  assignments: { icon: ClipboardCheck, tone: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  edits: { icon: PencilLine, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  template: { icon: LayoutList, tone: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
  membership: { icon: Users, tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  picklist: { icon: ListOrdered, tone: "bg-orange-500/15 text-orange-700 dark:text-orange-400" },
  comments: { icon: MessageSquare, tone: "bg-pink-500/15 text-pink-700 dark:text-pink-400" },
  ownerAlerts: { icon: HardDrive, tone: "bg-red-500/15 text-red-700 dark:text-red-400" },
};

const badgeText = (n: number) => (n > 99 ? "99+" : String(n));

/** The bell (nothing at all when signed out). */
export function InboxBell() {
  const { user } = usePersonal();
  if (!user) return null;
  return <SignedInBell key={user.id} userId={user.id} />;
}

function SignedInBell({ userId }: { userId: number }) {
  const inbox = useInbox(userId);
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const loc = useLocation();
  const { load } = inbox;
  // Opening shows the latest; navigation, Esc and a click elsewhere close the panel.
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { setOpen(false); }, [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open || phone) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); box.current?.querySelector<HTMLButtonElement>("[data-inbox-toggle]")?.focus(); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open, phone]);
  const label = inbox.unread ? `Notifications, ${inbox.unread} unread` : "Notifications";
  return (
    <div ref={box} className="relative shrink-0" data-inbox-bell>
      <button
        type="button" data-inbox-toggle onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={phone ? undefined : panelId} aria-haspopup="dialog"
        aria-label={label} title="Notifications"
        className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Bell className="size-4" />
        <AnimatePresence>
          {inbox.unread > 0 && (
            <motion.span key="badge" data-inbox-badge aria-hidden
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.16 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-ink tabular-nums ring-2 ring-primary">
              {badgeText(inbox.unread)}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      {phone ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="gap-0 p-0" aria-describedby={undefined}>
            <InboxList inbox={inbox} onClose={() => setOpen(false)} titleAs="sheet" />
          </SheetContent>
        </Sheet>
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div id={panelId} role="dialog" aria-label="Notifications" key="panel"
              initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }} style={{ transformOrigin: "top right" }}
              className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[24rem] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
              <InboxList inbox={inbox} onClose={() => setOpen(false)} titleAs="panel" />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

function InboxList({ inbox, onClose, titleAs }: { inbox: InboxState; onClose: () => void; titleAs: "panel" | "sheet" }) {
  const nav = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const open = (i: InboxItem) => {
    inbox.markRead([i.id]);
    onClose();
    nav(i.link || "/");
  };
  const anyUnread = inbox.items.some((i) => !i.read) || inbox.unread > 0;
  return (
    <>
      <div className={cn("flex items-center gap-2 border-b border-border px-4 py-3", titleAs === "sheet" && "pr-12")}>
        <div className="min-w-0 flex-1">
          {titleAs === "sheet"
            ? <><SheetTitle className="font-display text-base">Notifications</SheetTitle><SheetDescription className="sr-only">What happened in your workspaces that concerns you</SheetDescription></>
            : <p className="font-display text-base font-semibold">Notifications</p>}
        </div>
        {anyUnread && inbox.items.length > 0 && (
          <Button variant="outline" size="sm" onClick={inbox.markAllRead}><CheckCheck /> Mark all read</Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!inbox.loaded && inbox.loading ? (
          <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((k) => <div key={k} className="skeleton h-14 rounded-lg" />)}</div>
        ) : inbox.error && !inbox.items.length ? (
          <p role="alert" className="p-4 text-sm text-muted-foreground">{inbox.error.message || "Couldn't load your notifications."} <button type="button" onClick={inbox.load} className="underline">Try again</button></p>
        ) : !inbox.items.length ? (
          <div className="px-4 py-8 text-center">
            <Bell className="mx-auto size-6 text-text-muted" aria-hidden />
            <p className="mt-2 text-sm font-medium">You're all caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">Assignments, changes to your entries and news from your workspaces show up here.</p>
          </div>
        ) : (
          <ul aria-label="Notifications" className="divide-y divide-border">
            {inbox.items.map((i) => <Row key={i.id} item={i} now={now} onOpen={() => open(i)} />)}
          </ul>
        )}
        {inbox.more && inbox.items.length > 0 && (
          <div className="p-3 text-center">
            <Button variant="outline" size="sm" onClick={inbox.loadOlder} disabled={inbox.loadingOlder}>{inbox.loadingOlder && <Loader2 className="animate-spin" />} Load older</Button>
          </div>
        )}
      </div>
      <div className="border-t border-border px-4 py-2.5">
        <Link to="/settings?section=notifications" onClick={onClose} className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <Settings className="size-3.5" /> Choose what shows up here
        </Link>
      </div>
    </>
  );
}

function Row({ item, now, onOpen }: { item: InboxItem; now: number; onOpen: () => void }) {
  const { icon: Icon, tone } = ICON[item.category] ?? ICON.edits;
  const meta = [item.workspaceName || (item.category === "ownerAlerts" ? "Owner" : null), agoShort(item.at, now)].filter(Boolean).join(" · ");
  return (
    <li>
      <button type="button" onClick={onOpen} data-unread={item.read ? undefined : ""}
        className={cn("flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-text-base/[0.04] focus-visible:bg-text-base/[0.06]", !item.read && "bg-accent/[0.06]")}>
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone)} aria-hidden><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", item.read ? "text-text-base/85" : "font-medium text-text-base")}>{item.title}</span>
          {item.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.body}</span>}
          <span className="mt-1 block text-[11px] text-text-muted">{meta}</span>
        </span>
        {!item.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" role="img" />}
      </button>
    </li>
  );
}
