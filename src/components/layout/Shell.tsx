// App shell — Control Point's modern layout: a collapsible left sidebar with
// an animated active pill, a slim top bar with the search pill, and a bottom
// tab bar on phones. The sidebar fits a 1366×768 laptop without its own
// scrollbar: the everyday pages are always there, the rest sit under "More".
// Below 1280 px wide it is an icon rail (names in tooltips), so the page keeps
// its width; the rail's button opens the full labelled menu.
import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { Ambient } from "./Ambient";
import { Link, NavLink, useLocation, useMatch } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { m } from "../motion";
import {
  BookOpen, Bookmark, CalendarDays, ChevronDown, ClipboardList, DatabaseZap, Download, Ellipsis, House, ListOrdered, PanelLeft, PanelLeftClose, PanelLeftOpen, Scale, Search, Settings, ShieldCheck, Sparkles, Star, Trophy, Users,
} from "lucide-react";
import { cn } from "../cn";
import { useMediaQuery, useMeta } from "../../lib/meta";
import { Sheet, SheetContent, SheetTitle, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/overlay";
import { WhatsNewHost, WhatsNewRow, useUnseenRelease } from "../WhatsNew";
import { GlobalSearch } from "./Search";
import { AccountFooter, AccountProvider, useAccountPanel } from "./AccountMenu";
import { ClockWeather, ThemeToggle } from "./TopBarExtras";
import { OfflineStatus } from "../OfflineNote";
import { InboxBell } from "./InboxBell";
import { usePersonal } from "../../lib/personal";
import { isBareRoute, pageTitle } from "../../shared/routes";
import { SiteFooter } from "./SiteFooter";
import { useYoursRow, FOLLOWED_TEAM_PATH } from "../../lib/yoursRow";
import { HEADER_ID, usePageScroll } from "../../lib/pageScroll";
import { tabDef, useTabBar } from "../../lib/tabBar";
import { watchTextSize } from "../../lib/textSize";

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }

/** The everyday pages, always in view; everything else sits under `more` (the sidebar folds it under a "More"
 *  toggle; the menu sheet lists it under a "More" heading). Nothing is left out, just out of the way. */
