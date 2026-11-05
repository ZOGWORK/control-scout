// The search results guide's §11 checks (.claude/search-viz-guide-2026-11-05.txt) for any rendered answer card, as a
// list of problems (empty is a pass):
//   - lie factor: every bar is `[data-bar]` with its `data-value` and `data-scale`, drawn from zero, its length within
//     5% of value / scale (an unmarked bar is a problem, so no bar escapes the check);
//   - hue means team: data takes only the team tokens and, where they mark an alliance, red and blue; no status,
//     phase, palette or gold colour on data (gold only on the primary button, a play button's red only on its button);
//     at most 3 hues on a card;
//   - print once: each team name once, and no heading, headline, context or scope line said twice;
//   - no meta or debug text, no number glued to a word in a heading;
//   - contrast: every piece of text at 4.5:1 on its surface in Light, Dim, Dark and Midnight.
import { measure, type Theme } from "../../../lib/themeTokens.testkit";

const THEMES: Theme[] = ["light", "dim", "dark", "midnight"];
const NEUTRAL = new Set(["foreground", "muted", "muted-foreground", "background", "card", "card-foreground", "border", "line", "primary", "secondary",
  "input", "ring", "popover", "popover-foreground", "elevated", "transparent", "current", "inherit", "text-base", "text-muted", "scrollbar", "scrollbar-hover"]);
