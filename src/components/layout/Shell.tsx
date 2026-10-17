// App shell — Control Point's modern layout: a collapsible left sidebar with
// an animated active pill, a slim top bar with the search pill, and a bottom
// tab bar on phones.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Ambient } from "./Ambient";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, MotionConfig } from "motion/react";
import {
  BookOpen, Bookmark, CalendarDays, ClipboardList, DatabaseZap, Download, House, ListOrdered, Menu, PanelLeftClose, PanelLeftOpen, Scale, Search, Settings, ShieldCheck, Sparkles, Star, Trophy, Users,
} from "lucide-react";
import { cn } from "../cn";
import { useMeta } from "../../lib/meta";
import { Sheet, SheetContent, SheetTitle } from "../ui/overlay";
import { TooltipProvider } from "../ui/overlay";
import { GlobalSearch } from "./Search";
import { AccountMenu } from "./AccountMenu";
import { ClockWeather, ThemeToggle } from "./TopBarExtras";
import { OfflineStatus } from "../OfflineNote";
import { InboxBell } from "./InboxBell";
import { usePersonal } from "../../lib/personal";
import { pageTitle } from "../../shared/routes";
import { SiteFooter } from "./SiteFooter";
import { WorkspacePickerPopover, WorkspacePickerSheet } from "./WorkspacePicker";
import { useYoursRow, FOLLOWED_TEAM_PATH } from "../../lib/yoursRow";

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }

const SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: "/", label: "Home", icon: House, end: true }, { to: "/events", label: "Events", icon: CalendarDays }, { to: "/teams", label: "Teams", icon: Users }, { to: "/rankings", label: "Rankings", icon: ListOrdered }, { to: "/power-rankings", label: "Power rankings", icon: Trophy }] },
  { title: "Predict", items: [
    { to: "/predict", label: "Predict", icon: Sparkles, end: true },
    { to: "/compare", label: "Compare", icon: Scale },
  ] },
  { title: "Yours", items: [
    // The YOURS row: "My team" / "My teams" (YoursNavRow decides what it opens).
    { to: FOLLOWED_TEAM_PATH, label: "My team", icon: Star },
    { to: "/shortlist", label: "Shortlist", icon: Bookmark },
    { to: "/scout", label: "Scout", icon: ClipboardList },
  ] },
  { title: null, items: [{ to: "/download", label: "Download", icon: Download }, { to: "/methodology", label: "How it works", icon: BookOpen }, { to: "/settings", label: "Settings", icon: Settings }] },
];

/** The owner portal's item: only for the owner (/api/auth/me says isOwner), never rendered for anyone else. */
const OWNER_ITEM: NavItem = { to: "/owner", label: "Owner", icon: ShieldCheck };
function useSections() {
  const { user } = usePersonal();
  if (!user?.isOwner) return SECTIONS;
  return SECTIONS.map((s, i) => (i === SECTIONS.length - 1 ? { ...s, items: [...s.items, OWNER_ITEM] } : s));
}

