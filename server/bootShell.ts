// The static first paint: the app shell's outline (sidebar, top bar, phone tab
// bar) in the app's colours, plus the page's own title and description, put
// inside #root by the server so something real shows before the JavaScript has
// loaded and run. React's first render (createRoot, no hydration) replaces all
// of it in one step. Self-contained: inline styles, no icons, plain links that
// work without JS. The theme comes from the class the inline <head> script sets
// on <html> (index.html): dark by default, html.light for light.
//
// Offline, the service worker answers every page with the cached "/" HTML, so
// the page block carries the path it was made for and hides itself on another.
import type { PageMeta } from "./seoMeta.js";
import { pageTitle } from "../src/shared/routes.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Mirrors the Shell (src/components/layout/Shell.tsx): sizes, spacing, colours.
export const BOOT_STYLE = `<style>
      .csb{--b-bg:#0a0a0b;--b-side:#0c0c0e;--b-fg:#f4f4f5;--b-mut:#a1a1aa;--b-line:#ffffff14;--b-acc:#ffc700;--b-tab:#0e0e10f2;display:flex;height:100vh;height:100dvh;overflow:hidden;background:var(--b-bg);color:var(--b-fg);font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      html.light .csb{--b-bg:#fff;--b-side:#fcfcfc;--b-fg:#09090b;--b-mut:#52525b;--b-line:#e4e4e7;--b-acc:#eab308;--b-tab:#fafafaf2}
      .csb a{color:inherit;text-decoration:none}
      .csb-side{display:none;flex-direction:column;flex-shrink:0;width:248px;border-right:1px solid var(--b-line);background:var(--b-side)}
      .csb-brand{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;font:700 17px/1 "Space Grotesk",sans-serif;letter-spacing:-.025em}
      .csb-brand img{width:32px;height:32px}
      .csb-nav{padding:8px}
      .csb-grp{margin-bottom:20px}
      .csb-grp p{margin:0;padding:0 12px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.2em;color:var(--b-mut);opacity:.7}
      .csb-nav a{display:flex;align-items:center;gap:12px;height:40px;padding:0 12px;border-radius:8px;font-size:15px;font-weight:500;color:var(--b-mut)}
      .csb-nav a[aria-current]{color:var(--b-fg);background:color-mix(in srgb,var(--b-fg) 8%,transparent)}
      .csb-ico{width:20px;height:20px;flex-shrink:0;border-radius:6px;background:currentColor;opacity:.22}
      .csb-nav a[aria-current] .csb-ico{background:var(--b-acc);opacity:.9}
      html.cs-sb-min .csb-side{width:60px}
      html.cs-sb-min .csb-brand{justify-content:center;padding:0}
      html.cs-sb-min .csb-brand span,html.cs-sb-min .csb-grp p,html.cs-sb-min .csb-nav a span{display:none}
      html.cs-sb-min .csb-nav a{justify-content:center;padding:0}
      .csb-col{display:flex;flex:1;min-width:0;flex-direction:column}
      .csb-top{display:flex;flex-shrink:0;align-items:center;gap:12px;height:48px;padding:0 16px;border-bottom:1px solid var(--b-line)}
      .csb-top>a img{display:block;width:24px;height:24px}
      .csb-crumb{margin:0;font-size:14px;color:var(--b-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .csb-crumb b{font-weight:400;color:var(--b-fg)}
      .csb-crumb i{display:none;font-style:normal}
      .csb-search{display:flex;flex:1;justify-content:flex-end}
      .csb-search span{display:flex;align-items:center;height:32px;padding:0 10px;border:1px solid var(--b-line);border-radius:8px;font-size:12px;color:var(--b-mut)}
      .csb-main{flex:1;min-height:0;overflow:hidden;background-image:radial-gradient(1200px 320px at 50% -120px,color-mix(in srgb,var(--b-acc) 7%,transparent),transparent 70%)}
      .csb-page{max-width:1200px;margin:0 auto;padding:32px 16px 0}
      .csb-page h1{margin:0;font:600 24px/1.25 "Space Grotesk",sans-serif;letter-spacing:-.025em;overflow-wrap:anywhere}
      .csb-page>p{margin:6px 0 0;max-width:42rem;font-size:14px;line-height:1.45;color:var(--b-mut)}
      .csb-main.csb-scroll{overflow:auto;padding-bottom:96px}
      .csb-body{max-width:48rem;margin-top:8px;font-size:14px;line-height:1.55;color:var(--b-mut)}
      .csb-body a{color:var(--b-fg);text-decoration:underline;text-underline-offset:2px}
      .csb-body h2{margin:20px 0 4px;font:600 16px/1.3 "Space Grotesk",sans-serif;color:var(--b-fg)}
      .csb-body h2 span{color:var(--b-acc)}
      .csb-body h2 small{margin-left:6px;font:500 12px Inter,sans-serif;color:var(--b-mut)}
      .csb-pr,.csb-pr-arch{margin:0;padding:0;list-style:none}
      .csb-pr li{padding:4px 0 12px;border-bottom:1px solid var(--b-line)}
      .csb-pr li p,.csb-pr-when{margin:4px 0}
      .csb-home{padding-top:8px;text-align:center}
      .csb-home h1 img{display:block;margin:0 auto;width:auto;max-width:100%;height:48px}
      .csb-home>p{margin:12px auto 0;max-width:36rem;font-size:16px;line-height:1.5}
      .csb-home>div{max-width:42rem;height:56px;margin:28px auto 0;border:1px solid var(--b-line);border-radius:16px}
      .csb-tabs{position:fixed;left:0;right:0;bottom:0;display:flex;padding-bottom:env(safe-area-inset-bottom);border-top:1px solid var(--b-line);background:var(--b-tab)}
      .csb .csb-tabs>*{display:flex;flex:1;min-height:60px;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:12px;font-weight:500;color:var(--b-mut)}
      .csb-tabs a[aria-current]{color:var(--b-acc)}
      .csb-tabs a[aria-current] .csb-ico{background:var(--b-acc);opacity:.9}
      @media (min-width:640px){.csb-top{padding:0 24px}.csb-crumb i{display:inline}.csb-page{padding:32px 24px 0}.csb-page h1{font-size:32px}.csb-home{padding-top:32px}.csb-home h1 img{height:64px}}
      @media (min-width:768px){.csb-side{display:flex}.csb-top>a,.csb-tabs{display:none}.csb-search{justify-content:center}.csb-search span{width:100%;max-width:28rem;height:36px;padding:0 12px;font-size:14px}}
      @media (min-width:1024px){.csb-top{padding:0 32px}.csb-page{padding:32px 32px 0}}
      @media (min-width:1700px){.csb-page{max-width:1600px}}
    </style>`;

