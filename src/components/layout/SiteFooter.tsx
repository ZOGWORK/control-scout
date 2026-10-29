// The small footer at the bottom of every page's content (inside the Shell's
// scrolling main, so on phones it sits above the bottom tab bar's padding).
// Site-level links live in FOOTER_LINKS: add a page here and it shows everywhere.
// The running release ("v1.3.8", from package.json via vite's __APP_VERSION__) opens What's new.
import { Link } from "react-router-dom";
import { currentRelease } from "../../lib/changelog";
import { discordInviteUrl } from "../../shared/discord";
import { openWhatsNew } from "../WhatsNew";

export const FOOTER_LINKS: { to: string; label: string }[] = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

const LINK = "rounded py-1 font-medium hover:text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

export function SiteFooter({ discordInvite = discordInviteUrl(), release = currentRelease() }: { discordInvite?: string | null; release?: string | null } = {}) {
  return (
    <footer className="mt-16 flex flex-col gap-3 border-t border-line pt-6 max-sm:pt-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Site" className="flex flex-wrap gap-x-5 gap-y-2">
        {FOOTER_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className={LINK}>{l.label}</Link>
        ))}
        {/* The Discord bot's invite, once it has a client ID (src/shared/discord.ts). */}
        {discordInvite && <a href={discordInvite} target="_blank" rel="noreferrer noopener" className={LINK}>Discord bot</a>}
      </nav>
      <p>
        © Control Scout ·{" "}
        {release && <><button type="button" onClick={() => openWhatsNew()} aria-label={`What's new in v${release}`} className={`${LINK} font-mono`}>v{release}</button>{" · "}</>}
        Not affiliated with <i>FIRST</i>®
      </p>
    </footer>
  );
}
