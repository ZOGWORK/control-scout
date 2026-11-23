// Card morph: a tapped card lifts off its list and grows from its exact spot into the page it opens, its title gliding to
// the page's title; Back shrinks the page into the card again. The one smooth page change besides Home's search glide
// (src/components/search/glide.ts): every other navigation still cuts.
//
// How (shared-element, the layoutId idea done by hand across two routes, since the pages are separate lazy routes):
// - On the tap, before the route changes, the card's box and its title are measured and drawn again as a fixed layer
//   over the page (a surface and a copy of the title). The surface is placed at its END box (the content area) and
//   started with the transform that puts it back on the card, then let go to no transform: FLIP. Only transform and
//   opacity ever animate, so the browser runs it on the compositor with no layout work per frame.
// - The page's title (useMorphTarget) is found as soon as the new page draws it; the title copy flies from the card's
//   title to it (translate + one scale, the ratio of the two font sizes), then the layer fades out while the page's
//   content fades in under it.
// - Leaving the page while it is the morph's landing records where its title sat; when Back draws the list again, the
//   card (useMorphCard) waits for the scroll to be put back, then the same layer runs the other way.
// Reduced motion, no Web Animations, or anything missing (the page never draws its title, the card is off screen): the
// plain cut. The layer can never stay up: every run ends on a timer at the latest, and the page is always shown again.
import { animate } from "motion/mini";
import { HEADER_ID } from "./pageScroll";

/** One run, end to end: the brief's 250–350 ms, no bounce. */
export const MORPH_MS = 300;
/** The iOS sheet curve: quick to leave, long smooth settle, no snap at the start. Movement across the screen reads
 *  better on it than on v8's front-loaded entrance curve (0.23, 1, 0.32, 1), which covers most of the way in a frame or two. */
export const MORPH_EASE = [0.32, 0.72, 0, 1] as const;
/** The longest the layer waits for the new page to draw its title before it fades away without the title flight. */
export const MORPH_WAIT_MS = 900;
/** How long after leaving a page Back may still shrink it into its card. */
export const RETURN_WINDOW_MS = 4000;

const FADE_MS = 140;

type Box = { x: number; y: number; w: number; h: number };
type TitleSnap = { box: Box; text: string; style: Partial<CSSStyleDeclaration> };
type Landed = { key: string; at: number; scroll: number };
type Leaving = { key: string; title: TitleSnap; content: Box; at: number; scroll: number };

let landed: Landed | null = null;
/** Slow motion for review (/preview/morph's switch): every duration and wait is multiplied by this. */
let speed = 1;
export const morphSpeed = () => speed;
export function setMorphSpeed(x: number) { speed = x > 0 && Number.isFinite(x) ? x : 1; }
let leaving: Leaving | null = null;
let running: (() => void) | null = null;

/** For tests: forget every run. */
export function resetMorphForTests() { running?.(); landed = null; leaving = null; }

export function morphAllowed(): boolean {
  if (typeof window === "undefined" || typeof Element === "undefined") return false;
  if (typeof Element.prototype.animate !== "function") return false;
  try { if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false; } catch { /* no matchMedia: allowed */ }
  return true;
}

const scrollY = () => document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const onScreen = (b: Box) => b.w > 0 && b.h > 0 && b.y + b.h > 0 && b.y < window.innerHeight && b.x + b.w > 0 && b.x < window.innerWidth;

/** The page's content area as it shows on screen: the content column, from the top bar down to the phone's tab bar
 *  (Shell.tsx, which stays in front of the page) or the screen's bottom. */
function contentBox(): Box {
  const main = document.getElementById("main");
  const r = main?.getBoundingClientRect();
  const top = Math.max(r?.top ?? 0, headerBottom());
  const left = r ? Math.max(0, r.left) : 0;
  const right = r ? Math.min(window.innerWidth, r.right) : window.innerWidth;
  const bar = document.querySelector("[data-tab-bar]")?.getBoundingClientRect();
  const bottom = bar && bar.height > 0 && bar.top < window.innerHeight ? bar.top : window.innerHeight;
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}
function headerBottom(): number {
  const h = document.getElementById(HEADER_ID);
  const b = h?.getBoundingClientRect().bottom ?? 0;
  return b > 0 && b < window.innerHeight / 2 ? b : 0;
}

const TEXT_KEYS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color"] as const;
function snapTitle(el: HTMLElement): TitleSnap {
  const cs = getComputedStyle(el);
  const style: Partial<CSSStyleDeclaration> = {};
  for (const k of TEXT_KEYS) (style as Record<string, string>)[k] = cs[k];
  return { box: boxOf(el), text: el.textContent ?? "", style };
}
const fontPx = (s: TitleSnap) => parseFloat(s.style.fontSize ?? "") || s.box.h || 1;

