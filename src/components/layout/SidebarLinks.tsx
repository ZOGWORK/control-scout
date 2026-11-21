// The quiet links block at the foot of the sidebar (and the phone's menu sheet): About, Donate and Privacy Policy,
// then a row of round buttons to the places the site already links: the GitHub repository, the Discord bot's
// invite, the contact address and the Status page. Every address comes from its existing constant, so nothing here
// can drift from the page footer, the bug report dialog or the lab notes. No API link: there's no public API.
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Activity, Github, HandCoins, Info, Mail, ShieldCheck } from "lucide-react";
import { cn } from "../cn";
import { useFlag } from "../../lib/flags";
import { discordInviteUrl } from "../../shared/discord";
import { REPO_URL } from "../../shared/footer";
import { PRIVATE_EMAIL } from "./BugReport";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** The text links, in order. About is the About section of Settings (SettingsPage's #about hash). */
export const SIDEBAR_LINKS: { to: string; label: string; icon: Icon }[] = [
  { to: "/settings#about", label: "About", icon: Info },
  { to: "/donate", label: "Donate", icon: HandCoins },
  { to: "/privacy", label: "Privacy Policy", icon: ShieldCheck },
];

/** Discord's mark (Simple Icons, CC0), drawn in currentColor like the lucide icons beside it. */
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.1.245.199.372.293a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.086-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.332-.946 2.418-2.157 2.418Z" />
    </svg>
  );
}

/** The round buttons: only places the site already links. Discord is the bot's invite (hidden with no client ID, as
 *  in the page footer); Status only while the owner has the status page on. */
export function sidebarSocials({ discord = discordInviteUrl(), status = true }: { discord?: string | null; status?: boolean } = {}) {
  const rows: { href: string; label: string; icon: ReactNode; external: boolean }[] = [
    { href: REPO_URL, label: "Control Scout on GitHub", icon: <Github className="size-[1.125rem]" aria-hidden />, external: true },
  ];
  if (discord) rows.push({ href: discord, label: "Add the Control Scout bot to Discord", icon: <DiscordIcon className="size-[1.125rem]" />, external: true });
  rows.push({ href: `mailto:${PRIVATE_EMAIL}`, label: "Email Control Scout", icon: <Mail className="size-[1.125rem]" aria-hidden />, external: true });
  if (status) rows.push({ href: "/status", label: "Site status", icon: <Activity className="size-[1.125rem]" aria-hidden />, external: false });
  return rows;
}

const ring = "outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

/** `place`: the desktop sidebar (pinned under the scrolling nav) or the phone's menu sheet. `onNavigate` closes the sheet. */
export function SidebarLinks({ place = "sidebar", onNavigate }: { place?: "sidebar" | "sheet"; onNavigate?: () => void }) {
  const socials = sidebarSocials({ status: useFlag("statusPage") });
  return (
    <div data-sidebar-links="" className={cn("shrink-0 border-t border-line v8:border-white/10", place === "sidebar" ? "px-2 py-2" : "mt-auto pt-3")}>
      <nav aria-label="About Control Scout" className="space-y-0.5">
        {SIDEBAR_LINKS.map(({ to, label, icon: I }) => (
          <Link key={to} to={to} onClick={onNavigate}
            className={cn("tap-44 flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-text-muted transition-colors duration-150 hover:bg-text-base/[0.06] hover:text-text-base v8:hover:bg-white/[0.06]", ring)}>
            <I className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 v8:border-white/10">
        {socials.map((s) => {
          // A 44px link around a 36px ring, so the tap target is full size on every pointer.
          const cls = cn("group flex size-11 shrink-0 items-center justify-center rounded-full", ring);
          const disc = <span className="flex size-9 items-center justify-center rounded-full border border-line text-text-muted transition-colors duration-150 group-hover:bg-text-base/[0.06] group-hover:text-text-base v8:border-white/12 v8:group-hover:bg-white/[0.08]">{s.icon}</span>;
          return s.external
            ? <a key={s.label} href={s.href} aria-label={s.label} title={s.label} className={cls} {...(s.href.startsWith("mailto:") ? {} : { target: "_blank", rel: "noreferrer noopener" })}>{disc}</a>
            : <Link key={s.label} to={s.href} aria-label={s.label} title={s.label} onClick={onNavigate} className={cls}>{disc}</Link>;
        })}
      </div>
    </div>
  );
}