const TEAM = /^team-[abc]$/;
const ALLIANCE = /^(red|blue)-alliance(-text|-ink)?$/;
const GOLD = /^(accent|accent-[a-z]+|amber|yellow|warning|warning-text)$/;
// A video control: its red play mark, and white or black over the picture.
const PLAY = /^(video|video-fill|white|black)$/;
const META = [/read as/i, /\bdebug\b/i, /\bTODO\b/, /\braw\b/i, /undefined/, /\bNaN\b/, /\[object/, /\bnull\b/, /\[relaxed/i];

/** A class's colour family ("team-a", "sky", "foreground"), or null when it isn't a colour class. Resting state only. */
function colourOf(cls: string): string | null {
  const util = cls.slice(cls.lastIndexOf(":") + 1);
  const variant = cls.includes(":") ? cls.slice(0, cls.lastIndexOf(":")) : "";
  if (variant && variant !== "dark" && !variant.startsWith("max-") && !/^(sm|md|lg|xl)$/.test(variant)) return null;
  const m = /^!?(?:text|bg|border|border-[trblxy]|ring|fill|stroke|from|to|via|decoration|outline|divide)-([a-z]+(?:-[a-z]+)*?)(?:-\d{2,3})?(?:\/(?:\d+|\[[\d.%]+\]))?$/.exec(util);
  // Sizes and styles share the prefixes (text-sm, border-t, ring-inset, text-right): not colours.
  if (!m || /^(x|y|t|b|l|r|s|e|solid|dashed|dotted|double|none|collapse|separate|xs|sm|base|lg|xl|left|right|center|justify|start|end|wrap|nowrap|balance|pretty|clip|ellipsis|inset|offset|opacity)$/.test(m[1])) return null;
  return m[1];
}

/** An element's text nodes, trimmed, empty ones left out (separate elements are laid out apart). */
function texts(el: Element): string[] {
  const out: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const t = n.textContent!.trim(); if (t) out.push(t); }
  return out;
}

/** The rendered card's problems against the guide. `names`: team names that must be printed exactly once. */
export function auditAnswer(card: HTMLElement, { names = [] as string[], contrast = true } = {}): string[] {
  const problems: string[] = [];
  const text = card.textContent ?? "";

  // Lie factor, and no unmarked bar: anything drawn with a width or height in % on a fill is a bar.
  for (const el of card.querySelectorAll<HTMLElement>("*")) {
    const w = el.style.width || el.style.height;
    const fill = [...el.classList].some((c) => /^bg-/.test(c.slice(c.lastIndexOf(":") + 1)));
    if (!el.hasAttribute("data-bar")) { if (w.includes("%") && fill) problems.push(`unmarked bar: ${el.className}`); continue; }
    const v = Number(el.dataset.value), max = Number(el.dataset.scale), pc = /^[\d.]+%$/.test(w) ? Number.parseFloat(w) : NaN;
    if (Number.isNaN(pc)) { problems.push(`bar length not a plain percent: ${w}`); continue; }
    if (!Number.isFinite(v) || !Number.isFinite(max) || max <= 0) { problems.push(`bar without value/scale: ${el.outerHTML.slice(0, 80)}`); continue; }
    if (el.style.left || el.style.marginLeft || el.style.insetInlineStart) problems.push(`bar not from zero: ${el.outerHTML.slice(0, 80)}`);
    if (v <= 0) continue;
    const lf = pc / 100 / (v / max);
    if (Math.abs(lf - 1) > 0.05) problems.push(`lie factor ${lf.toFixed(2)} (value ${v} of ${max} drawn ${pc}%)`);
  }

  // Hue.
  const hues = new Set<string>();
  for (const el of card.querySelectorAll<HTMLElement | SVGElement>("*")) {
    const cls = el.getAttribute("class") ?? "";
    for (const c of cls.split(/\s+/).filter(Boolean)) {
      const f = colourOf(c);
      if (!f || NEUTRAL.has(f)) continue;
      if (TEAM.test(f) || ALLIANCE.test(f)) { hues.add(f.replace(/-(text|ink)$/, "")); continue; }
      if (GOLD.test(f) && el.closest("button, [data-primary-cta]")) continue;
      if (PLAY.test(f) && el.closest("button, a, [data-answer-video]")) continue;
      problems.push(`${GOLD.test(f) ? "gold" : "hue"} on data: ${c} (${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}")`);
    }
    for (const attr of ["fill", "stroke", "color"]) {
      const v = el.getAttribute(attr);
      // A pattern (`url(#grid)`) is drawn in its own classes' colour, checked with them.
      if (v && !/^(none|currentColor|transparent|url\(#[\w-]+\)|var\(--color-(foreground|muted-foreground|border|line|team-[abc]|(red|blue)-alliance)\))$/.test(v)) problems.push(`hue on data: ${attr}="${v}"`);
    }
    const st = (el as HTMLElement).style;
    for (const v of [st?.color, st?.backgroundColor, st?.background, st?.fill].filter(Boolean)) {
      if (!/var\(--color-(foreground|muted-foreground|border|team-[abc]|(red|blue)-alliance)\)/.test(v!)) problems.push(`hue on data: style ${v}`);
    }
  }
  if (hues.size > 3) problems.push(`${hues.size} hues: ${[...hues].join(", ")}`);

  // Print once.
  for (const n of names) { const k = text.split(n).length - 1; if (k !== 1) problems.push(`${n} printed ${k} times`); }
  const lines = [...card.querySelectorAll("h1, h2, h3, h4, figcaption, [data-headline], [data-context], [data-scope] > *, [data-source]")]
    .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim()).filter((t) => t.length > 3);
  for (const [i, t] of lines.entries()) if (lines.indexOf(t) !== i) problems.push(`said twice: "${t}"`);
  const ctas = card.querySelectorAll("[data-primary-cta]").length;
  if (ctas > 1) problems.push(`${ctas} primary actions`);

  // Meta text, glued headings ("157.9leads"; an ordinal like "2nd" is a word).
  for (const bad of META) if (bad.test(text)) problems.push(`meta text ${bad}`);
  for (const h of card.querySelectorAll("h1, h2, h3, h4, [data-headline], figcaption")) {
    for (const t of texts(h)) if (/\d[a-z]/i.test(t.replace(/\b\d+(st|nd|rd|th)\b/gi, ""))) problems.push(`glued heading: ${t}`);
  }

  // Contrast: each text node's colour (its nearest set one) on its nearest tint over the card.
  if (contrast) {
    const seen = new Set<string>();
    for (const el of card.querySelectorAll<HTMLElement>("*")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!own || el.closest(".sr-only, [aria-hidden=true], [hidden]")) continue;
      const near = (test: (c: string) => boolean) => { for (let e: Element | null = el; e && e !== card.parentElement; e = e.parentElement) { const c = [...e.classList].filter(test); if (c.length) return c.join(" "); } return ""; };
      const fg = near((c) => { const f = colourOf(c); return !!f && /(^|:)!?text-/.test(c); });
      const bg = near((c) => { const f = colourOf(c); return !!f && /(^|:)bg-/.test(c) && f !== "transparent"; });
      const fade = near((c) => /^opacity-\d+$/.test(c));
      const classes = `${fg} ${bg} ${fade}`.trim();
      if (seen.has(classes)) continue;
      seen.add(classes);
      for (const theme of THEMES) {
        let m: { ratio: number; pair: string };
        try { m = measure(theme, classes); } catch (e) { problems.push(`contrast: ${(e as Error).message}`); break; }
        if (m.ratio < 4.5) { problems.push(`contrast ${theme}: "${el.textContent!.trim().slice(0, 30)}" ${classes} ${m.pair}`); break; }
      }
    }
  }
  return problems;
}
