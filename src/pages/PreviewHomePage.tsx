// The v8 sample Home, third round: a scouting dashboard in the new look (the shutdown page's: server/gatePageNext.ts),
// on its own path so the real Home stays as it is until the owner switches it. Drawn without the site's chrome
// (src/shared/routes.ts isBareRoute), so nothing yellow from the old nav shows around it.
//   - Search is the centre of the page: the biggest thing on it, with four examples under it, a fresh set each visit.
//   - Below it, three cards of the same weight: Events live now, Top teams, Your teams (every one, usually one).
//   - The app's pages in a sidebar on the left (Gemini-like: the mark and name, then a round button that folds it to
//     icons), with nothing at its foot: you, Settings, What's new, the owner console and signing out all
//     sit in the menu under your profile picture, top-right beside the inbox (a guest picture when signed out).
//     Report a bug is a quiet circle in the bottom corner. Near-black, with a dusky purple-grey wash and a fine grain
//     across the top of the page (not the sidebar).
//   - One accent, mint, scoped to this page (data-theme-next): the live progress, the
//     search focus, the #1 rank, links on hover. Numbers and names are white, labels grey; red and blue stay alliances.
// The Control Scout mark sits above search. Every number comes from the same APIs the live Home uses.
import { useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogIn, LogOut, Megaphone, PanelLeft, Settings, ShieldCheck, UserRound } from "lucide-react";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { HomeDashboard } from "../components/home/HomeDashboard";
import { Wash } from "../components/layout/Wash";
import { BugReportButton } from "../components/layout/BugReport";
import { InboxBell } from "../components/layout/InboxBell";
import { UserAvatar } from "../components/UserAvatar";
import { MainNav } from "../components/layout/Shell";
import { openWhatsNew } from "../components/WhatsNew";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/overlay";
import { cn } from "../components/cn";

// The dashboard itself (search, chips, the three cards) is shared with the real Home under v8.
export { EXAMPLE_COUNT, LIVE_MAX, TOP_MAX, TEAMS_MAX, rotatedExamples, liveNow, nextUp, yourTeams } from "../components/home/HomeDashboard";

/** The accent for the new look, scoped to this page: the wash's light slate blue (left side). */
export const MINT = { accent: "#a3b6e0", hover: "#b8c8ea", ink: "#141a2b" } as const;
const THEME_NEXT = {
  "--color-accent": MINT.accent, "--color-accent-hover": MINT.hover, "--color-accent-ink": MINT.ink,
  "--color-accent-text": MINT.accent, "--color-accent-soft": "rgb(163 182 224 / 0.10)", "--color-ring": MINT.accent,
} as CSSProperties;

export default function PreviewHomePage() {
  useTitle("Sample home");
  return (
    <div data-sample-home data-theme-next style={THEME_NEXT} className="flex min-h-dvh overflow-x-clip bg-[#0a0a0b] text-text-base">
      <SideBar />
      <div data-sample-main className="relative min-w-0 flex-1">
      <Wash />
      <Corner />
      {/* On a big screen the whole page grows with it, in steps (src/index.css: html:has([data-sample-home])), so it
          never sits small in the middle of a wide monitor; a laptop sees it as drawn. */}
      <HomeDashboard framed />
      {/* Reporting a bug is occasional: a quiet circle in the page's bottom corner (below the cards on a phone). */}
      <BugReportButton corner />
      </div>
    </div>
  );
}

const SIDE_KEY = "cs-sample-side";
// Pressables shrink a touch while held (0.97, 150ms, strong ease-out) so a tap feels physical; not under reduced motion.
const press = "transition-[color,background-color,border-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:active:scale-100";
const roundButton = cn("flex size-9 shrink-0 items-center justify-center rounded-full text-text-muted outline-none", press, "hover:bg-white/[0.08] hover:text-text-base focus-visible:ring-2 focus-visible:ring-ring/60");

/** The app's pages, Gemini-like: the mark and name with a round fold button beside them; folded, the fold button
 *  sits over the page icons (no search button: the page's own search is the way in). Nothing at its foot (that's all in the profile menu). Wide
 *  screens only; a phone keeps the page alone for now. Folding is remembered on this device. */
