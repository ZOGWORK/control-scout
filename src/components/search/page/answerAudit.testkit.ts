// The search results guide's §11 checks (.claude/search-viz-guide-2026-11-05.txt) for any rendered answer card, as a
// list of problems (empty is a pass):
//   - lie factor: every bar is `[data-bar]` with its `data-value` and `data-scale`, drawn from zero, its length within
//     5% of value / scale (an unmarked bar is a problem, so no bar escapes the check);
//   - colour (the owner's brief, 11-06, over the guide's "hue means team"): data takes search's one palette (lib/
//     textTones SEARCH_PALETTE: each meaning its own family), the team tokens, and red and blue where they mark an
//     alliance; nothing else, no gold (yellow is ranking points' alone; gold only on the marked primary action, a
//     video's red, white and black only on the player or a marked video control); no two meanings sharing a hue on
//     a card (team B's orange beside the Winning Alliance's, team C's green beside TeleOp's); a card about one team
//     in team A, never B or C; no data visual (a bar, a line, a tile, a pill, a chip, a line's icon or words) all
//     grey; and no card without a single hue (the count card that shipped all grey, 3.6.5);
//   - print once: each team name once, and no heading, headline, context or scope line said twice; a scope note (a
//     relaxed time, "No 2026–27 matches yet …; showing 2025–26") nowhere else on the card, its method included;
//   - no meta or debug text, no number glued to a word in a heading;
//   - contrast: every visible piece of text (aria-hidden included: it's still seen) at 4.5:1 on its surface, every
//     tint from the card in blended in, in Light, Dim, Dark and Midnight.
import { contrast as ratio, over, toHex, type RGBA } from "../../../lib/contrast";
import { utility, value, type Theme } from "../../../lib/themeTokens.testkit";
import { SEARCH_PALETTE } from "../../../lib/textTones";

const THEMES: Theme[] = ["light", "dim", "dark", "midnight"];
const NEUTRAL = new Set(["foreground", "muted", "muted-foreground", "background", "card", "card-foreground", "border", "line", "primary", "secondary",
  "input", "ring", "popover", "popover-foreground", "elevated", "transparent", "current", "inherit", "white", "black", "text-base", "text-muted", "scrollbar", "scrollbar-hover"]);
const TEAM = /^team-[abc](-text)?$/;
const ALLIANCE = /^(red|blue)-alliance(-text|-ink)?$/;
// Amber is the palette's Count (a how-many's number), checked with it.
const GOLD = /^(accent|accent-[a-z]+|yellow|warning|warning-text)$/;
// A video control: its red play mark, and white or black over the picture.
const PLAY = /^(video|video-fill|white|black)$/;
// Search's palette: one family per meaning (an award, a phase, a status).
const PALETTE = new Set<string>(Object.values(SEARCH_PALETTE).map((s) => s.family));
// Hues a reader can't tell apart, two meanings each: never both on one card.
const ALIKE: [string, string][] = [["team-b", "orange"], ["team-c", "emerald"], ["team-c", "teal"], ["team-a", "cyan"], ["team-a", "sky"], ["sky", "cyan"], ["sky", "blue"], ["info", "sky"], ["info", "blue"], ["info", "team-a"],
  ["amber", "yellow"], ["amber", "orange"], ["team-b", "amber"]];
