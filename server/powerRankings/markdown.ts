// Markdown → HTML for power-rankings blurbs and intros, on the server only (the app gets
// finished HTML, so no markdown library ships to the browser). Authors write markdown,
// never HTML: any raw HTML they type is escaped and shows as text, links may only go to
// http(s), mailto, or a path on this site, and images become their alt text. The output
// is therefore only tags marked itself writes (p, em, strong, a, lists, code…).
import { Marked, type Tokens } from "marked";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A link target authors may use: http(s), mailto, or a same-site path ("/teams/4215", "#x"). Anything else: null. */
export function safeHref(href: string): string | null {
  // Control characters and whitespace are what browsers strip to find a scheme ("java\tscript:"): never allowed.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(href)) return null;
  return /^(https?:\/\/[^/]|mailto:|\/(?![/\\])|#)/i.test(href) ? href : null;
}

const md = new Marked({ gfm: true, breaks: false, async: false });
md.use({
  renderer: {
    // Raw HTML in the source (a block or an inline tag): shown as the text it is, never as markup.
    html({ text }: Tokens.HTML | Tokens.Tag) { return esc(text); },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return text;
      const external = /^https?:\/\//i.test(safe);
      return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ""}${external ? ' rel="noopener nofollow ugc" target="_blank"' : ""}>${text}</a>`;
    },
    // No images in blurbs: the alt text stands in.
    image({ text }: Tokens.Image) { return esc(text); },
    // Headings would compete with the page's own (and "## " starts the next entry): bold text instead.
    heading({ tokens }: Tokens.Heading) { return `<p><strong>${this.parser.parseInline(tokens)}</strong></p>\n`; },
  },
});

/** A blurb or intro as safe HTML. */
export function renderMarkdown(src: string): string {
  return (md.parse(src) as string).trim();
}

/** The plain text of some markdown (descriptions, share text): no markup, entities decoded, spaces collapsed. */
export function markdownText(src: string): string {
  return renderMarkdown(src)
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