export function BrandMark({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden className={cn("size-7 shrink-0", className)} />;
}

const rowClass = (on: boolean, collapsed?: boolean) => cn("group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
  on ? "text-text-base" : "text-text-muted hover:bg-text-base/[0.05] hover:text-text-base", collapsed && "justify-center px-0");

function RowInner({ item, on, collapsed }: { item: NavItem; on: boolean; collapsed?: boolean }) {
  return (
    <>
      {on && <motion.span layoutId="cs-nav-active" transition={{ type: "spring", stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-text-base/[0.08]" />}
      <item.icon className={cn("relative size-5 shrink-0", on && "text-accent")} />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </>
  );
}

/** `active`: overrides the link's own match (the URL's query decides between Scout and a workspace's space). */
function NavRow({ item, collapsed, onNavigate, active }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; active?: boolean }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} title={collapsed ? item.label : undefined}
      aria-current={active === undefined ? undefined : active ? "page" : false}
      className={({ isActive }) => rowClass(active ?? isActive, collapsed)}>
      {({ isActive }) => <RowInner item={item} on={active ?? isActive} collapsed={collapsed} />}
    </NavLink>
  );
}

/**
 * The YOURS row (src/lib/yoursRow.ts): "My team" to the followed-team page (no workspaces) or to the
 * one workspace's scout space; "My teams" with several, opening the picker: a popover beside the row
 * (the desktop sidebar), or `onPick` when given (phones: the bottom sheet).
 */
function YoursNavRow({ collapsed, onNavigate, onPick }: { collapsed?: boolean; onNavigate?: () => void; onPick?: () => void }) {
  const { row, active } = useYoursRow();
  const [open, setOpen] = useState(false);
  if (row.kind !== "picker") return <NavRow item={{ to: row.to, label: row.label, icon: Star }} collapsed={collapsed} onNavigate={onNavigate} active={active} />;
  const item: NavItem = { to: "", label: row.label, icon: Star };
  const button = (
    <button type="button" title={collapsed ? row.label : undefined} aria-haspopup="dialog" aria-current={active ? "page" : undefined}
      onClick={onPick} className={rowClass(active, collapsed)}>
      <RowInner item={item} on={active} collapsed={collapsed} />
    </button>
  );
  if (onPick) return button;
  return <WorkspacePickerPopover workspaces={row.workspaces} open={open} onOpenChange={setOpen}>{button}</WorkspacePickerPopover>;
}

/** Scout's own row: not lit while the YOURS row is (a workspace's space is "My team(s)"). */
function useScoutRowActive(): boolean | undefined {
  const { row, active } = useYoursRow();
  const loc = useLocation();
  if (row.kind === "followed") return undefined;
  return /^\/scout\/?$/i.test(loc.pathname) && !active;
}

function SectionRows({ items, collapsed, onNavigate, onPick }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void; onPick?: () => void }) {
  const scoutActive = useScoutRowActive();
  return (
    <>
      {items.map((it) => it.to === FOLLOWED_TEAM_PATH
        ? <YoursNavRow key={it.to} collapsed={collapsed} onNavigate={onNavigate} onPick={onPick} />
        : <NavRow key={it.to} item={it} collapsed={collapsed} onNavigate={onNavigate} active={it.to === "/scout" ? scoutActive : undefined} />)}
    </>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, state } = usePersonal();
  const sections = useSections();
  return (
    <aside className={cn("hidden shrink-0 flex-col border-r border-line bg-secondary/60 transition-[width] duration-150 ease-out md:flex", collapsed ? "w-[60px]" : "w-[248px]")}>
      <div className={cn("flex h-12 items-center gap-2.5 px-3.5", collapsed && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Control Scout home">
          <BrandMark className="size-8" />
          {!collapsed && <span className="truncate font-display text-[17px] font-bold tracking-tight">Control Scout</span>}
        </Link>
      </div>
      <nav className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-2 py-2" aria-label="Main">
        {sections.map((s, i) => (
          <div key={i} className="space-y-0.5">
            {s.title && !collapsed && <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted/70">{s.title}</p>}
            <SectionRows items={s.items} collapsed={collapsed} />
          </div>
        ))}
      </nav>
      <div className={cn("flex items-center gap-2 border-t border-line p-2", collapsed && "flex-col")}>
        {!collapsed && (
          <Link to="/settings" className="min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-sm text-text-muted hover:bg-text-base/[0.05] hover:text-text-base">
            {user ? (user.displayName || user.email) : state.myTeam ? `Team ${state.myTeam} · on this device` : "Not signed in"}
          </Link>
        )}
        <button onClick={onToggle} className="flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-text-base/[0.06] hover:text-text-base" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        </button>
      </div>
    </aside>
  );
}

const MOBILE_TABS: NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/predict", label: "Predict", icon: Sparkles },
  { to: FOLLOWED_TEAM_PATH, label: "My team", icon: Star },
];

const tabClass = (on: boolean) => cn("flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-xs font-medium", on ? "text-accent" : "text-text-muted");

function MobileTabs({ onMore, onPick }: { onMore: () => void; onPick: () => void }) {
  const { row, active } = useYoursRow();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-secondary/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden" aria-label="Main">
      {MOBILE_TABS.map((t) => t.to !== FOLLOWED_TEAM_PATH ? (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => tabClass(isActive)}>
          <t.icon className="size-5" />{t.label}
        </NavLink>
      ) : row.kind === "picker" ? (
        <button key={t.to} type="button" onClick={onPick} aria-haspopup="dialog" aria-current={active ? "page" : undefined} className={tabClass(active)}>
          <t.icon className="size-5" />{row.label}
        </button>
      ) : (
        <NavLink key={t.to} to={row.to} aria-current={active ? "page" : undefined} className={tabClass(active)}>
          <t.icon className="size-5" />{row.label}
        </NavLink>
      ))}
      <button onClick={onMore} className="flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-text-muted"><Menu className="size-5" />More</button>
    </nav>
  );
}

