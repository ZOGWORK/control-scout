// The site's own pages, linked from the footer of every page: the app's (src/components/layout/SiteFooter.tsx) and the
// server's first paint (server/bootShell.ts), so each is reachable from anywhere, with or without JavaScript.
import type { Flag } from "./flags.js";

// A link with a flag shows only while the owner has that feature on (its page says "switched off" otherwise).
export const FOOTER_LINKS: { to: string; label: string; flag?: Flag }[] = [
  { to: "/methodology", label: "Methodology" },
  { to: "/faq", label: "FAQ" },
  { to: "/rules", label: "Rules", flag: "rulesReference" },
  { to: "/settings", label: "Settings" },
  { to: "/donate", label: "Donate" },
  { to: "/status", label: "Status", flag: "statusPage" },
  { to: "/contact", label: "Contact" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
];

/** The footer's links with the owner's switched-off features left out. */
export const footerLinks = (on: (flag: Flag) => boolean) => FOOTER_LINKS.filter((l) => !l.flag || on(l.flag));