const SECTIONS: { title: string | null; items: NavItem[]; more?: boolean }[] = [
  { title: null, items: [
    { to: "/", label: "Home", icon: House, end: true },
    { to: "/events", label: "Events", icon: CalendarDays },
    { to: "/teams", label: "Teams", icon: Users },
    { to: "/rankings", label: "Rankings", icon: ListOrdered },
    { to: "/predict", label: "Predict", icon: Sparkles, end: true },
    // The YOURS row: "My team" / "My teams" (YoursNavRow decides what it opens).
    { to: FOLLOWED_TEAM_PATH, label: "My team", icon: Star },
    { to: "/scout", label: "Scout", icon: ClipboardList },
  ] },
  { title: "More", more: true, items: [
    { to: "/power-rankings", label: "Power rankings", icon: Trophy },
    { to: "/compare", label: "Compare", icon: Scale },
    { to: "/shortlist", label: "Shortlist", icon: Bookmark },
    { to: "/download", label: "Download", icon: Download },
    { to: "/methodology", label: "How it works", icon: BookOpen },
    { to: "/settings", label: "Settings", icon: Settings },
  ] },
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

/** `dense`: the sidebar's tighter rows (so it fits a laptop screen); the phone's menu sheet keeps the taller ones. */
const rowClass = (on: boolean, collapsed?: boolean, dense?: boolean) => cn("group relative flex w-full items-center rounded-lg font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
  dense ? "h-8 gap-2.5 px-2.5 text-sm" : "h-10 gap-3 px-3 text-[0.9375rem]",
  on ? "text-text-base" : "text-text-muted hover:bg-text-base/[0.05] hover:text-text-base", collapsed && "justify-center px-0");

/** In the icon rail, a row's name shows in a tooltip beside it (it is always the row's accessible name too). */
function RailTip({ on, label, children }: { on?: boolean; label: string; children: ReactNode }) {
  if (!on) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RowInner({ item, on, collapsed, dense }: { item: NavItem; on: boolean; collapsed?: boolean; dense?: boolean }) {
  return (
    <>
      {on && <m.span layoutId="cs-nav-active" transition={{ type: "spring", stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-text-base/[0.08]" />}
      <item.icon className={cn("relative shrink-0", dense ? "size-[18px]" : "size-5", on && "text-accent")} />
      <span className={collapsed ? "sr-only" : "relative truncate"}>{item.label}</span>
    </>
  );
}

interface RowOpts { collapsed?: boolean; dense?: boolean; onNavigate?: () => void }

/** `active`: overrides the link's own match (the YOURS row is lit on its own page, /my-team or /my-teams). */
function NavRow({ item, collapsed, dense, onNavigate, active }: RowOpts & { item: NavItem; active?: boolean }) {
  // Matched here, not by NavLink's className/children functions: the rail's tooltip trigger (a Radix Slot) only merges plain strings.
  const match = useMatch({ path: item.to, end: !!item.end });
  const on = active ?? !!match;
  return (
    <RailTip on={collapsed} label={item.label}>
      <NavLink to={item.to} end={item.end} onClick={onNavigate} aria-current={on ? "page" : false} className={rowClass(on, collapsed, dense)}>
        <RowInner item={item} on={on} collapsed={collapsed} dense={dense} />
      </NavLink>
    </RailTip>
  );
}

/** The YOURS row (src/lib/yoursRow.ts): "My team" to the followed-team page (no workspaces), or "My team(s)" to /my-teams. */
function YoursNavRow(opts: RowOpts) {
  const { row, active } = useYoursRow();
  return <NavRow item={{ to: row.to, label: row.label, icon: Star }} active={active} {...opts} />;
}

function SectionRows({ items, ...opts }: RowOpts & { items: NavItem[] }) {
  return (
    <>
      {items.map((it) => it.to === FOLLOWED_TEAM_PATH
        ? <YoursNavRow key={it.to} {...opts} />
        : <NavRow key={it.to} item={it} {...opts} />)}
    </>
  );
}

const MORE_KEY = "cs-nav-more";
const isUnder = (path: string, to: string) => path === to || path.startsWith(`${to}/`);

/** The sidebar's "More" group: Download, How it works, Settings, Owner and What's new, folded away until asked for.
 *  It opens by itself on one of its own pages (so the lit row shows); opening or closing it by hand is remembered. */
function MoreGroup({ items, collapsed }: { items: NavItem[]; collapsed?: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(MORE_KEY) === "1"; } catch { return false; } });
  const { pathname } = useLocation();
  const inside = items.some((it) => isUnder(pathname, it.to));
  // Every arrival on one of its pages (from another of them too) shows the lit row.
  useEffect(() => { if (inside) setOpen(true); }, [inside, pathname]);
  const unseen = useUnseenRelease();
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const set = (on: boolean) => { try { localStorage.setItem(MORE_KEY, on ? "1" : "0"); } catch { /* ignore */ } setOpen(on); };
  return (
    // Escape inside the open group folds it and puts the keyboard back on its toggle.
    <div className="space-y-0.5" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); set(false); button.current?.focus(); } }}>
      <RailTip on={collapsed} label={open ? "Fewer pages" : "More pages"}>
        <button ref={button} type="button" onClick={() => set(!open)} aria-expanded={open} aria-controls={id} className={rowClass(false, collapsed, true)}>
          <span className="relative">
            <Ellipsis className="size-[18px] shrink-0" aria-hidden />
            {/* A new release waits under the folded group's What's new. */}
            {!open && unseen && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-secondary" aria-hidden />}
          </span>
          <span className={collapsed ? "sr-only" : "flex-1 truncate text-left"}>More{!open && unseen && <span className="sr-only"> (new release)</span>}</span>
          {!collapsed && <ChevronDown className={cn("size-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />}
        </button>
      </RailTip>
      <div id={id} role="group" aria-label="More pages" hidden={!open} className="space-y-0.5">
        <SectionRows items={items} collapsed={collapsed} dense />
        <WhatsNewRow collapsed={collapsed} dense />
      </div>
    </div>
  );
}

/** `rail`: icons only (a narrow desktop, or folded by hand). `wide`: the screen has room for the full sidebar, so its
 *  button folds it in and out (remembered); below that the button opens the labelled menu sheet instead. */
function Sidebar({ rail, wide, onToggle, onMenu }: { rail: boolean; wide: boolean; onToggle: () => void; onMenu: (from: HTMLElement) => void }) {
  const sections = useSections();
  const toggleLabel = !wide ? "Show page names" : rail ? "Expand sidebar" : "Collapse sidebar";
  return (
    // Held in place while the page scrolls under it. Its rows fit a 768 px tall screen; the nav still scrolls on a shorter one.
    // Above the page (z-20 over main's z-10), so the account panel can open out over it.
    <aside aria-label="Sidebar" className={cn("sticky top-0 z-20 hidden h-dvh shrink-0 flex-col self-start border-r border-line bg-secondary/60 transition-[width] duration-150 ease-out motion-reduce:transition-none md:flex", rail ? "w-[60px]" : "w-[232px]")}>
      <div className={cn("flex h-(--header-h) shrink-0 items-center gap-2.5 px-3.5", rail && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Control Scout home">
          <BrandMark className="size-7" />
          {!rail && <span className="truncate font-display text-base font-bold tracking-tight">Control Scout</span>}
        </Link>
      </div>
      <nav className="custom-scrollbar flex-1 space-y-3 overflow-y-auto px-2 py-1.5" aria-label="Main">
        {sections.map((s, i) => s.more ? <MoreGroup key={i} items={s.items} collapsed={rail} /> : (
          <div key={i} className="space-y-0.5">
            {s.title && (rail
              ? <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden />
              : <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{s.title}</p>)}
            <SectionRows items={s.items} collapsed={rail} dense />
          </div>
        ))}
      </nav>
      {/* The fold button, then who's signed in (Control Point's footer: avatar, name, status, Settings, Sign out). */}
      <div className="shrink-0 space-y-1 border-t border-line p-2">
        <div className={cn("flex", rail ? "justify-center" : "justify-end")}>
          <RailTip on={rail} label={toggleLabel}>
            <button type="button" onClick={(e) => (wide ? onToggle() : onMenu(e.currentTarget))} aria-label={toggleLabel}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted outline-none hover:bg-text-base/[0.06] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60">
              {rail ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
            </button>
          </RailTip>
        </div>
        <AccountFooter place={rail ? "rail" : "sidebar"} />
      </div>
    </aside>
  );
}

const tabClass = (on: boolean) => cn("flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-xs font-medium", on ? "text-accent-text" : "text-text-muted");

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
    <div role="status" className="mb-6 max-sm:mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
      <DatabaseZap className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p><span className="font-semibold">No FTC team data has been loaded on this server yet.</span> <span className="text-text-muted">Search, teams, events and predictions stay empty until it is. This page checks again every 30 seconds.</span></p>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("cs-sidebar") === "1"; } catch { return false; } });
  const [menu, setMenu] = useState(false);
  // The menu sheet and anything opened from it (What's new) hand focus back to the button that opened it (the
  // phone's menu button, or the narrow desktop's rail button) when they close, even when their own opener has
  // gone (a row in the closed sheet) or never had focus (Safari doesn't focus a tapped button).
  const menuRef = useRef<HTMLButtonElement>(null);
  const menuFrom = useRef<HTMLElement | null>(null);
  const toMenu = () => menuFrom.current ?? menuRef.current;
  const openMenu = (from: HTMLElement | null) => { menuFrom.current = from; setMenu(true); };
  // Under 1280 px the sidebar is always the rail, so the page keeps its width.
  const wide = useMediaQuery("(min-width: 1280px)");
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
  // This device's text size follows a change made in another tab, whichever page this one is on.
  useEffect(() => watchTextSize(), []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("cs-sidebar", c ? "0" : "1"); } catch { /* ignore */ } return !c; });
  // The pit display is the whole screen: no sidebar, top bar, tab bar or footer (src/shared/routes.ts isBareRoute).
  // Only the chrome is left out: the same <main> stays, so the page scroll's hold on it (usePageScroll) stays good.
  const bare = isBareRoute(loc.pathname);
  // A link anywhere in the menu sheet (its account footer's too) closes it.
  useEffect(() => { setMenu(false); }, [loc.pathname]);
  return (
    <AccountProvider>
    <AccountSheetBridge menu={menu} openMenu={() => openMenu(menuRef.current)} />
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        {/* At least a screen tall; sideways overflow is clipped (clip, not hidden: no scroll box, so the sticky bars still stick). */}
        <div className="flex min-h-dvh w-full overflow-x-clip bg-primary text-text-base">
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">Skip to content</a>
          {!bare && <Sidebar rail={collapsed || !wide} wide={wide} onToggle={toggle} onMenu={openMenu} />}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Sticky over the scrolling page: opaque, and --header-h tall (index.css: anchors land below it). */}
            {!bare && <header id={HEADER_ID} className="sticky top-0 z-30 flex h-(--header-h) shrink-0 items-center gap-1 border-b border-line bg-primary px-3 sm:px-6 md:gap-3 lg:px-8">
              {/* Phones: the menu (every page) top left with search beside it, the logo centred, and the bell right. */}
              <div className="flex items-center gap-0.5 md:hidden">
                <button ref={menuRef} type="button" onClick={() => openMenu(menuRef.current)} aria-label="Open menu" aria-expanded={menu}
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
            </header>}
            <div className="relative flex-1">
              {/* The ambient layer fills the screen under the top bar and stays there while the page scrolls
                  over it (sticky, and pulled out of the flow by its negative margin). svh, not dvh: a phone's
                  toolbar folding away must not resize it mid-scroll. */}
              {!bare && <div className="pointer-events-none sticky top-(--header-h) -mb-[calc(100svh-var(--header-h))] h-[calc(100svh-var(--header-h))]">
                <Ambient target={mainRef} />
              </div>}
              <main id="main" ref={mainRef} className={bare ? "relative" : "m-canvas relative z-10"}>
                {bare ? children : (
                <m.div key={loc.pathname} initial={firstPage.current ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }} className="mx-auto flex min-h-[calc(100svh-var(--header-h))] w-full max-w-[1200px] flex-col px-4 pt-8 max-sm:pt-5 pb-28 sm:px-6 md:pb-8 max-md:[[data-sticky-actions]_&]:pb-44 lg:px-8 min-[1700px]:max-w-[1600px]">
                  <NoDataNotice />
                  {/* The page grows to fill the screen, so a short page still has its footer at the bottom. */}
                  <div className="min-w-0 flex-1">{children}</div>
                  <SiteFooter />
                </m.div>
                )}
              </main>
              {/* Takes the pointer while the page scrolls (index.css .scroll-shield), so rows don't hover mid-scroll. */}
              <div aria-hidden className="scroll-shield" />
            </div>
          </div>
          {!bare && <MobileTabs />}
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
              {/* The same account footer as the sidebar's, at the foot of the sheet. */}
              <div className="mt-auto border-t border-line pt-3">
                <AccountFooter place="sheet" />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </TooltipProvider>
    </MotionConfig>
    </AccountProvider>
  );
}

/** On a phone the account footer lives in the menu sheet: when the account panel opens by itself (back from a
 *  sign-in, or a Control Point merge), the sheet opens to show it; when the sheet closes, the panel goes with it. */
function AccountSheetBridge({ menu, openMenu }: { menu: boolean; openMenu: () => void }) {
  const { open, setOpen } = useAccountPanel();
  const phone = !useMediaQuery("(min-width: 768px)");
  useEffect(() => { if (open && phone && !menu) openMenu(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const wasOpen = useRef(menu);
  useEffect(() => { if (wasOpen.current && !menu && phone) setOpen(false); wasOpen.current = menu; }, [menu]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
