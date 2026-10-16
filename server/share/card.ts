// Share cards: a matchup's prediction as a branded PNG, the size link
// previews use (1200×630) or square for Instagram (1080×1080). Always dark,
// in the site's colours (graphite, gold, the alliance red and blue), with the
// C mark, Space Grotesk and Inter, like the site's own link card
// (scripts/og-image.ts). Drawn as SVG and rendered by resvg (WebAssembly: no
// browser, no native build, the same on every machine and CPU).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { SHARE_SIZES, allianceText, favourite, oddsPct } from "../../src/shared/share.js";
import type { ConfidenceTier } from "@control-scout/predict-engine";
import { cardFonts, fitSize, fitText, glyphs, textWidth, type Font } from "./fonts.js";

/** Bumped when the drawing changes, so cached copies (and their ETags) move on with it. */
export const CARD_VERSION = 1;

export interface CardModel {
  format: "landscape" | "square";
  red: number[];
  blue: number[];
  /** Team names by number (unknown ones left out). */
  names: Record<number, string | null | undefined>;
  pRed: number;
  pBlue?: number;
  /** Predicted scores (null: the season has no score basis yet). */
  predicted: { red: number; blue: number } | null;
  /** The final score, once played. */
  final: { red: number; blue: number } | null;
  tier: ConfidenceTier;
  /** A walk-forward replay made after the match, not a call logged before it: the card says so. */
  backtest?: boolean;
  /** What the call is about: "Qualification 12 · Texas Championship", or "Predict Lab". */
  label: string;
  /** "2025–26 season". */
  season: string;
}

