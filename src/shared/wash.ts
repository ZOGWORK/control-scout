// The v8 wash (src/components/layout/Wash.tsx; the first paint's copy in server/bootShell.ts): the soft colour band
// across the top of every page, and the glow at the end of a long page (PageEndGlow.tsx). The owner can change both in
// the console's Appearance tab (server/wash.ts, owner_settings key "wash"): three top colours (left, middle, right),
// three glow colours, a brightness and a spread, or one of the ready-made WASH_PRESETS. Shared by the server (validation, the first
// paint's <style>) and the app (the console's live preview), so both turn the same settings into the same CSS.

export interface WashSettings {
  /** Left, middle and right colours, as #rrggbb (lower case). */
  a: string;
  b: string;
  c: string;
  /** The page-end glow's left, middle and right colours, as #rrggbb. A wash saved before the glow could be chosen
   *  has none: parseWash fills in the defaults. */
  ga: string;
  gb: string;
  gc: string;
  /** 0.3–1.6. Up to 1 it is the wash's opacity; above 1 the opacity stays full and the colours get brighter. */
  strength: number;
  /** 0.6–1.6: how far down the wash reaches (1 = the default height). */
  spread: number;
}

/** What /api/wash answers: the settings in use, and whether they are the owner's (false: the defaults). */
export interface WashResponse { wash: WashSettings; custom: boolean }

/** The owner console's view: the settings in use, the defaults, and who saved them last. */
export interface OwnerWash extends WashResponse { defaults: WashSettings; updatedAt: string | null; updatedBy: string | null }

/** The defaults, as in src/index.css (html[data-v8]). */
export const DEFAULT_WASH: Readonly<WashSettings> = Object.freeze({ a: "#5a76ad", b: "#5f5785", c: "#91689c", ga: "#be6937", gb: "#795fa7", gc: "#556496", strength: 1, spread: 1 });

/** Ready-made gradients for the console's Appearance tab: the default (Dusk) and five more, each a top wash and a
 *  page-end glow that belong together. Picking one only fills the editor; nothing changes for visitors until Save. */
export const WASH_PRESETS: readonly { id: string; name: string; wash: Readonly<WashSettings> }[] = Object.freeze([
  { id: "dusk", name: "Dusk", wash: DEFAULT_WASH },
  { id: "aurora", name: "Aurora", wash: { a: "#2f9e8f", b: "#3f7fb8", c: "#7a5cc4", ga: "#2fb37f", gb: "#3a8fa8", gc: "#6a5acd", strength: 1, spread: 1 } },
  { id: "sunset", name: "Sunset", wash: { a: "#d0784a", b: "#c2557a", c: "#7c4fa8", ga: "#e08a3c", gb: "#d14f6b", gc: "#8a4fb0", strength: 1, spread: 1 } },
  { id: "ocean", name: "Ocean", wash: { a: "#1f5fa8", b: "#1d8fb0", c: "#1f9e9a", ga: "#1aa3b8", gb: "#2563b8", gc: "#3a4fa0", strength: 1, spread: 1 } },
  { id: "ember", name: "Ember", wash: { a: "#b8452f", b: "#c7702e", c: "#9c3a5a", ga: "#e0662e", gb: "#c9a032", gc: "#a83a3a", strength: 1, spread: 1 } },
  { id: "nebula", name: "Nebula", wash: { a: "#b0469e", b: "#5a4fc4", c: "#2f8fb8", ga: "#c24fa8", gb: "#6a4fd0", gc: "#2fa0c8", strength: 1, spread: 1 } },
]);

/** How strong a glow is from its centre (0) to its edge (1): 1 - smoothstep, flat at the centre and flat at the edge,
 *  so neither its middle nor its rim shows as a circle. A two-stop gradient (colour → transparent) falls off in a
 *  straight line and stops dead at its end, and the eye picks out that corner as a ring (Mach bands). */
const FALLOFF = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;
const ease = (t: number) => (1 - t * t * (3 - 2 * t)) ** 1.4;
/** A radial glow's colour stops, `colour` fading out smoothly by `end` (a percentage of the gradient's radius). */
export const softStops = (colour: string, end = 100) =>
  FALLOFF.map((t) => {
    const a = Math.round(ease(t) * 1000) / 10;
    const at = `${Math.round(t * end * 10) / 10}%`;
    return a >= 100 ? `${colour} ${at}` : a <= 0 ? `transparent ${at}` : `color-mix(in srgb,${colour} ${a}%,transparent) ${at}`;
  }).join(",");
/** The wash's fade to the page at its bottom: eased too, so it has no line where the old two-slope fade turned. */
export const WASH_FADE = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.97) 20%,rgb(0 0 0/.88) 40%,rgb(0 0 0/.7) 55%,rgb(0 0 0/.46) 70%,rgb(0 0 0/.22) 84%,rgb(0 0 0/.06) 94%,transparent 100%)";

