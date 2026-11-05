// @vitest-environment jsdom
// The comparison card against the search results guide's checks (.claude/search-viz-guide-2026-11-05.txt §11): every
// bar's length matches its number (lie factor within 5%), hue means team only, and each fact is printed once with no
// meta or debug text and one primary action.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { StatAnswer } from "../../../shared/searchStat";
import { StatAnswerCard } from "./StatAnswer";

afterEach(cleanup);
const html = (s: StatAnswer) => render(<MemoryRouter><StatAnswerCard stat={s} /></MemoryRouter>).container;

const VS: StatAnswer = {
  family: "two-team", intent: "opr-vs", title: "OPR: 23268 vs 7149 in 2025–26", team: { number: 23268, name: "Ultraviolet" }, teams: [{ number: 23268, name: "Ultraviolet" }, { number: 7149, name: "ENFORCERS" }], scope: ["2025–26"],
  headline: { value: "23268 leads 157.9 – 115.3", label: "+42.6", sub: "#144 of 8,308 · #446 of 8,308 · TeleOp decided it (+32.3)", href: "/teams/23268?season=2025" },
  blocks: [
    { kind: "compare", title: "OPR", scale: "the 2025–26 high, rounded up", teams: [{ label: "23268", href: "/teams/23268" }, { label: "7149", href: "/teams/7149" }], rows: [
      { label: "Total", values: ["157.9", "115.3"], nums: [157.9, 115.3], max: 250, best: 0, gap: "+42.6", diff: 42.6 },
      { label: "TeleOp", values: ["101.0", "68.7"], nums: [101, 68.7], max: 150, best: 0, gap: "+32.3", diff: 32.3 },
      { label: "Auto", values: ["36.5", "41.6"], nums: [36.5, 41.6], max: 60, best: 1, gap: "+5.1", diff: 5.1 },
      { label: "Endgame", values: ["20.4", "—"], nums: [20.4, null], max: 40, best: null },
    ] },
    { kind: "links", title: "Try it", items: [{ label: "Open in Predict", href: "/predict?x" }, { label: "Compare side by side", href: "/compare?teams=7149,23268" }] },
  ],
  definition: "From each team's stored season numbers.", source: "From both teams' 2025–26 season numbers",
};

/** Every bar pair's lie factor: the ratio of the drawn lengths over the ratio of the numbers (1 is honest). */
function lieFactors(c: HTMLElement): { metric: string; lf: number }[] {
  const out: { metric: string; lf: number }[] = [];
  for (const m of c.querySelectorAll<HTMLElement>("[data-metric]")) {
    const bars = [...m.querySelectorAll<HTMLElement>("[data-bar]")].map((b) => ({ w: Number.parseFloat(b.style.width), v: Number(b.dataset.value), max: Number(b.dataset.scale) }))
      .filter((b) => b.v > 0);
    // Each bar on its own against the scale, from zero.
    for (const b of bars) out.push({ metric: `${m.dataset.metric} (scale)`, lf: b.w / 100 / (b.v / b.max) });
    for (let i = 1; i < bars.length; i++) out.push({ metric: m.dataset.metric!, lf: bars[i].w / bars[0].w / (bars[i].v / bars[0].v) });
  }
  return out;
}