/** Shown everywhere when the server has no FTC data yet (a new deploy whose
 *  database isn't connected): says why pages and search are empty. */
function NoDataNotice() {
  const meta = useMeta();
  if (!meta || meta.dataLoaded) return null;
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <DatabaseZap className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p><span className="font-semibold">No FTC team data has been loaded on this server yet.</span> <span className="text-text-muted">Search, teams, events and predictions stay empty until it is. This page checks again every 30 seconds.</span></p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("cs-sidebar") === "1"; } catch { return false; } });
  const [more, setMore] = useState(false);
  // Phones: the "My teams" picker (a bottom sheet), from the tab bar or the More menu.
  const [picker, setPicker] = useState(false);
  const { row: yours } = useYoursRow();
  const mainRef = useRef<HTMLElement>(null);
  const loc = useLocation();
  const { user } = usePersonal();
  const sections = useSections();
  // /owner is a not-found page in the route table (the server can't tell owners apart); for the owner it's the portal.
  const title = user?.isOwner && /^\/owner\/?$/i.test(loc.pathname) ? "Owner" : pageTitle(loc.pathname);
  // The first page is drawn at full opacity (it replaces the static first paint, see server/bootShell.ts); later page changes fade in.
  const firstPage = useRef(true);
  useEffect(() => { firstPage.current = false; }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("cs-sidebar", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <div className="flex h-dvh w-full overflow-hidden bg-primary text-text-base">
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">Skip to content</a>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-6 lg:px-8">
              <Link to="/" className="md:hidden" aria-label="Home"><BrandMark className="size-6" /></Link>
              <p className="truncate text-sm text-text-muted"><span className="hidden sm:inline">Control Scout / </span><span className="text-text-base">{title}</span></p>
              <div className="flex flex-1 justify-end md:justify-center"><GlobalSearch /></div>
              <OfflineStatus />
              <ClockWeather />
              <ThemeToggle />
              {/* The notification inbox: top right, in the header only (never the sidebar). */}
              <InboxBell />
              <AccountMenu />
            </header>
            <div className="relative min-h-0 flex-1">
              <Ambient target={mainRef} />
              <main id="main" ref={mainRef} className="m-canvas custom-scrollbar absolute inset-0 z-10 overflow-y-auto">
                <motion.div key={loc.pathname} initial={firstPage.current ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }} className="mx-auto flex min-h-full w-full max-w-[1200px] flex-col px-4 pt-8 pb-28 sm:px-6 md:pb-8 max-md:[[data-sticky-actions]_&]:pb-44 lg:px-8 min-[1700px]:max-w-[1600px]">
                  <NoDataNotice />
                  {/* The page grows to fill the screen, so a short page still has its footer at the bottom. */}
                  <div className="min-w-0 flex-1">{children}</div>
                  <SiteFooter />
                </motion.div>
              </main>
            </div>
          </div>
          <MobileTabs onMore={() => setMore(true)} onPick={() => setPicker(true)} />
          {yours.kind === "picker" && <WorkspacePickerSheet workspaces={yours.workspaces} open={picker} onOpenChange={setPicker} />}
          <Sheet open={more} onOpenChange={setMore}>
            <SheetContent side="left" className="w-[85vw] max-w-[320px] p-3">
              <SheetTitle className="px-2 pb-2 pt-1 font-display text-base">Control Scout</SheetTitle>
              <nav className="space-y-4" aria-label="All pages">
                {sections.map((s, i) => (
                  <div key={i} className="space-y-0.5">
                    {s.title && <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted/70">{s.title}</p>}
                    <SectionRows items={s.items} onNavigate={() => setMore(false)} onPick={() => { setMore(false); setPicker(true); }} />
                  </div>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}