/** The fixed layer drawn over the page while a run is on. */
function layer(contentFrom: Box, title: TitleSnap) {
  const root = document.createElement("div");
  root.setAttribute("data-card-morph", "");
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "60", pointerEvents: "none", contain: "strict" });
  const surface = document.createElement("div");
  surface.setAttribute("data-morph-surface", "");
  Object.assign(surface.style, { position: "absolute", transformOrigin: "0 0", willChange: "transform", borderRadius: "12px", overflow: "hidden", boxShadow: "0 12px 32px rgb(0 0 0 / 0.28)" });
  // Two coats, cross-faded (opacity only): the card's own surface becomes the page's background.
  const cardCoat = document.createElement("div");
  cardCoat.className = "absolute inset-0 border border-line bg-card";
  cardCoat.style.borderRadius = "inherit";
  const pageCoat = document.createElement("div");
  pageCoat.className = "absolute inset-0 bg-background";
  surface.append(pageCoat, cardCoat);
  const copy = document.createElement("div");
  copy.setAttribute("data-morph-title", "");
  copy.textContent = title.text;
  Object.assign(copy.style, title.style, {
    position: "absolute", left: `${title.box.x}px`, top: `${title.box.y}px`, width: `${title.box.w}px`,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transformOrigin: "0 0", willChange: "transform", margin: "0",
  });
  root.append(surface, copy);
  document.body.append(root);
  const place = (b: Box) => Object.assign(surface.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
  place(contentFrom);
  return { root, surface, cardCoat, pageCoat, copy, place };
}

/** The transform that draws box `to`'s element over box `from` (origin top left). */
const flip = (from: Box, to: Box) => `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`;
const fly = (from: TitleSnap, to: TitleSnap) => `translate(${to.box.x - from.box.x}px, ${to.box.y - from.box.y}px) scale(${fontPx(to) / fontPx(from)})`;

const opts = (ms = MORPH_MS) => ({ duration: (ms * speed) / 1000, ease: [...MORPH_EASE] as [number, number, number, number] });
const done = (a: { finished?: Promise<unknown> } | PromiseLike<unknown>) => ("finished" in a && a.finished ? a.finished : Promise.resolve(a as PromiseLike<unknown>)).then(() => {}, () => {});

function main(): HTMLElement | null { return document.getElementById("main"); }

/** Waits (frames, then timers when frames are held) until `get` gives something, or `ms` runs out. */
function waitFor<T>(get: () => T | null, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const end = performance.now() + ms;
    const tick = () => {
      const v = get();
      if (v || performance.now() > end) return resolve(v);
      setTimeout(tick, 16);
    };
    tick();
  });
}

/** The title on the page a morph is landing on (useMorphTarget marks it). */
const targetTitle = (key: string) => document.querySelector<HTMLElement>(`[data-morph-target="${CSS.escape(key)}"]`);

/** After the browser has painted the frame being built now (a frame callback runs before the paint, a timer after it). */
const afterPaint = (fn: () => void) => requestAnimationFrame(() => setTimeout(fn, 0));

/**
 * Starts the forward run from `card` on the tap, and changes the page by calling `go` once the layer's first frame is on
 * screen: the route's render then happens under the growing card while the browser runs the animation off the main
 * thread (transform and opacity only). Returns false when it won't run: the caller lets the link cut as usual.
 * The card's title is its `[data-morph-title]` element.
 */
