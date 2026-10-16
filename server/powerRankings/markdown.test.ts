// Authors write markdown, never HTML: nothing they type can run script or add markup of its own.
import { describe, expect, it } from "vitest";
import { markdownText, renderMarkdown, safeHref } from "./markdown";

describe("renderMarkdown", () => {
  it("renders the usual markdown", () => {
    expect(renderMarkdown("A *great* week for **4215**.")).toBe("<p>A <em>great</em> week for <strong>4215</strong>.</p>");
    expect(renderMarkdown("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(renderMarkdown("See [the team](/teams/4215).")).toBe('<p>See <a href="/teams/4215">the team</a>.</p>');
    expect(renderMarkdown("[FIRST](https://www.firstinspires.org)")).toBe('<p><a href="https://www.firstinspires.org" rel="noopener nofollow ugc" target="_blank">FIRST</a></p>');
    expect(renderMarkdown("### Big news")).toBe("<p><strong>Big news</strong></p>");
  });

  it("escapes raw HTML, block or inline: script, event handlers, iframes", () => {
    const vectors = [
      "<script>alert(1)</script>",
      "Hi <img src=x onerror=alert(1)> there",
      "<iframe src=\"https://evil.example\"></iframe>",
      "<a href=\"javascript:alert(1)\">x</a>",
      "<svg onload=alert(1)>",
      "<div style=\"background:url(javascript:alert(1))\">x</div>",
      "Text <b onmouseover=\"alert(1)\">bold</b>",
    ];
    for (const v of vectors) {
      const html = renderMarkdown(v);
      expect(html, v).not.toMatch(/<(script|img|iframe|svg|div|b|a)\b/i);
      expect(html, v).toContain("&lt;");
    }
  });

  it("drops unsafe link targets (the text stays), images become their alt text", () => {
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "//evil.example/x", "/\\evil.example", "&#106;avascript:alert(1)"]) {
      const html = renderMarkdown(`[click](${href})`);
      expect(html, href).not.toMatch(/<a\b/);
      expect(html, href).toContain("click");
    }
    expect(renderMarkdown("<javascript:alert(1)>")).not.toMatch(/<a\b/);
    expect(renderMarkdown("![a robot](https://example.com/x.png)")).toBe("<p>a robot</p>");
  });

  it("attribute values are escaped: a quote can't break out of href or title", () => {
    const html = renderMarkdown('[x](https://example.com/"onmouseover="alert(1) "t\\"itle")');
    expect(html).not.toMatch(/"\s*onmouseover=/);
    expect(renderMarkdown('[x](/teams/1 "a\\" onclick=\\"y")')).not.toMatch(/" onclick="/);
  });

  it("safeHref allows http(s), mailto and same-site paths only", () => {
    expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
    expect(safeHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeHref("/teams/4215")).toBe("/teams/4215");
    expect(safeHref("#top")).toBe("#top");
    for (const bad of ["javascript:x", "//x.example", "ftp://x", "relative/path", " https://x.example", "https:///x"]) expect(safeHref(bad), bad).toBeNull();
  });

  it("markdownText: plain text for descriptions", () => {
    expect(markdownText("A **big** week & a <b>tag</b>.\n\nTwo.")).toBe("A big week & a <b>tag</b>. Two.");
  });
});
