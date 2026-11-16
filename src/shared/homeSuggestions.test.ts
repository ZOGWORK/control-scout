// Home's suggestion pool and the hourly pick: every family of answer is in the pool, each chip fits, and each hour
// gives six of different families, with a leaderboard and a sentence or filtered query, the same in every browser.
// The pool names no team and leans on no one region; a visitor's own team adds its own two chips.
import { describe, expect, it } from "vitest";
import { HOME_SUGGESTIONS, SUGGESTION_COUNT, SUGGESTION_HOUR_MS, SUGGESTION_LABEL_MAX, SUGGESTION_PLACES, TEAM_LABEL_MAX, TEAM_SUGGESTION_COUNT, DESKTOP_CHIPS, allFit, chipWidthEstimate, fitChips, placeholderable, suggestionLabel, suggestionPlace, suggestionsAt, teamLabel, teamSuggestions, type HomeSuggestion, type SuggestionKind } from "./homeSuggestions";

const KINDS: SuggestionKind[] = ["leaderboard", "phase", "winners", "question", "filters", "count", "scores", "events"];
const T0 = Date.UTC(2026, 10, 4, 0, 0);
const hours = Array.from({ length: 24 * 60 }, (_, h) => T0 + h * SUGGESTION_HOUR_MS);

describe("home suggestion pool", () => {
  it("holds 40 to 80 queries, each once, covering every family at least twice", () => {
    expect(HOME_SUGGESTIONS.length).toBeGreaterThanOrEqual(40);
    expect(HOME_SUGGESTIONS.length).toBeLessThanOrEqual(80);
    expect(new Set(HOME_SUGGESTIONS.map((s) => s.q.toLowerCase())).size).toBe(HOME_SUGGESTIONS.length);
    for (const k of KINDS) expect(HOME_SUGGESTIONS.filter((s) => s.kind === k).length, k).toBeGreaterThanOrEqual(2);
  });
  it("labels fit a chip, are each different, and are in sentence case", () => {
    for (const s of HOME_SUGGESTIONS) {
      expect(suggestionLabel(s).length, s.q).toBeLessThanOrEqual(SUGGESTION_LABEL_MAX);
      expect(suggestionLabel(s), s.q).toMatch(/^[A-Z0-9]/);
    }
    expect(new Set(HOME_SUGGESTIONS.map(suggestionLabel)).size).toBe(HOME_SUGGESTIONS.length);
  });
  it("holds only its own families, none of them a team's", () => {
    expect([...new Set(HOME_SUGGESTIONS.map((s) => s.kind))].sort()).toEqual([...KINDS].sort());
    expect(HOME_SUGGESTIONS.filter((s) => s.mine)).toEqual([]);
  });
  it("names no team, by number or by name", () => {
    // Every team number in a query or label (a threshold, "opr over 100" or "OPR 20+", is not one).
    const numbers = (text: string): string[] => text.match(/(?<!\bover )\b\d{3,5}\b(?!\+)/g) ?? [];
    expect(HOME_SUGGESTIONS.flatMap((s) => [...numbers(s.q), ...numbers(suggestionLabel(s))].map((t) => `${s.q}: ${t}`))).toEqual([]);
    // The teams the pool once named, by name.
    for (const name of ["Hypnotic Robotics", "Bad Wolf", "ENFORCERS", "Don't Blink", "Ultraviolet", "Bit by Bit"]) {
      expect(HOME_SUGGESTIONS.filter((s) => `${s.q} ${suggestionLabel(s)}`.toLowerCase().includes(name.toLowerCase())).map((s) => s.q), name).toEqual([]);
    }
  });
  it("leans on no one region: no New Jersey, and no place in more than a few chips", () => {
    expect(HOME_SUGGESTIONS.filter((s) => /\b(nj|new jersey|oradell)\b/i.test(`${s.q} ${suggestionLabel(s)}`)).map((s) => s.q)).toEqual([]);
    const places = SUGGESTION_PLACES;
    // Every place a query names is one suggestionPlace knows (so an hour never shows it twice).
    const named = /\bin ([A-Z][a-z]+)|\bfrom ([a-z]+)|\b(romania|ontario|michigan|texas|california|brazil|china)\b/gi;
    for (const s of HOME_SUGGESTIONS) for (const m of s.q.matchAll(named)) {
      const word = (m[1] ?? m[2] ?? m[3]).toLowerCase();
      if (!["the", "a"].includes(word)) expect(places.map((p) => p.toLowerCase()), s.q).toContain(word);
    }
    const names = (s: HomeSuggestion, p: string) => new RegExp(`\\b${p}\\b`, "i").test(s.q);
    for (const p of places) expect(HOME_SUGGESTIONS.filter((s) => names(s, p)).length, p).toBeLessThanOrEqual(8);
    // Many name no place at all: the world's boards.
    expect(HOME_SUGGESTIONS.filter((s) => !places.some((p) => names(s, p))).length).toBeGreaterThanOrEqual(15);
  });
});