/** The keys that make up a wash, in the order the console lists them. */
export const WASH_KEYS = ["a", "b", "c", "ga", "gb", "gc", "strength", "spread"] as const;
export const COLOUR_KEYS = ["a", "b", "c", "ga", "gb", "gc"] as const;
export type ColourKey = (typeof COLOUR_KEYS)[number];

/** Whether two washes are the same. */
export const sameWash = (x: WashSettings, y: WashSettings) => WASH_KEYS.every((k) => x[k] === y[k]);

/** The preset `w` is, if any. */
export const presetOf = (w: WashSettings) => WASH_PRESETS.find((p) => sameWash(p.wash, w)) ?? null;

export const WASH_STRENGTH = { min: 0.3, max: 1.6 } as const;
export const WASH_SPREAD = { min: 0.6, max: 1.6 } as const;

/** The id of the first paint's <style> with the owner's wash (server/seo.ts); the app replaces it after a save. */
export const WASH_STYLE_ID = "cs-wash";

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `s` as #rrggbb in lower case, or null when it isn't a hex colour (#rgb and a missing # are accepted). */
export function cleanHex(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = HEX.exec(s.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? h.replace(/./g, (x) => x + x) : h}`;
}

const clamp = (n: number, r: { min: number; max: number }) => Math.round(Math.min(r.max, Math.max(r.min, n)) * 100) / 100;

/**
 * The settings in `x`, cleaned (colours as #rrggbb, numbers clamped to their range and rounded to 0.01), or a
 * problem in words: a field that isn't a hex colour or a number. Every field is needed.
 */
export function parseWash(x: unknown): { wash: WashSettings } | { problem: string } {
  if (!x || typeof x !== "object") return { problem: "Send the wash as {a, b, c, ga, gb, gc, strength, spread}." };
  const o = x as Record<string, unknown>;
  const names = { a: "The left colour", b: "The middle colour", c: "The right colour", ga: "The glow's left colour", gb: "The glow's middle colour", gc: "The glow's right colour" } as const;
  const colours = {} as Pick<WashSettings, ColourKey>;
  for (const k of COLOUR_KEYS) {
    // The glow's colours came later: a wash saved without them keeps the default glow.
    const hex = cleanHex(o[k] === undefined && k.startsWith("g") ? DEFAULT_WASH[k] : o[k]);
    if (!hex) return { problem: `${names[k]} must be a hex colour, like #5a76ad.` };
    colours[k] = hex;
  }
  const nums = {} as Pick<WashSettings, "strength" | "spread">;
  for (const [k, range, name] of [["strength", WASH_STRENGTH, "Brightness"], ["spread", WASH_SPREAD, "Spread"]] as const) {
    const n = o[k];
    if (typeof n !== "number" || !Number.isFinite(n)) return { problem: `${name} must be a number from ${range.min} to ${range.max}.` };
    nums[k] = clamp(n, range);
  }
  return { wash: { ...colours, ...nums } };
}

/** Whether `w` is the default wash. */
export const isDefaultWash = (w: WashSettings) => sameWash(w, DEFAULT_WASH);

/** `hex` with each channel times `k` (as CSS brightness() does), capped at 255. */
function brighten(hex: string, k: number): string {
  if (k <= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `#${[16, 8, 0].map((s) => Math.min(255, Math.round(((n >> s) & 255) * k)).toString(16).padStart(2, "0")).join("")}`;
}

export type WashVars = Record<"--wash-a" | "--wash-b" | "--wash-c" | "--glow-a" | "--glow-b" | "--glow-c" | "--wash-strength" | "--wash-spread", string>;

/**
 * The CSS variables for `w`, as Wash.tsx and the first paint read them. --wash-strength stays within 0.3–1 (it is an
 * opacity, and the first paint uses it in a colour-mix percentage); brightness above 1 brightens the colours instead.
 */
export function washVars(w: WashSettings): WashVars {
  const boost = Math.max(1, w.strength);
  return {
    "--wash-a": brighten(w.a, boost),
    "--wash-b": brighten(w.b, boost),
    "--wash-c": brighten(w.c, boost),
    "--glow-a": w.ga,
    "--glow-b": w.gb,
    "--glow-c": w.gc,
    "--wash-strength": String(Math.min(1, w.strength)),
    "--wash-spread": String(w.spread),
  };
}

/**
 * The <style> rule for `w`. `html[data-v8]:root` outranks index.css's `html[data-v8]`, so it wins wherever it sits in
 * the head; the classic look has no data-v8 and never sees it. Only cleaned values (parseWash) reach here, so the
 * text is safe inside <style>.
 */
export function washCss(w: WashSettings): string {
  return `html[data-v8]:root{${Object.entries(washVars(w)).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