function SideBar() {
  const [rail, setRail] = useState(() => { try { return localStorage.getItem(SIDE_KEY) === "1"; } catch { return false; } });
  const fold = () => setRail((r) => { try { localStorage.setItem(SIDE_KEY, r ? "0" : "1"); } catch { /* ignore */ } return !r; });
  const foldLabel = rail ? "Expand sidebar" : "Collapse sidebar";
  return (
    <aside data-sample-sidebar aria-label="Sidebar" data-rail={rail ? "" : undefined}
      className={cn("sticky top-0 z-20 hidden h-dvh shrink-0 flex-col self-start border-r border-white/[0.06] bg-[#0e0e10] transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none md:flex", rail ? "w-16" : "w-[15.5rem]")}>
      <div className={cn("flex shrink-0 items-center gap-1 pt-3 pb-2", rail ? "flex-col px-0" : "h-14 pl-4 pr-2.5")}>
        {!rail && (
          <Link to="/" aria-label="Control Scout home" className="mr-auto flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            <img src="/mark-white.webp" alt="" width={20} height={20} className="size-5 shrink-0" />
            <span className="truncate font-display text-[0.9375rem] font-semibold tracking-tight">Control Scout</span>
          </Link>
        )}
        {/* One fold button in one place, folded or not, so pressing it keeps keyboard focus on it. Its name shows in a
            tooltip only when folded (open, the name is beside it). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" data-fold onClick={fold} aria-label={foldLabel} className={cn(roundButton, "bg-white/[0.06]")}><PanelLeft className="size-[1.125rem]" /></button>
          </TooltipTrigger>
          {rail && <TooltipContent side="right">{foldLabel}</TooltipContent>}
        </Tooltip>
      </div>
      <nav aria-label="Main" className="custom-scrollbar flex-1 space-y-(--nav-section) overflow-y-auto px-2 pt-2 pb-4">
        <MainNav collapsed={rail} />
      </nav>
    </aside>
  );
}

/** Top-right, on the wash with no bar behind it: the inbox, then you. Your profile picture (your initial without one;
 *  a guest picture signed out) opens your menu: who you are, Settings, What's new, the owner console (the owner
 *  only: /api/auth/me marks isOwner, and the server checks every owner call itself) and Sign out, or Sign in. */
function Corner() {
  const { user, signOut } = usePersonal();
  const nav = useNavigate();
  const name = user?.displayName || user?.email || null;
  const item = "gap-2.5 py-2";
  return (
    <div data-corner-tools className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-5">
      <InboxBell />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-profile aria-label={user ? `Account: ${name ?? "you"}` : "Sign in"} title={user ? (name ?? "Account") : "Sign in"}
            className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            {user ? (
              <UserAvatar url={user.avatarUrl} name={name} className="size-9 bg-white/10 text-text-base ring-1 ring-white/15" />
            ) : (
              <span data-guest className="flex size-9 items-center justify-center rounded-full bg-white/[0.08] text-text-muted ring-1 ring-white/15"><UserRound className="size-5" aria-hidden /></span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-profile-menu className="w-64 origin-(--radix-dropdown-menu-content-transform-origin) border-white/10 bg-[#141416] p-1.5 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [--tw-enter-scale:0.97] [--tw-exit-scale:0.97] motion-reduce:[--tw-enter-scale:1] motion-reduce:[--tw-exit-scale:1]">
          {user ? (
            <DropdownMenuLabel className="px-2 py-2 font-normal">
              <span className="block truncate text-sm font-medium text-text-base">{user.displayName || user.email}</span>
              {user.displayName && <span className="block truncate text-xs text-text-muted">{user.email}</span>}
            </DropdownMenuLabel>
          ) : (
            <DropdownMenuItem className={item} onSelect={() => nav("/settings#account")}><LogIn className="size-4" /> Sign in</DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="bg-white/10" />
          <DropdownMenuItem className={item} onSelect={() => nav("/settings")}><Settings className="size-4" /> Settings</DropdownMenuItem>
          <DropdownMenuItem className={item} onSelect={() => openWhatsNew()}><Megaphone className="size-4" /> What’s new</DropdownMenuItem>
          {user?.isOwner && <DropdownMenuItem data-owner-console className={item} onSelect={() => nav("/owner")}><ShieldCheck className="size-4" /> Owner console</DropdownMenuItem>}
          {user && (
            <>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem className={item} onSelect={() => { void signOut(); }}><LogOut className="size-4" /> Sign out</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
