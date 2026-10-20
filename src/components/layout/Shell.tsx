// App shell — Control Point's modern layout: a collapsible left sidebar with
// an animated active pill, a slim top bar with the search pill, and a bottom
// tab bar on phones.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Ambient } from "./Ambient";
import { Link, NavLink, useLocation } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { m } from "../motion";
import {
  BookOpen, Bookmark, CalendarDays, ClipboardList, DatabaseZap, Download, House, ListOrdered, PanelLeft, PanelLeftClose, PanelLeftOpen, Scale, Search, Settings, ShieldCheck, Sparkles, Star, Trophy, Users,
} from "lucide-react";
import { cn } from "../cn";
import { useMeta } from "../../lib/meta";
import { Sheet, SheetContent, SheetTitle } from "../ui/overlay";
import { WhatsNewHost, WhatsNewRow } from "../WhatsNew";
import { TooltipProvider } from "../ui/overlay";
import { GlobalSearch } from "./Search";
import { AccountMenu } from "./AccountMenu";
import { ClockWeather, ThemeToggle } from "./TopBarExtras";
import { OfflineStatus } from "../OfflineNote";
import { InboxBell } from "./InboxBell";
import { usePersonal } from "../../lib/personal";
import { pageTitle } from "../../shared/routes";
import { SiteFooter } from "./SiteFooter";
import { useYoursRow, FOLLOWED_TEAM_PATH } from "../../lib/yoursRow";
import { HEADER_ID, usePageScroll } from "../../lib/pageScroll";
import { tabDef, useTabBar } from "../../lib/tabBar";

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

const rowClass = (on: boolean, collapsed?: boolean) => cn("group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
  on ? "text-text-base" : "text-text-muted hover:bg-text-base/[0.05] hover:text-text-base", collapsed && "justify-center px-0");

function RowInner({ item, on, collapsed }: { item: NavItem; on: boolean; collapsed?: boolean }) {
  return (
    <>
      {on && <m.span layoutId="cs-nav-active" transition={{ type: "spring", stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-text-base/[0.08]" />}
      <item.icon className={cn("relative size-5 shrink-0", on && "text-accent")} />
      {!collapsed && <span className="relative truncate">{item.label}</span>}
    </>
  );
}

/** `active`: overrides the link's own match (the YOURS row is lit on its own page, /my-team or /my-teams). */
function NavRow({ item, collapsed, onNavigate, active }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; active?: boolean }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} title={collapsed ? item.label : undefined}
      aria-current={active === undefined ? undefined : active ? "page" : false}
      className={({ isActive }) => rowClass(active ?? isActive, collapsed)}>
      {({ isActive }) => <RowInner item={item} on={active ?? isActive} collapsed={collapsed} />}
    </NavLink>
  );
}

