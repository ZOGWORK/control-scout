// App shell — Control Point's modern layout: a collapsible left sidebar with
// an animated active pill, a slim top bar with the search pill, and a bottom
// tab bar on phones.
import { useRef, useState, type ComponentType, type ReactNode } from "react";
import { Ambient } from "./Ambient";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion, MotionConfig } from "motion/react";
import {
  BookOpen, Bookmark, CalendarDays, ClipboardList, DatabaseZap, Download, House, Menu, PanelLeftClose, PanelLeftOpen, Scale, Search, Settings, Sparkles, Star,
} from "lucide-react";
import { cn } from "../cn";
import { useMeta } from "../../lib/meta";
import { Sheet, SheetContent, SheetTitle } from "../ui/overlay";
import { TooltipProvider } from "../ui/overlay";
import { GlobalSearch } from "./Search";
import { AccountMenu } from "./AccountMenu";
import { ClockWeather, ThemeToggle } from "./TopBarExtras";
import { usePersonal } from "../../lib/personal";

interface NavItem { to: string; label: string; icon: ComponentType<{ className?: string }>; end?: boolean }

const SECTIONS: { title: string | null; items: NavItem[] }[] = [
  { title: null, items: [{ to: "/", label: "Home", icon: House, end: true }, { to: "/events", label: "Events", icon: CalendarDays }] },
  { title: "Predict", items: [
    { to: "/predict", label: "Predict", icon: Sparkles, end: true },
    { to: "/compare", label: "Compare", icon: Scale },
  ] },
  { title: "Yours", items: [
    { to: "/my-team", label: "My team", icon: Star },
    { to: "/shortlist", label: "Shortlist", icon: Bookmark },
    { to: "/scout", label: "Scout", icon: ClipboardList },
  ] },
  { title: null, items: [{ to: "/download", label: "Download", icon: Download }, { to: "/methodology", label: "How it works", icon: BookOpen }, { to: "/settings", label: "Settings", icon: Settings }] },
];

export function BrandMark({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" aria-hidden className={cn("size-7 shrink-0", className)} />;
}

function NavRow({ item, collapsed, onNavigate }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onNavigate} title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn("group relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        isActive ? "text-text-base" : "text-text-muted hover:bg-text-base/[0.05] hover:text-text-base", collapsed && "justify-center px-0")}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="cs-nav-active" transition={{ type: "spring", stiffness: 500, damping: 38 }} className="absolute inset-0 rounded-lg bg-text-base/[0.08]" />}
          <item.icon className={cn("relative size-4 shrink-0", isActive && "text-accent")} />
          {!collapsed && <span className="relative truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { user, state } = usePersonal();
  return (
    <aside className={cn("hidden shrink-0 flex-col border-r border-line bg-secondary/60 transition-[width] duration-150 ease-out md:flex", collapsed ? "w-[60px]" : "w-[248px]")}>
      <div className={cn("flex h-12 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Link to="/" className="flex min-w-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label="Control Scout home">
          <BrandMark />
          {!collapsed && <span className="truncate font-display text-[15px] font-bold tracking-tight">Control Scout</span>}
        </Link>
      </div>
      <nav className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-2 py-1" aria-label="Main">
        {SECTIONS.map((s, i) => (
          <div key={i} className="space-y-0.5">
            {s.title && !collapsed && <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted/70">{s.title}</p>}
            {s.items.map((it) => <NavRow key={it.to} item={it} collapsed={collapsed} />)}
          </div>
        ))}
      </nav>
      <div className={cn("flex items-center gap-2 border-t border-line p-2", collapsed && "flex-col")}>
        {!collapsed && (
          <Link to="/settings" className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-xs text-text-muted hover:bg-text-base/[0.05] hover:text-text-base">
            {user ? (user.displayName || user.email) : state.myTeam ? `Team ${state.myTeam} · on this device` : "Not signed in"}
          </Link>
        )}
        <button onClick={onToggle} className="flex size-8 items-center justify-center rounded-lg text-text-muted hover:bg-text-base/[0.06] hover:text-text-base" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
    </aside>
  );
}

const MOBILE_TABS: NavItem[] = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/predict", label: "Predict", icon: Sparkles },
  { to: "/my-team", label: "My team", icon: Star },
];

function MobileTabs({ onMore }: { onMore: () => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-secondary/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden" aria-label="Main">
      {MOBILE_TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn("flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-xs font-medium", isActive ? "text-accent" : "text-text-muted")}>
          <t.icon className="size-5" />{t.label}
        </NavLink>
      ))}
      <button onClick={onMore} className="flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-text-muted"><Menu className="size-5" />More</button>
    </nav>
  );
}

const TITLES: [RegExp, string][] = [
  [/^\/teams\//, "Team"], [/^\/events\/\d/, "Event"], [/^\/events/, "Events"], [/^\/predict\/how-it-works/, "How it works"], [/^\/predict/, "Predict"],
  [/^\/compare/, "Compare"], [/^\/my-team/, "My team"], [/^\/shortlist/, "Shortlist"], [/^\/scout/, "Scout"], [/^\/download/, "Download"],
  [/^\/settings/, "Settings"], [/^\/methodology/, "How it works"],
];

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
  const mainRef = useRef<HTMLElement>(null);
  const loc = useLocation();
  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? "Home";
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
              <ClockWeather />
              <ThemeToggle />
              <AccountMenu />
            </header>
            <div className="relative min-h-0 flex-1">
              <Ambient target={mainRef} />
              <main id="main" ref={mainRef} className="m-canvas custom-scrollbar absolute inset-0 z-10 overflow-y-auto">
                <motion.div key={loc.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, ease: "easeOut" }} className="mx-auto w-full max-w-[1200px] px-4 pt-8 pb-28 sm:px-6 md:pb-12 lg:px-8 min-[1700px]:max-w-[1600px]">
                  <NoDataNotice />
                  {children}
                </motion.div>
              </main>
            </div>
          </div>
          <MobileTabs onMore={() => setMore(true)} />
          <Sheet open={more} onOpenChange={setMore}>
            <SheetContent side="left" className="w-[85vw] max-w-[320px] p-3">
              <SheetTitle className="px-2 pb-2 pt-1 font-display text-base">Control Scout</SheetTitle>
              <nav className="space-y-4" aria-label="All pages">
                {SECTIONS.map((s, i) => (
                  <div key={i} className="space-y-0.5">
                    {s.title && <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted/70">{s.title}</p>}
                    {s.items.map((it) => <NavRow key={it.to} item={it} onNavigate={() => setMore(false)} />)}
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