/** The guide's repetition and meta audit for one card. */
function audit(card: HTMLElement, teamNames: string[]) {
  const text = card.textContent ?? "";
  const problems: string[] = [];
  for (const n of teamNames) { const k = text.split(n).length - 1; if (k !== 1) problems.push(`${n} printed ${k} times`); }
  const ctas = card.querySelectorAll("[data-primary-cta]").length;
  if (ctas > 1) problems.push(`${ctas} primary actions`);
  for (const bad of [/read as/i, /\bdebug\b/i, /\bTODO\b/, /\braw\b/i, /undefined/, /\bNaN\b/, /\[object/]) if (bad.test(text)) problems.push(`meta text ${bad}`);
  for (const h of card.querySelectorAll("h1, h2, h3, h4, [data-headline], [data-metric] > div:first-child")) {
    // A number glued to a word ("157.9leads", "2nd" is fine when written as an ordinal on purpose: none here).
    if (/\d[a-z]/i.test(h.textContent ?? "")) problems.push(`glued heading: ${h.textContent}`);
  }
  return problems;
}

describe("comparison card (the guide's contract)", () => {
  it("one title, one headline, one context line, then a metric per row with its max and gap", () => {
    const c = html(VS);
    const card = c.querySelector("[data-comparison]")!;
    expect(card.tagName).toBe("ARTICLE");
    expect(card.querySelector("h3")!.textContent).toBe("23268 Ultraviolet — 7149 ENFORCERS");
    expect(card.querySelector("[data-headline]")!.textContent).toBe("23268 leads 157.9 – 115.3+42.6");
    expect(card.querySelector("[data-context]")!.textContent).toBe("#144 of 8,308 · #446 of 8,308 · TeleOp decided it (+32.3)");
    const metrics = [...card.querySelectorAll<HTMLElement>("[data-metric]")];
    expect(metrics.map((m) => m.dataset.metric)).toEqual(["Total", "TeleOp", "Auto", "Endgame"]);
    expect(metrics[0].querySelector("[data-max]")!.textContent).toBe("max 250");
    expect(metrics[0].querySelector("[data-gap]")!.textContent).toBe("+42.6");
    // Each value at its bar's end; the better one bold, never in a colour of its own.
    const labels = [...metrics[0].querySelectorAll<HTMLElement>("[data-value-label]")];
    expect(labels.map((l) => l.textContent)).toEqual(["157.9", "115.3"]);
    expect(labels[0].className).toContain("font-bold");
    expect(labels[1].className).not.toContain("font-bold");
    // A missing value says so.
    expect(metrics[3].textContent).toContain("— not on record");
    // No team header strip, no second season pill, no stat tiles.
    expect(card.querySelector("[data-answer-team], [data-scope], [data-kpi]")).toBeNull();
  });
  it("every bar's lie factor is within 5% (bars from zero, each row on its own scale)", () => {
    const lfs = lieFactors(html(VS));
    expect(lfs.length).toBeGreaterThan(6);
    for (const { metric, lf } of lfs) expect(Math.abs(lf - 1), `${metric}: ${lf}`).toBeLessThanOrEqual(0.05);
  });
  it("hue means team: team A, B (and C) fills on the bars, nothing else coloured", () => {
    const c = html({ ...VS, teams: [...VS.teams!, { number: 16461, name: "Infinite Turtles" }], blocks: [{ kind: "compare", title: "OPR", teams: [{ label: "23268", href: "/a" }, { label: "7149", href: "/b" }, { label: "16461", href: "/c" }],
      rows: [{ label: "OPR", values: ["157.9", "115.3", "87.9"], nums: [157.9, 115.3, 87.9], max: 250, best: 0, gap: "+42.6", diff: 42.6 }] }] });
    const fills = [...c.querySelectorAll<HTMLElement>("[data-bar]")].map((b) => b.className.match(/bg-team-[abc]/)?.[0]);
    expect(fills).toEqual(["bg-team-a", "bg-team-b", "bg-team-c"]);
    // At most three hues; no status, phase, alliance or gold colour on the data.
    expect(c.querySelector("[data-block=compare]")!.innerHTML).not.toMatch(/(text|bg|border)-(success|danger|info|warning|accent|sky|emerald|violet|teal|orange|red|blue|amber|rose)/);
  });
  it("prints each fact once, with no meta text and one primary action", () => {
    const c = html(VS);
    const card = c.querySelector<HTMLElement>("[data-comparison]")!;
    expect(audit(card, ["Ultraviolet", "ENFORCERS"])).toEqual([]);
    expect(card.querySelectorAll("[data-primary-cta]")).toHaveLength(1);
    expect(card.querySelector("[data-primary-cta]")!.textContent).toBe("Open in Predict");
    // The method behind a 44px info button.
    const info = card.querySelector<HTMLButtonElement>("[data-method]")!;
    expect(info.className).toContain("size-[44px]");
    expect(card.querySelector("[role=note]")!.hasAttribute("hidden")).toBe(true);
    info.click();
  });
  it("the audit catches what it's for", () => {
    const bad = html({ ...VS, headline: { ...VS.headline!, sub: "read as \"vs\" · NaN · Ultraviolet" } });
    expect(audit(bad.querySelector<HTMLElement>("[data-comparison]")!, ["Ultraviolet"])).toEqual(expect.arrayContaining(["Ultraviolet printed 2 times", "meta text /read as/i", "meta text /\\bNaN\\b/"]));
  });
});