describe("a visitor's own team's chips", () => {
  it("run by the team's number, one of each family, and show its number and name", () => {
    const mine = teamSuggestions(4215, "Hypnotic Robotics");
    expect(mine.map((s) => s.q)).toEqual(["4215 rating", "4215 OPR", "4215 record", "4215 matches", "4215 awards", "When did 4215 go to Worlds"]);
    expect(new Set(mine.map((s) => s.kind)).size).toBe(mine.length);
    expect(mine.every((s) => s.mine)).toBe(true);
    expect(mine.map(suggestionLabel)).toEqual(["4215 Hypnotic Robotics rating", "4215 Hypnotic Robotics OPR", "4215 Hypnotic Robotics record", "4215 Hypnotic Robotics matches", "4215 Hypnotic Robotics awards", "4215 Hypnotic Robotics Worlds"]);
    // Their families are none of the pool's, so the pool fills the rest without a clash.
    expect(mine.filter((s) => KINDS.includes(s.kind))).toEqual([]);
  });
  it("fit a chip: the name cut at a word with “…”, a name with no room left out, and the number alone with no name", () => {
    expect(teamLabel(4215, "Hypnotic Robotics", "at Worlds")).toBe("4215 Hypnotic… at Worlds");
    expect(teamLabel(4215, "Hypnotic Robotics", "OPR")).toBe("4215 Hypnotic Robotics OPR");
    expect(teamLabel(6980, "Bad Wolf", "at Worlds")).toBe("6980 Bad Wolf at Worlds");
    expect(teamLabel(12345, "Supercalifragilisticexpialidocious", "rating")).toBe("12345 Supercalifragili… rating");
    expect(teamLabel(12345, "Robo-Rangers & Friends", "matches")).toBe("12345 Robo-Rangers… matches");
    expect(teamLabel(16091, "T.W.C.A. (Team Without a Cool Acronym)", "rating")).toBe("16091 T.W.C.A. rating");
    expect(teamLabel(12345, null, "matches")).toBe("12345 matches");
    expect(teamLabel(12345, "  ", "matches")).toBe("12345 matches");
    for (const name of ["A", "The Quick Brown Fox Jumps", "Robo-Rangers & Friends of the Lake", "X Y Z W V U T S R Q"]) {
      for (const s of teamSuggestions(123456, name)) {
        expect(suggestionLabel(s).length, suggestionLabel(s)).toBeLessThanOrEqual(TEAM_LABEL_MAX);
        expect(suggestionLabel(s)).toMatch(/^123456 /);
      }
    }
  });
});