/** The YOURS row (src/lib/yoursRow.ts): "My team" to the followed-team page (no workspaces), or "My team(s)" to /my-teams. */
function YoursNavRow({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { row, active } = useYoursRow();
  return <NavRow item={{ to: row.to, label: row.label, icon: Star }} collapsed={collapsed} onNavigate={onNavigate} active={active} />;
}

function SectionRows({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <>
      {items.map((it) => it.to === FOLLOWED_TEAM_PATH
        ? <YoursNavRow key={it.to} collapsed={collapsed} onNavigate={onNavigate} />
        : <NavRow key={it.to} item={it} collapsed={collapsed} onNavigate={onNavigate} />)}
    </>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, state } = usePersonal();
  const sections = useSections();
  return (
    // Held in place while the page scrolls under it, with its own scroll for a long list (the nav below).
    <aside aria-label="Sidebar" className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-line bg-secondary/60 transition-[width] duration-150 ease-out md:flex", collapsed ? "w-[60px]" : "w-[248px]")}>
      <div className={cn("flex h-12 items-center gap-2.5 px-3.5", collapsed && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Control Scout home">
          <BrandMark className="size-8" />
          {!collapsed && <span className="truncate font-display text-[1.0625rem] font-bold tracking-tight">Control Scout</span>}
        </Link>
      </div>
      <nav className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-2 py-2" aria-label="Main">
        {sections.map((s, i) => (
          <div key={i} className="space-y-0.5">
            {s.title && !collapsed && <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">{s.title}</p>}
            <SectionRows items={s.items} collapsed={collapsed} />
          </div>
        ))}
      </nav>
      <div className="px-2 pb-1"><WhatsNewRow collapsed={collapsed} /></div>
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

const tabClass = (on: boolean) => cn("flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-xs font-medium", on ? "text-accent-text" : "text-text-muted");

/** The phone's bottom bar: the pages this device picked (Settings › Appearance, src/lib/tabBar.ts). Every page,
 *  these included, is also in the menu the top-left button opens. */
function MobileTabs() {
  const tabs = useTabBar();
  const { row, active } = useYoursRow();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-secondary pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main">
      {tabs.map((id) => {
        const t = tabDef(id);
        // My team / My teams: the YOURS row decides the label, where it goes and when it's lit (src/lib/yoursRow.ts).
        if (id === "myTeam") return (
          <NavLink key={id} to={row.to} aria-current={active ? "page" : undefined} className={tabClass(active)}>
            <t.icon className="size-5 shrink-0" /><span className="max-w-full truncate">{row.label}</span>
          </NavLink>
        );
        return (
          <NavLink key={id} to={t.to} end={t.end} className={({ isActive }) => tabClass(isActive)}>
            <t.icon className="size-5 shrink-0" /><span className="max-w-full truncate">{t.label}</span>
          </NavLink>
        );
      })}
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
  const [menu, setMenu] = useState(false);
  // The phone's menu sheet and anything opened from it (What's new) hand focus back to the menu button when they
  // close, even when their own opener has gone (a row in the closed sheet) or never had focus (Safari doesn't
  // focus a tapped button).
  const menuRef = useRef<HTMLButtonElement>(null);
  const toMenu = () => menuRef.current;
  const mainRef = useRef<HTMLElement>(null);
  // The page scrolls the document (so phone browsers fold their toolbars away). Back/forward return to where
  // the page was left once its data is back, and a new page starts at the top (src/lib/pageScroll.ts).
  usePageScroll(mainRef);
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
        {/* At least a screen tall; sideways overflow is clipped (clip, not hidden: no scroll box, so the sticky bars still stick). */}
        <div className="flex min-h-dvh w-full overflow-x-clip bg-primary text-text-base">
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">Skip to content</a>
          <Sidebar collapsed={collapsed} onToggle={toggle} />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Sticky over the scrolling page: opaque, and --header-h tall (index.css: anchors land below it). */}
            <header id={HEADER_ID} className="sticky top-0 z-30 flex h-(--header-h) shrink-0 items-center gap-1 border-b border-line bg-primary px-3 sm:px-6 md:gap-3 lg:px-8">
              {/* Phones: the menu (every page) top left with search beside it, the logo centred, and the account side right. */}
              <div className="flex items-center gap-0.5 md:hidden">
                <button ref={menuRef} type="button" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}
                  className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60">
                  <PanelLeft className="size-5" />
                </button>
                <GlobalSearch part="button" />
              </div>
              <Link to="/" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60 md:hidden" aria-label="Control Scout home"><BrandMark /></Link>
              <p className="hidden truncate text-sm text-text-muted md:block"><span>Control Scout / </span><span className="text-text-base">{title}</span></p>
              <div className="flex flex-1 justify-end md:justify-center"><GlobalSearch part="field" /></div>
              <OfflineStatus />
              <ClockWeather />
              <ThemeToggle />
              {/* The notification inbox: top right, in the header only (never the sidebar). */}
              <InboxBell />
              <AccountMenu />
            </header>
            <div className="relative flex-1">
              {/* The ambient layer fills the screen under the top bar and stays there while the page scrolls
                  over it (sticky, and pulled out of the flow by its negative margin). svh, not dvh: a phone's
                  toolbar folding away must not resize it mid-scroll. */}
              <div className="pointer-events-none sticky top-(--header-h) -mb-[calc(100svh-var(--header-h))] h-[calc(100svh-var(--header-h))]">
                <Ambient target={mainRef} />
              </div>
              <main id="main" ref={mainRef} className="m-canvas relative z-10">
                <m.div key={loc.pathname} initial={firstPage.current ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }} className="mx-auto flex min-h-[calc(100svh-var(--header-h))] w-full max-w-[1200px] flex-col px-4 pt-8 pb-28 sm:px-6 md:pb-8 max-md:[[data-sticky-actions]_&]:pb-44 lg:px-8 min-[1700px]:max-w-[1600px]">
                  <NoDataNotice />
                  {/* The page grows to fill the screen, so a short page still has its footer at the bottom. */}
                  <div className="min-w-0 flex-1">{children}</div>
                  <SiteFooter />
                </m.div>
              </main>
              {/* Takes the pointer while the page scrolls (index.css .scroll-shield), so rows don't hover mid-scroll. */}
              <div aria-hidden className="scroll-shield" />
            </div>
          </div>
          <MobileTabs />
          <WhatsNewHost />
          <Sheet open={menu} onOpenChange={setMenu}>
            <SheetContent side="left" returnFocus={toMenu} className="w-[85vw] max-w-[320px] p-3">
              <SheetTitle className="px-2 pb-2 pt-1 font-display text-base">Control Scout</SheetTitle>
              <nav className="space-y-4" aria-label="All pages">
                {sections.map((s, i) => (
                  <div key={i} className="space-y-0.5">
                    {s.title && <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-text-muted">{s.title}</p>}
                    <SectionRows items={s.items} onNavigate={() => setMenu(false)} />
                  </div>
                ))}
                <WhatsNewRow onOpen={() => setMenu(false)} returnTo={toMenu} />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}
