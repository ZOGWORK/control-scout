// The site's own pages, linked from the footer of every page: the app's (src/components/layout/SiteFooter.tsx) and the
// server's first paint (server/bootShell.ts), so each is reachable from anywhere, with or without JavaScript.
export const FOOTER_LINKS: { to: string; label: string }[] = [
  { to: "/methodology", label: "Methodology" },
  { to: "/faq", label: "FAQ" },
  { to: "/rules", label: "Rules" },
  { to: "/settings", label: "Settings" },
  { to: "/donate", label: "Donate" },
  { to: "/contact", label: "Contact" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
];