describe("suggestionsAt", () => {
  it("is the same all hour and the same on every call", () => {
    expect(suggestionsAt(T0 + 5 * 60_000)).toEqual(suggestionsAt(T0 + 59 * 60_000));
    expect(suggestionsAt(T0)).toEqual(suggestionsAt(T0));
  });
  it("gives six of different families, a leaderboard and a sentence or filtered query among them, every hour", () => {
    for (const h of hours) {
      const six = suggestionsAt(h);
      expect(six).toHaveLength(SUGGESTION_COUNT);
      expect(new Set(six.map((s) => s.kind)).size).toBe(SUGGESTION_COUNT);
      expect(six.some((s) => s.kind === "leaderboard")).toBe(true);
      expect(six.some((s) => s.kind === "question" || s.kind === "filters")).toBe(true);
      expect(six.some(placeholderable)).toBe(true);
    }
  });
  it("changes from one hour to the next, and shows every query in the pool within a few weeks", () => {
    for (let i = 1; i < hours.length; i++) expect(suggestionsAt(hours[i]).map((s) => s.q)).not.toEqual(suggestionsAt(hours[i - 1]).map((s) => s.q));
    const seen = new Set(hours.flatMap((h) => suggestionsAt(h).map((s) => s.q)));
    expect(HOME_SUGGESTIONS.filter((s) => !seen.has(s.q)).map((s) => s.q)).toEqual([]);
  });
  it("never names one place twice in an hour, with or without a team of the visitor's own", () => {
    const mine = teamSuggestions(16091, "T.W.C.A. (Team Without a Cool Acronym)");
    for (const h of hours) for (const six of [suggestionsAt(h), suggestionsAt(h, HOME_SUGGESTIONS, mine)]) {
      const places = six.map(suggestionPlace).filter(Boolean);
      expect(new Set(places).size, six.map((s) => s.q).join(" | ")).toBe(places.length);
    }
  });
  it("fits every hour's six whole on a desktop's rows, beside the globe too", () => {
    const short = hours.filter((h) => !allFit(suggestionsAt(h).map(chipWidthEstimate), DESKTOP_CHIPS.width, DESKTOP_CHIPS.gap, DESKTOP_CHIPS.rows)).length;
    expect(short).toBe(0);
    // allFit agrees with fitChips keeping all of them.
    for (const h of hours.slice(0, 48)) {
      const ws = suggestionsAt(h).map(chipWidthEstimate);
      for (const w of [300, 390, 500]) expect(allFit(ws, w, 8, 2)).toBe(fitChips(ws, w, 8, 2).length === ws.length);
    }
  });
  it("with a team of its own: two of its chips every hour (changing through the day), the rest the pool's, all fitting a desktop", () => {
    const mine = teamSuggestions(4215, "Hypnotic Robotics");
    const days = hours.slice(0, 24 * 14);
    const picked = new Set<string>();
    for (const h of days) {
      const six = suggestionsAt(h, HOME_SUGGESTIONS, mine);
      const own = six.filter((s) => s.mine);
      expect(own).toHaveLength(TEAM_SUGGESTION_COUNT);
      own.forEach((s) => picked.add(s.q));
      expect(six.length).toBeGreaterThanOrEqual(5);
      expect(six.length).toBeLessThanOrEqual(SUGGESTION_COUNT);
      expect(new Set(six.map((s) => s.kind)).size).toBe(six.length);
      expect(six.some((s) => s.kind === "leaderboard")).toBe(true);
      expect(allFit(six.map(chipWidthEstimate), DESKTOP_CHIPS.width, DESKTOP_CHIPS.gap, DESKTOP_CHIPS.rows)).toBe(true);
      expect(suggestionsAt(h, HOME_SUGGESTIONS, mine)).toEqual(six);
    }
    expect(picked.size).toBe(mine.length);
  });
});

describe("fitChips", () => {
  const rowsOf = (widths: number[], order: number[], width: number, gap: number) => {
    let rows = 0, used = Infinity;
    for (const i of order) { if (used + gap + widths[i] > width) { rows++; used = widths[i]; } else used += gap + widths[i]; }
    return rows;
  };
  it("keeps every chip, in order, when they all fit", () => {
    expect(fitChips([100, 100, 100, 100], 400, 8, 2)).toEqual([0, 1, 2, 3]);
  });
  it("keeps the most that fit whole, wrapping onto no more than its rows, and drops one too wide for any row", () => {
    const widths = [200, 200, 100, 250, 90, 80, 320];
    const order = fitChips(widths, 300, 0, 2);
    expect(order).toHaveLength(4);
    expect(order).not.toContain(6);
    expect(rowsOf(widths, order, 300, 0)).toBeLessThanOrEqual(2);
  });
  it("packs rows to keep more than the hour's own order would", () => {
    // In order 180, 150, 180 would take three rows; packed (180+100, 150) three fit on two.
    const widths = [180, 150, 180, 100];
    const order = fitChips(widths, 290, 8, 2);
    expect(order).toHaveLength(3);
    expect(rowsOf(widths, order, 290, 8)).toBeLessThanOrEqual(2);
  });
  it("keeps a leaderboard and a sentence query over others of the same width", () => {
    const order = fitChips([150, 150, 150, 150], 310, 8, 1, ["count", "leaderboard", "phase", "question"]);
    expect(order).toEqual([1, 3]);
  });
  it("keeps the visitor's own team's chips over more of the others", () => {
    // Two 200px chips of the pool's fit one row of 410 where the team's 260px chip would leave room for none of them.
    expect(fitChips([200, 200, 260], 410, 8, 1)).toEqual([0, 1]);
    expect(fitChips([200, 200, 260], 410, 8, 1, [], [false, false, true])).toEqual([2]);
  });
  it("lays out every hour's six at phone widths on no more than two rows, keeping at least two", () => {
    const w = (s: HomeSuggestion) => 44 + 7.2 * suggestionLabel(s).length;
    for (const h of hours.slice(0, 24 * 7)) {
      const six = suggestionsAt(h);
      const ws = six.map(w);
      for (const width of [288, 358]) {
        const order = fitChips(ws, width, 7, 2, six.map((s) => s.kind));
        expect(rowsOf(ws, order, width, 7)).toBeLessThanOrEqual(2);
        expect(order.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
