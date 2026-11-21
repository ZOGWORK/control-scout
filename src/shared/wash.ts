// The v8 wash (src/components/layout/Wash.tsx; the first paint's copy in server/bootShell.ts): the soft colour band
// across the top of every page. The owner can change it in the console (server/wash.ts, owner_settings key "wash"):
// three colours (left, middle, right), a brightness and a spread. Shared by the server (validation, the first
// paint's <style>) and the app (the console's live preview), so both turn the same settings into the same CSS.

export interface WashSettings {
  /** Left, middle and right colours, as #rrggbb (lower case). */
  a: string;
  b: string;
  c: string;
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
export const DEFAULT_WASH: Readonly<WashSettings> = Object.freeze({ a: "#5a76ad", b: "#5f5785", c: "#91689c", strength: 1, spread: 1 });

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
  if (!x || typeof x !== "object") return { problem: "Send the wash as {a, b, c, strength, spread}." };
  const o = x as Record<string, unknown>;
  const names = { a: "The left colour", b: "The middle colour", c: "The right colour" } as const;
  const colours = {} as Pick<WashSettings, "a" | "b" | "c">;
  for (const k of ["a", "b", "c"] as const) {
    const hex = cleanHex(o[k]);
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
export const isDefaultWash = (w: WashSettings) => (["a", "b", "c", "strength", "spread"] as const).every((k) => w[k] === DEFAULT_WASH[k]);

/** `hex` with each channel times `k` (as CSS brightness() does), capped at 255. */
function brighten(hex: string, k: number): string {
  if (k <= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `#${[16, 8, 0].map((s) => Math.min(255, Math.round(((n >> s) & 255) * k)).toString(16).padStart(2, "0")).join("")}`;
}

export type WashVars = Record<"--wash-a" | "--wash-b" | "--wash-c" | "--wash-strength" | "--wash-spread", string>;

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
