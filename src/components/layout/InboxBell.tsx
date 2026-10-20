// The notification inbox's bell, top right of the header (never in the sidebar; docs/inbox.md). Signed
// in only. The badge is the unread count (synced across devices); a click opens the list: a panel under
// the bell on wider screens, a bottom sheet on phones. Tapping an item marks it read and opens the place
// it's about: the entry, the workspace's activity, its template, or the owner portal's storage panel.
// Each item also has two toggles, synced to the account: Mark unread (back in the badge) and Follow up (a flag
// for work still to do, separate from read), and the Follow up filter lists the flagged ones.
import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import { AnimatePresence, m } from "motion/react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, CheckCheck, ClipboardCheck, Flag, HardDrive, LayoutList, ListOrdered, Loader2, Mail, MailOpen, MessageSquare, PencilLine, Settings, Users } from "lucide-react";
import { usePersonal } from "../../lib/personal";
import { useInbox, type InboxState } from "../../lib/inbox";
import { agoShort } from "../../lib/format";
import type { InboxCategory, InboxFilter, InboxItem } from "../../shared/inbox";
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
  const { open: opened } = inbox;
  // Opening shows the latest; navigation, Esc and a click elsewhere close the panel.
  useEffect(() => { if (open) opened(); }, [open, opened]);
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
            <m.span key="badge" data-inbox-badge aria-hidden
              initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.16 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-ink tabular-nums ring-2 ring-primary">
              {badgeText(inbox.unread)}
            </m.span>
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
            <m.div id={panelId} role="dialog" aria-label="Notifications" key="panel"
              initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }} style={{ transformOrigin: "top right" }}
              className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(36rem,calc(100dvh-5rem))] w-[24rem] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]">
              <InboxList inbox={inbox} onClose={() => setOpen(false)} titleAs="panel" />
            </m.div>
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
  const following = inbox.filter === "followUp";
  return (
    <>
      <div className={cn("flex items-center gap-2 border-b border-border px-4 py-3", titleAs === "sheet" && "pr-12")}>
        <div className="min-w-0 flex-1">
          {titleAs === "sheet"
            ? <><SheetTitle className="font-display text-base">Notifications</SheetTitle><SheetDescription className="sr-only">What happened in your workspaces that concerns you</SheetDescription></>
            : <p className="font-display text-base font-semibold">Notifications</p>}
        </div>
        {anyUnread && inbox.items.length > 0 && !following && (
          <Button variant="outline" size="sm" onClick={inbox.markAllRead}><CheckCheck /> Mark all read</Button>
        )}
      </div>
      <FilterBar filter={inbox.filter} followUp={inbox.followUp} onChange={inbox.setFilter} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!inbox.loaded && inbox.loading ? (
          <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((k) => <div key={k} className="skeleton h-14 rounded-lg" />)}</div>
        ) : inbox.error && !inbox.items.length ? (
          <p role="alert" className="p-4 text-sm text-muted-foreground">{inbox.error.message || "Couldn't load your notifications."} <button type="button" onClick={inbox.load} className="underline">Try again</button></p>
        ) : !inbox.items.length && following ? (
          <div className="px-4 py-8 text-center">
            <Flag className="mx-auto size-6 text-orange-700 dark:text-orange-400" aria-hidden />
            <p className="mt-2 text-sm font-medium">Nothing to follow up</p>
            <p className="mt-1 text-sm text-muted-foreground">Flag a notification with Follow up to keep it here until the work is done.</p>
          </div>
        ) : !inbox.items.length ? (
          <div className="px-4 py-8 text-center">
            <Bell className="mx-auto size-6 text-text-muted" aria-hidden />
            <p className="mt-2 text-sm font-medium">You're all caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">Assignments, changes to your entries and news from your workspaces show up here.</p>
          </div>
        ) : (
          <ul aria-label="Notifications" className="divide-y divide-border">
            {inbox.items.map((i) => (
              <Row key={i.id} item={i} now={now} onOpen={() => open(i)}
                onToggleRead={() => (i.read ? inbox.markUnread([i.id]) : inbox.markRead([i.id]))}
                onToggleFollowUp={() => inbox.setFollowUp([i.id], !i.followUp)} />
            ))}
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

const FILTERS: { value: InboxFilter; label: string }[] = [{ value: "all", label: "All" }, { value: "followUp", label: "Follow up" }];

/** All | Follow up (with how many are flagged). */
function FilterBar({ filter, followUp, onChange }: { filter: InboxFilter; followUp: number; onChange: (f: InboxFilter) => void }) {
  return (
    <div role="group" aria-label="Show" className="flex items-center gap-1.5 border-b border-border px-4 py-2">
      {FILTERS.map((f) => {
        const on = filter === f.value;
        return (
          <button key={f.value} type="button" aria-pressed={on} onClick={() => onChange(f.value)} data-inbox-filter={f.value}
            aria-label={f.value === "followUp" && followUp > 0 ? `${f.label}, ${followUp} flagged` : undefined}
            className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
              on ? (f.value === "followUp" ? "border-orange-500/40 bg-orange-500/15 text-orange-800 dark:text-orange-300" : "border-accent/50 bg-accent/15 text-text-base")
                : "border-border bg-transparent text-text-base/80 hover:bg-text-base/[0.05] hover:text-text-base")}>
            {f.value === "followUp" && <Flag className="size-3.5" aria-hidden />}
            {f.label}
            {f.value === "followUp" && followUp > 0 && (
              <span aria-hidden className="rounded-full bg-orange-500/20 px-1.5 text-[11px] leading-4 tabular-nums text-orange-800 dark:text-orange-300">{badgeText(followUp)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Row({ item, now, onOpen, onToggleRead, onToggleFollowUp }: { item: InboxItem; now: number; onOpen: () => void; onToggleRead: () => void; onToggleFollowUp: () => void }) {
  const { icon: Icon, tone } = ICON[item.category] ?? ICON.edits;
  const meta = [item.workspaceName || (item.category === "ownerAlerts" ? "Owner" : null), agoShort(item.at, now)].filter(Boolean).join(" · ");
  const action = "grid size-8 shrink-0 place-items-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60";
  const idle = "border-transparent text-text-muted hover:border-border hover:bg-text-base/[0.06] hover:text-text-base";
  return (
    <li data-follow-up={item.followUp ? "" : undefined} className={cn("flex items-start transition-colors", !item.read && "bg-accent/[0.06]")}>
      <button type="button" onClick={onOpen} data-unread={item.read ? undefined : ""}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 text-left outline-none transition-colors hover:bg-text-base/[0.04] focus-visible:bg-text-base/[0.06]">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", tone)} aria-hidden><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", item.read ? "text-text-base/85" : "font-medium text-text-base")}>{item.title}</span>
          {item.body && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.body}</span>}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
            <span>{meta}</span>
            {item.followUp && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-1.5 font-medium text-orange-800 dark:text-orange-300">
                <Flag className="size-3" aria-hidden /> Follow up
              </span>
            )}
          </span>
        </span>
        {!item.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" role="img" />}
      </button>
      <div className="flex shrink-0 items-center gap-1 py-2.5 pr-3">
        <button type="button" onClick={onToggleRead} aria-pressed={!item.read} aria-label={`Mark '${item.title}' unread`} title={item.read ? "Mark unread" : "Mark read"} data-inbox-unread
          className={cn(action, !item.read ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300" : idle)}>
          {item.read ? <Mail className="size-4" aria-hidden /> : <MailOpen className="size-4" aria-hidden />}
        </button>
        <button type="button" onClick={onToggleFollowUp} aria-pressed={item.followUp} aria-label={`Follow up on '${item.title}'`} title={item.followUp ? "Remove follow-up flag" : "Follow up"} data-inbox-follow-up
          className={cn(action, item.followUp ? "border-orange-500/40 bg-orange-500/15 text-orange-700 dark:text-orange-400" : idle)}>
          <Flag className={cn("size-4", item.followUp && "fill-current")} aria-hidden />
        </button>
      </div>
    </li>
  );
}