interface Item { to: string; label: string; end?: boolean }
const SECTIONS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ to: "/", label: "Home", end: true }, { to: "/events", label: "Events" }, { to: "/teams", label: "Teams" }, { to: "/power-rankings", label: "Power rankings" }] },
  { title: "Predict", items: [{ to: "/predict", label: "Predict", end: true }, { to: "/compare", label: "Compare" }] },
  { title: "Yours", items: [{ to: "/my-team", label: "My team" }, { to: "/shortlist", label: "Shortlist" }, { to: "/scout", label: "Scout" }] },
  { title: null, items: [{ to: "/download", label: "Download" }, { to: "/methodology", label: "How it works" }, { to: "/settings", label: "Settings" }] },
];
const TABS: Item[] = [{ to: "/", label: "Home", end: true }, { to: "/events", label: "Events" }, { to: "/predict", label: "Predict" }, { to: "/my-team", label: "My team" }];

// Like react-router's NavLink: case-insensitive, a prefix at a segment boundary unless `end`.
const active = (path: string, it: Item) => {
  const p = path.toLowerCase();
  return p === it.to || (!it.end && p.startsWith(`${it.to}/`));
};
const link = (path: string, it: Item) =>
  `<a href="${it.to}"${active(path, it) ? ' aria-current="page"' : ""}><i class="csb-ico"></i><span>${esc(it.label)}</span></a>`;

/** The static first paint for a page path (see the top of this file). `path` is the request path. */
export function bootShell(path: string, meta: PageMeta): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  const home = p === "/";
  const nav = SECTIONS.map((s) => `<div class="csb-grp">${s.title ? `<p>${s.title}</p>` : ""}${s.items.map((it) => link(p, it)).join("")}</div>`).join("");
  // A page with no title of its own (not found) gets the shell alone.
  const page = home
    ? `<div class="csb-page csb-home" id="cs-boot-page" data-path="/"><h1><img src="/wordmark.png" alt="FTC Control Scout" width="1200" height="192" /></h1><p>${esc(meta.description)}</p><div></div></div>`
    : meta.title && !meta.notFound
      // A content page (power rankings) puts its words here in full, as already-safe HTML (PageMeta.bodyHtml).
      ? `<div class="csb-page" id="cs-boot-page" data-path="${esc(p)}"><h1>${esc(meta.title)}</h1>${meta.bodyHtml ? `<div class="csb-body">${meta.bodyHtml}</div>` : `<p>${esc(meta.description)}</p>`}</div>` : "";
  // The page block is hidden when the service worker served this HTML (made for "/") for another page offline.
  const guard = `<script>(function(){var b=document.getElementById('cs-boot-page'),p=location.pathname.replace(/\\/+$/,'')||'/';if(b&&b.getAttribute('data-path').toLowerCase()!==p.toLowerCase())b.hidden=true})()</script>`;
  return [
    `<div class="csb">`,
    `<aside class="csb-side"><a class="csb-brand" href="/" aria-label="Control Scout home"><img src="/logo.png" alt="" /><span>Control Scout</span></a><nav class="csb-nav" aria-label="Main">${nav}</nav></aside>`,
    `<div class="csb-col"><header class="csb-top"><a href="/" aria-label="Home"><img src="/logo.png" alt="" /></a><p class="csb-crumb"><i>Control Scout / </i><b>${esc(pageTitle(p))}</b></p>${home ? "" : `<div class="csb-search"><span>Search teams, events, matches…</span></div>`}</header>`,
    // A page with content in full scrolls (before the app loads, or with no JavaScript at all).
    `<main class="csb-main${meta.bodyHtml && page ? " csb-scroll" : ""}">${page}${guard}</main></div>`,
    `<nav class="csb-tabs" aria-label="Main">${TABS.map((it) => link(p, it)).join("")}<span><i class="csb-ico"></i><span>More</span></span></nav>`,
    `</div>`,
  ].join("");
}