const C = {
  bg: "#0a0a0b", text: "#f4f4f5", muted: "#a1a1aa", soft: "#d4d4d8", line: "#2a2a30", chip: "#141416",
  gold: "#ffc700", red: "#f43f5e", blue: "#38bdf8",
};
const TIER: Record<ConfidenceTier, { label: string; color: string }> = {
  provisional: { label: "Provisional confidence", color: "#fbbf24" },
  moderate: { label: "Moderate confidence", color: "#7dd3fc" },
  confident: { label: "Confident", color: "#4ade80" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const markUri = (() => {
  let uri: string | null = null;
  return () => (uri ??= `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "mark.png")).toString("base64")}`);
})();

interface Run { text: string; fill: string; font: Font; /** Its own size (px), else the line's. */ size?: number }
/** One line of text in runs of colour/font, at a baseline. */
function line(x: number, y: number, size: number, runs: Run[], anchor: "start" | "end" = "start"): string {
  const spans = runs.filter((r) => r.text).map((r) => `<tspan font-family="${r.font.family}" font-weight="${r.font.weight}"${r.size ? ` font-size="${r.size}"` : ""} fill="${r.fill}">${esc(r.text)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
}
const runsWidth = (size: number, runs: Run[]) => runs.reduce((w, r) => w + textWidth(r.font, r.size ?? size, r.text), 0);

/** A pill with text: [x, width] back so the next one can follow it. */
function chip(x: number, y: number, h: number, size: number, runs: Run[]): { svg: string; width: number } {
  const pad = Math.round(h * 0.42);
  const width = Math.ceil(runsWidth(size, runs)) + 2 * pad;
  const svg = `<rect x="${x}" y="${y}" width="${width}" height="${h}" rx="${h / 2}" fill="${C.chip}" stroke="${C.line}" stroke-width="2"/>`
    + line(x + pad, Math.round(y + h / 2 + size * 0.36), size, runs);
  return { svg, width };
}

/** The names on an alliance, as its numbers read ("Gearheads & RoboRaiders"); empty when none are known. */
function namesText(font: Font, teams: number[], names: CardModel["names"]): string {
  const known = teams.map((t) => glyphs(font, names[t] ?? "")).filter(Boolean);
  if (!known.length) return "";
  return known.length === 1 ? known[0] : `${known.slice(0, -1).join(", ")} & ${known[known.length - 1]}`;
}

/** The card as SVG (exported for tests: the words on it, before rendering). */
export function cardSvg(m: CardModel): string {
  const { display, body, bodyBold } = cardFonts();
  const { width: W, height: H } = SHARE_SIZES[m.format];
  const sq = m.format === "square";
  const pad = sq ? 80 : 72;
  const inner = W - 2 * pad;
  const f = favourite(m);
  const favColor = f.side === "red" ? C.red : C.blue, otherColor = f.side === "red" ? C.blue : C.red;
  const played = !!m.final;
  const pct = oddsPct(f.p);
  const out: string[] = [];

  // Background: graphite, a faint grid and a gold glow from the corner (the site's link card), gold bar on top.
  out.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);
  out.push(`<defs><pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="2"/></pattern>`
    + `<radialGradient id="glow" cx="0.85" cy="-0.1" r="0.7"><stop offset="0" stop-color="${C.gold}" stop-opacity="0.2"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`);
  out.push(`<rect width="${W}" height="8" fill="${C.gold}"/>`);

  // Brand: the C mark and the name; what the call is about on the right (landscape) or underneath (square).
  const markSize = sq ? 72 : 56, brandSize = sq ? 40 : 32, top = sq ? 80 : 52;
  out.push(`<image href="${markUri()}" x="${pad}" y="${top}" width="${markSize}" height="${markSize}"/>`);
  const brandX = pad + markSize + (sq ? 22 : 18), brandY = Math.round(top + markSize / 2 + brandSize * 0.36);
  out.push(line(brandX, brandY, brandSize, [{ text: "Control Scout", fill: C.text, font: display }]));
  const labelSize = sq ? 28 : 22;
  const label = glyphs(body, `${m.label} · ${m.season}`);
  if (sq) out.push(line(pad, top + markSize + 64, labelSize, [{ text: fitText(body, labelSize, label, inner), fill: C.muted, font: body }]));
  else {
    const room = W - pad - (brandX + textWidth(display, brandSize, "Control Scout") + 40);
    out.push(line(W - pad, brandY - 2, labelSize, [{ text: fitText(body, labelSize, label, room), fill: C.muted, font: body }], "end"));
  }

  // The call: "Our model gives / 4215 & 16379 / a 73% win chance / vs 33950 & 21058".
  const favTeams = allianceText(f.teams), otherTeams = allianceText(f.other);
  const favNames = namesText(body, [...f.teams], m.names), otherNames = namesText(body, [...f.other], m.names);
  const S = sq
    ? { lead: 36, fav: [128, 72], names: 30, chance: [104, 60], vs: [60, 40], y: 330 }
    : { lead: 28, fav: [92, 56], names: 24, chance: [76, 48], vs: [46, 34], y: 186 };
  let y = S.y;
  out.push(line(pad, y, S.lead, [{ text: `Our model ${played ? "gave" : "gives"}`, fill: C.muted, font: body }]));
  const favSize = fitSize(display, favTeams, inner, S.fav[0], S.fav[1]);
  y += Math.round(favSize * (sq ? 1.05 : 1.0));
  out.push(line(pad, y, favSize, [{ text: favTeams, fill: favColor, font: display }]));
  if (favNames) {
    y += Math.round(S.names * 1.55);
    out.push(line(pad, y, S.names, [{ text: fitText(body, S.names, favNames, inner), fill: C.soft, font: body }]));
  }
  const chance: Run[] = [{ text: "a ", fill: C.text, font: display }, { text: pct, fill: C.gold, font: display }, { text: " win chance", fill: C.text, font: display }];
  const chanceSize = (() => { for (let s = S.chance[0]; s > S.chance[1]; s -= 2) if (runsWidth(s, chance) <= inner) return s; return S.chance[1]; })();
  y += Math.round(chanceSize * (favNames ? 1.2 : 1.1));
  out.push(line(pad, y, chanceSize, chance));
  const vs: Run[] = [{ text: "vs ", fill: C.muted, font: display }, { text: otherTeams, fill: otherColor, font: display }];
  const vsSize = (() => { for (let s = S.vs[0]; s > S.vs[1]; s -= 2) if (runsWidth(s, vs) <= inner) return s; return S.vs[1]; })();
  y += Math.round(vsSize * 1.45);
  if (sq) {
    out.push(line(pad, y, vsSize, vs));
    if (otherNames) { y += Math.round(S.names * 1.55); out.push(line(pad, y, S.names, [{ text: fitText(body, S.names, otherNames, inner), fill: C.soft, font: body }])); }
  } else {
    // Landscape: the other side's names follow its numbers on the same line.
    const gap = "   ";
    const room = inner - runsWidth(vsSize, vs) - textWidth(body, S.names, gap);
    const names = otherNames && room > 120 ? fitText(body, S.names, otherNames, room) : "";
    out.push(line(pad, y, vsSize, names && names !== "…" ? [...vs, { text: gap + names, fill: C.soft, font: body, size: S.names }] : vs));
  }

  // Chips: the predicted score (in the headline's order), the final score once played, and the confidence tier.
  const chipH = sq ? 60 : 52, chipSize = sq ? 26 : 22, gap = 14;
  const chipY = sq ? H - 80 - chipH - 76 : H - 48 - chipH;
  const favPred = m.predicted ? (f.side === "red" ? [m.predicted.red, m.predicted.blue] : [m.predicted.blue, m.predicted.red]) : null;
  const favFinal = m.final ? (f.side === "red" ? [m.final.red, m.final.blue] : [m.final.blue, m.final.red]) : null;
  // The confidence tier (and a backtest's label) always shows; the scores give way first if space runs short.
  const chips: { runs: Run[]; drop: number }[] = [];
  const score = (word: string, a: number, b: number): Run[] => [{ text: `${word} `, fill: C.muted, font: body }, { text: String(Math.round(a)), fill: favColor, font: bodyBold }, { text: " – ", fill: C.muted, font: body }, { text: String(Math.round(b)), fill: otherColor, font: bodyBold }];
  if (favPred) chips.push({ runs: score("Predicted", favPred[0], favPred[1]), drop: 1 });
  if (favFinal) chips.push({ runs: score("Final", favFinal[0], favFinal[1]), drop: 2 });
  chips.push({ runs: [{ text: TIER[m.tier].label, fill: TIER[m.tier].color, font: bodyBold }], drop: 0 });
  if (m.backtest) chips.push({ runs: [{ text: "Backtest, not a live call", fill: C.muted, font: body }], drop: 0 });
  const urlSize = sq ? 28 : 24;
  const urlW = textWidth(body, urlSize, "controlscout.org");
  const chipRoom = (sq ? W - pad : W - pad - urlW - 24) - pad; // never over the address
  const widthOf = (list: typeof chips) => list.reduce((w, c) => w + chip(0, 0, chipH, chipSize, c.runs).width + gap, -gap);
  let shown = chips;
  for (const d of [1, 2]) if (widthOf(shown) > chipRoom) shown = shown.filter((c) => c.drop !== d);
  let x = pad;
  for (const c of shown) {
    const ch = chip(x, chipY, chipH, chipSize, c.runs);
    out.push(ch.svg);
    x += ch.width + gap;
  }
  // The address: bottom right beside the chips (landscape), or along the bottom (square).
  if (sq) out.push(line(pad, H - 80, urlSize, [{ text: "controlscout.org", fill: C.muted, font: body }]));
  else out.push(line(W - pad, Math.round(chipY + chipH / 2 + urlSize * 0.36), urlSize, [{ text: "controlscout.org", fill: C.muted, font: body }], "end"));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}

let ready: Promise<void> | null = null;
function wasm(): Promise<void> {
  ready ??= initWasm(readFileSync(createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm"))).catch((e) => { ready = null; throw e; });
  return ready;
}

/** The card as a PNG. */
export async function renderCard(m: CardModel): Promise<Buffer> {
  await wasm();
  const { display, body, bodyBold } = cardFonts();
  const r = new Resvg(cardSvg(m), {
    font: { fontBuffers: [display.data, body.data, bodyBold.data], defaultFontFamily: "Inter" },
    fitTo: { mode: "original" },
    shapeRendering: 2, textRendering: 1,
  });
  try {
    const img = r.render();
    try { return Buffer.from(img.asPng()); } finally { img.free(); }
  } finally { r.free(); }
}
