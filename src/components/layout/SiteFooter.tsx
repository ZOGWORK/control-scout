// The small footer at the bottom of every page's content (inside the Shell's
// scrolling main, so on phones it sits above the bottom tab bar's padding).
// Site-level links live in FOOTER_LINKS (src/shared/footer.ts, shared with the server's first paint): add a page there and it shows everywhere.
// The running release ("v1.3.8", from package.json via vite's __APP_VERSION__) opens What's new.
import { Link, useLocation } from "react-router-dom";
import { currentRelease } from "../../lib/changelog";
import { discordInviteUrl } from "../../shared/discord";
import { liteHref } from "../../shared/lite";
import { useFlag } from "../../lib/flags";
import { openWhatsNew } from "../WhatsNew";
import { FOOTER_LINKS, footerLinks } from "../../shared/footer";

export { FOOTER_LINKS };

const LINK = "tap-44 rounded py-1 font-medium hover:text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60";

export function SiteFooter({ discordInvite = discordInviteUrl(), release = currentRelease() }: { discordInvite?: string | null; release?: string | null } = {}) {
  const loc = useLocation();
  // This page's light twin (src/shared/lite.ts), for a weak signal: a full page load, it's the server's own HTML.
  // Hidden while the owner has the light version switched off (venueLightMode).
  const lite = useFlag("venueLightMode") ? liteHref(loc.pathname, loc.search) : null;
  // Rules only while the owner has the rules reference on (rulesReference), as the sidebar has it.
  const rules = useFlag("rulesReference");
  const status = useFlag("statusPage");
  return (
    <footer className="mt-16 flex flex-col gap-3 border-t border-line pt-6 max-sm:pt-4 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Site" className="flex flex-wrap gap-x-5 gap-y-2">
        {footerLinks((f) => (f === "rulesReference" ? rules : f === "statusPage" ? status : true)).map((l) => (
          <Link key={l.to} to={l.to} className={LINK}>{l.label}</Link>
        ))}
        {/* The Discord bot's invite, once it has a client ID (src/shared/discord.ts). */}
        {discordInvite && <a href={discordInvite} target="_blank" rel="noreferrer noopener" className={LINK}>Discord bot</a>}
        {lite && <a href={lite} className={LINK} data-lite-link="">Light version</a>}
      </nav>
      <p>
        © Control Scout ·{" "}
        {release && <><button type="button" onClick={() => openWhatsNew()} aria-label={`What's new in v${release}`} className={`${LINK} font-mono`}>v{release}</button>{" · "}</>}
        Not affiliated with <i>FIRST</i>®
      </p>
    </footer>
  );
}