// Every data visual: none may be all grey.
const VISUAL = "[data-bar], [data-kpi], [data-phase], [data-rank-pill], [data-rank-badge], [data-award], [data-pill], [data-bar-value], [data-node], [data-block=series] polyline, [data-timeline] polyline, [data-line-icon], [data-line-text], [data-none]";
const META = [/read as/i, /\bdebug\b/i, /\bTODO\b/, /\braw\b/i, /undefined/, /\bNaN\b/, /\[object/, /\bnull\b/, /\[relaxed/i];

/** A class's colour family ("team-a", "sky", "foreground"), or null when it isn't a colour class. Resting state only. */
function colourOf(cls: string): string | null {
  const util = cls.slice(cls.lastIndexOf(":") + 1);
  const variant = cls.includes(":") ? cls.slice(0, cls.lastIndexOf(":")) : "";
  if (variant && variant !== "dark" && !variant.startsWith("max-") && !/^(sm|md|lg|xl)$/.test(variant)) return null;
  const m = /^!?(?:text|bg|border-[trblxy]|border|ring|fill|stroke|from|to|via|decoration|outline|divide)-([a-z]+(?:-[a-z]+)*?)(?:-\d{2,3})?(?:\/(?:\d+|\[[\d.%]+\]))?$/.exec(util);
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

/** The rendered card's problems against the guide. `names`: team names that must be printed exactly once. `one`: the
 *  card is about one team, so team A is its only hue (B and C mean a second and third team). `whole`: a whole card,
 *  which must have a hue somewhere (off for a fragment). */
export function auditAnswer(card: HTMLElement, { names = [] as string[], contrast = true, one = false, whole = true } = {}): string[] {
  const problems: string[] = [];
  const text = card.textContent ?? "";

  // Lie factor, and no unmarked bar: anything drawn with a width or height in % on a fill is a bar.
  for (const el of card.querySelectorAll<HTMLElement>("*")) {
    const w = el.style.width || el.style.height;
    const fill = [...el.classList].some((c) => /^bg-/.test(c.slice(c.lastIndexOf(":") + 1)));
    if (!el.hasAttribute("data-bar")) { if (w.includes("%") && fill) problems.push(`unmarked bar: ${el.className}`); continue; }
    const v = Number(el.dataset.value), max = Number(el.dataset.scale), pc = /^[\d.]+%$/.test(w) ? Number.parseFloat(w) : NaN;
    if (Number.isNaN(pc)) { problems.push(`bar length not a plain percent: ${w}`); continue; }
    // An empty value reads as 0 through Number(): it must be said, not defaulted.
    if (!el.dataset.value?.trim() || !el.dataset.scale?.trim() || !Number.isFinite(v) || !Number.isFinite(max) || max <= 0) { problems.push(`bar without value/scale: ${el.outerHTML.slice(0, 80)}`); continue; }
    if (el.style.left || el.style.marginLeft || el.style.insetInlineStart) problems.push(`bar not from zero: ${el.outerHTML.slice(0, 80)}`);
    // Zero or below draws nothing.
    if (v <= 0) { if (pc > 0) problems.push(`bar for ${v} drawn ${pc}%`); continue; }
    const lf = pc / 100 / (v / max);
    if (Math.abs(lf - 1) > 0.05) problems.push(`lie factor ${lf.toFixed(2)} (value ${v} of ${max} drawn ${pc}%)`);
  }

  // Hue.
  const hues = new Set<string>();
  // The card itself too: a colour set on it (a tinted article) is the card's.
  for (const el of [card, ...card.querySelectorAll<HTMLElement | SVGElement>("*")]) {
    // A team card's season-at-a-glance tiles keep their own number colours (textTones GLANCE_TONE, the owner's ask);
    // their contrast is still checked below.
    if (el.closest("[data-season-tiles]")) continue;
    const cls = el.getAttribute("class") ?? "";
    for (const c of cls.split(/\s+/).filter(Boolean)) {
      const f = colourOf(c);
      if (!f || NEUTRAL.has(f)) continue;
      if (TEAM.test(f) || ALLIANCE.test(f)) { hues.add(f.replace(/-(text|ink)$/, "")); continue; }
      if (GOLD.test(f) && el.closest("[data-primary-cta]")) continue;
      if (PLAY.test(f) && el.closest("[data-answer-video], [data-video-control]")) continue;
      // A note's small info icon (a match box's penalties tile) marks a note, not a meaning: its blue never stands for
      // data, so it isn't one of the card's hues.
      if (f === "info" && el.hasAttribute("data-note-icon")) continue;
      // A palette family's deeper text shade (info-text) is that family.
      if (PALETTE.has(f.replace(/-text$/, ""))) { hues.add(f.replace(/-text$/, "")); continue; }
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
  for (const [x, y] of ALIKE) if (hues.has(x) && hues.has(y)) problems.push(`two meanings in one hue: ${x} and ${y}`);
  const coloured = (el: Element) => [el, ...el.querySelectorAll("*")].some((e) => (e.getAttribute("class") ?? "").split(/\s+/).some((c) => { const f = colourOf(c); return !!f && !NEUTRAL.has(f); }));
  for (const el of card.querySelectorAll(VISUAL)) if (!coloured(el)) problems.push(`grey data visual: ${el.tagName.toLowerCase()} "${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}"`);
  if (one) for (const h of hues) if (/^team-[bc]$/.test(h)) problems.push(`one team's card in ${h}`);
  if (whole && !hues.size) problems.push("grey card: no palette or team colour anywhere");

  // Print once.
  for (const n of names) { const k = text.split(n).length - 1; if (k !== 1) problems.push(`${n} printed ${k} times`); }
  const lines = [...card.querySelectorAll("h1, h2, h3, h4, figcaption, [data-headline], [data-context], [data-scope] > *, [data-source]")]
    .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim()).filter((t) => t.length > 3);
  for (const [i, t] of lines.entries()) if (lines.indexOf(t) !== i) problems.push(`said twice: "${t}"`);
  for (const chip of card.querySelectorAll("[data-scope] > *")) {
    const note = (chip.textContent ?? "").replace(/\s+/g, " ").trim();
    const first = note.split(";")[0].trim();
    if (note.length > 12 && text.split(first).length - 1 > 1) problems.push(`scope note said again: "${first}"`);
  }
  const ctas = card.querySelectorAll("[data-primary-cta]").length;
  if (ctas > 1) problems.push(`${ctas} primary actions`);

  // Meta text, glued headings ("157.9leads"; an ordinal like "2nd" is a word).
  for (const bad of META) if (bad.test(text)) problems.push(`meta text ${bad}`);
  for (const h of card.querySelectorAll("h1, h2, h3, h4, [data-headline], figcaption")) {
    for (const t of texts(h)) if (/\d[a-z]/i.test(t.replace(/\b\d+(st|nd|rd|th)\b/gi, ""))) problems.push(`glued heading: ${t}`);
  }

  // Contrast: each visible text node's colour (its nearest set one, faded by every opacity above it) on every tint
  // from the card down to it, blended in order.
  if (contrast) {
    const seen = new Set<string>();
    for (const el of card.querySelectorAll<HTMLElement>("*")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!own || el.closest(".sr-only, [hidden]")) continue;
      const chain: Element[] = [];
      for (let e: Element | null = el; e && e !== card.parentElement; e = e.parentElement) chain.unshift(e);
      const classesOf = (e: Element, test: RegExp) => [...e.classList].filter((c) => test.test(c) && !!colourOf(c)).join(" ");
      const fgOwner = [...chain].reverse().find((e) => classesOf(e, /(^|:)!?text-/));
      const fgClasses = fgOwner ? classesOf(fgOwner, /(^|:)!?text-/) : "";
      const layers = chain.map((e) => classesOf(e, /(^|:)bg-/)).filter(Boolean);
      const fade = chain.reduce((a, e) => { const m = [...e.classList].map((c) => /^opacity-(\d+)$/.exec(c)).find(Boolean); return m ? a * (+m[1] / 100) : a; }, 1);
      const key = `${fgClasses}|${layers.join("|")}|${fade}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const theme of THEMES) {
        try {
          let bg: RGBA = value(theme, "--color-card");
          for (const l of layers) { const tint = utility(theme, l, "bg"); if (tint) bg = over(tint, bg); }
          const c = utility(theme, fgClasses, "text") ?? value(theme, "--color-foreground");
          const fg: RGBA = [c[0], c[1], c[2], c[3] * fade];
          const r = ratio(over(fg, bg), bg);
          if (r < 4.5) { problems.push(`contrast ${theme}: "${el.textContent!.trim().slice(0, 30)}" ${fgClasses} on ${layers.join(" > ") || "card"}${fade < 1 ? ` at ${fade}` : ""}: ${toHex(over(fg, bg))} on ${toHex(bg)} = ${r.toFixed(2)}`); break; }
        } catch (e) { problems.push(`contrast: ${(e as Error).message}`); break; }
      }
    }
  }
  return problems;
}
