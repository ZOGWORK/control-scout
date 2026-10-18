// The small footer at the bottom of every page's content (inside the Shell's
// scrolling main, so on phones it sits above the bottom tab bar's padding).
// Site-level links live in FOOTER_LINKS: add a page here and it shows everywhere.
import { Link } from "react-router-dom";

export const FOOTER_LINKS: { to: string; label: string }[] = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact" },
];

export function SiteFooter() {
  return (
    <footer className="mt-16 flex flex-col gap-3 border-t border-line pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Site" className="flex flex-wrap gap-x-5 gap-y-2">
        {FOOTER_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="rounded py-1 font-medium hover:text-text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{l.label}</Link>
        ))}
      </nav>
      <p>© Control Scout · Not affiliated with <i>FIRST</i>®</p>
    </footer>
  );
}