export function launchMorph(card: HTMLElement, key: string, go: () => void): boolean {
  if (!morphAllowed()) return false;
  const titleEl = card.querySelector<HTMLElement>("[data-morph-title]");
  if (!titleEl) return false;
  const from = boxOf(card);
  if (!onScreen(from)) return false;
  running?.();
  const fromTitle = snapTitle(titleEl);
  const listScroll = scrollY();
  const to = contentBox();
  const l = layer(to, fromTitle);
  const page = main();
  const pageAnim: { stop?: () => void } = {};
  let over = false;
  let went = false;
  const leave = () => { if (went) return; went = true; if (page) page.style.opacity = "0"; go(); };
  const finish = () => {
    if (over) return;
    over = true;
    leave(); // whatever happened, the tap still opens its page
    l.root.remove();
    if (page) { page.style.opacity = ""; pageAnim.stop?.(); }
    if (running === finish) running = null;
  };
  running = finish;
  // The card lifts: the surface is drawn over it, and grows to the content area.
  const grow = animate(l.surface, { transform: [flip(from, to), "none"] }, opts());
  animate(l.cardCoat, { opacity: [1, 0] }, opts());
  const started = performance.now();
  const hardStop = setTimeout(finish, (MORPH_MS + MORPH_WAIT_MS) * speed + 600);
  // The title rides the growing card toward where a page's title sits (its own offset in the card, kept within the
  // page's margins), so it is already on its way while the page draws; the last hop lands it on the real title.
  const ride = `translate(${to.x + Math.min(fromTitle.box.x - from.x, 32) - fromTitle.box.x}px, ${to.y + Math.min(fromTitle.box.y - from.y, 64) - fromTitle.box.y}px)`;
  const riding = animate(l.copy, { transform: ["none", ride] }, opts());
  afterPaint(leave);
  void (async () => {
    const target = await waitFor(() => (went ? targetTitle(key) : null), (MORPH_MS + MORPH_WAIT_MS) * speed);
    if (over) return;
    if (target) {
      // From wherever the copy is now to the page's title, in the time the surface has left (never under 160 ms).
      const now = getComputedStyle(l.copy).transform;
      riding.stop?.();
      const toTitle = snapTitle(target);
      const left = Math.max(160, MORPH_MS - (performance.now() - started) / speed);
      await done(animate(l.copy, { transform: [now && now !== "none" ? now : "none", fly(fromTitle, toTitle)] }, opts(left)));
      landed = { key, at: Date.now(), scroll: listScroll };
    }
    await done(grow);
    if (over) return;
    // Landed: the page's own content (its title among it, where the copy now sits) fades in as the layer goes.
    if (page) { const a = animate(page, { opacity: [0, 1] }, opts(FADE_MS)); pageAnim.stop = () => a.stop?.(); }
    await done(animate(l.root, { opacity: [1, 0] }, opts(FADE_MS)));
    clearTimeout(hardStop);
    finish();
  })();
  return true;
}

/** The page side, on its way out: remembers where its title sat so Back can shrink it into the card. */
export function noteLeaving(key: string, title: HTMLElement | null) {
  const l0 = landed;
  if (!title || !l0 || l0.key !== key) return;
  landed = null;
  if (!morphAllowed()) return;
  const snap = snapTitle(title);
  if (!onScreen(snap.box)) return; // scrolled down the page: the cut on the way back, nothing to glide from
  leaving = { key, title: snap, content: contentBox(), at: Date.now(), scroll: l0.scroll };
}

/** The list side, once its card for `key` is drawn after Back: runs the shrink if this card is the one left. */
export function maybeReturn(key: string, card: () => HTMLElement | null): boolean {
  const l0 = leaving;
  if (!l0 || l0.key !== key || Date.now() - l0.at > RETURN_WINDOW_MS) return false;
  leaving = null;
  if (!morphAllowed()) return false;
  running?.();
  const l = layer(l0.content, l0.title);
  let over = false;
  let hidden: HTMLElement | null = null;
  const finish = () => {
    if (over) return;
    over = true;
    l.root.remove();
    if (hidden) hidden.style.visibility = "";
    if (running === finish) running = null;
  };
  running = finish;
  l.cardCoat.style.opacity = "0";
  const hardStop = setTimeout(finish, MORPH_MS * speed + 1400);
  void (async () => {
    // The list puts its scroll back first (src/lib/pageScroll.ts, once its data has drawn): wait for the place it was
    // left at, so the card is measured where it will stay.
    const el = await waitFor(() => (Math.abs(scrollY() - l0.scroll) < 2 ? card() : null), 1000);
    if (over) return;
    const titleEl = el?.querySelector<HTMLElement>("[data-morph-title]");
    const to = el ? boxOf(el) : null;
    if (!el || !titleEl || !to || !onScreen(to)) { await done(animate(l.root, { opacity: [1, 0] }, opts(FADE_MS))); clearTimeout(hardStop); finish(); return; }
    hidden = el;
    el.style.visibility = "hidden";
    const toTitle = snapTitle(titleEl);
    // The surface sits at the card's box and starts drawn over the page's content area, then lets go: FLIP again.
    l.place(to);
    const shrink = animate(l.surface, { transform: [flip(l0.content, to), "none"] }, opts());
    animate(l.cardCoat, { opacity: [0, 1] }, opts());
    animate(l.pageCoat, { opacity: [1, 0] }, opts());
    animate(l.copy, { transform: ["none", fly(l0.title, toTitle)] }, opts());
    await done(shrink);
    if (over) return;
    if (hidden) hidden.style.visibility = "";
    await done(animate(l.root, { opacity: [1, 0] }, opts(90)));
    clearTimeout(hardStop);
    finish();
  })();
  return true;
}
