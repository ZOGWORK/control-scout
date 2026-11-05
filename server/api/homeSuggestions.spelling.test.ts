// Home's suggestion chips (src/shared/homeSuggestions.ts) are spelled right: a chip shown as a thing to try must never
// read as our typo. Every word of every query and label is put to search's own spelling correction
// (server/api/spelling.ts) with the vocabulary it builds from the stored data (team, school, event, venue, city and
// region names), when a copy of the data is here (.data/scout.db). CI has none, so there it is skipped, and
// `npm run suggestions:check` asks the live site's search the same of every chip. A chip naming a team by name spells
// it as the team's own name. (Search's own words alone can't stand in: "conference" is a word only event names have.)
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { buildVocab, correctWord, type Vocab } from "./spelling";
import { HOME_SUGGESTIONS, suggestionLabel } from "../../src/shared/homeSuggestions";
import { misnamed, misspelled } from "../../scripts/check-suggestions";

/** Each word search would correct in the pool's queries and labels, as "text: word → fix". */
const fixes = (v: Vocab) => HOME_SUGGESTIONS.flatMap((s) => [...new Set([s.q, suggestionLabel(s)])].flatMap((text) =>
  (text.toLowerCase().match(/\p{L}{4,}/gu) ?? []).flatMap((w) => { const f = correctWord(w, v); return f ? [`${text}: ${w} → ${f.word}`] : []; })));

describe("home suggestion spelling", () => {
  const data = join(process.cwd(), ".data", "scout.db");
  it.skipIf(!existsSync(data))("spells every team, event and place as the stored data does, and each named team as its own name", async () => {
    const c = createClient({ url: `file:${data.replace(/\\/g, "/")}` });
    try {
      const [teams, events] = await Promise.all([
        c.execute("SELECT number, name, school, city, state FROM teams"),
        c.execute("SELECT code, name, venue, city, state FROM events"),
      ]);
      const rows = <T,>(r: { rows: unknown[] }) => r.rows as T[];
      const v = buildVocab(rows<{ name: string | null; school: string | null; city: string | null; state: string | null }>(teams), rows<{ code: string; name: string | null; venue: string | null; city: string | null; state: string | null }>(events));
      expect(fixes(v)).toEqual([]);
      const names = new Map(rows<{ number: number; name: string | null }>(teams).flatMap((t) => (t.name ? [[String(t.number), t.name] as const] : [])));
      expect(HOME_SUGGESTIONS.flatMap((s) => { const why = misnamed(s, names); return why ? [why] : []; })).toEqual([]);
      // The check finds what the removed misspelled chips were.
      expect(["hypnotik robotics opr", "infinte turtles record", "bad wolff record"].map((q) => (q.match(/\p{L}{4,}/gu) ?? []).some((w) => correctWord(w, v)))).toEqual([true, true, true]);
    } finally { c.close(); }
  }, 60_000);
});

describe("suggestions:check's spelling checks", () => {
  const answer = (o: object) => ({ q: "", hits: [], pages: [], step: "deterministic", weak: false, ...o }) as Parameters<typeof misspelled>[1];
  it("calls a query misspelled when search corrects it or offers a correction beside it", () => {
    expect(misspelled("hypnotik robotics opr", answer({ step: "did-you-mean", didYouMean: "Hypnotic Robotics opr" }))).toContain("Hypnotic Robotics opr");
    expect(misspelled("4215 oper", answer({ didYouMean: "4215 opr" }))).toContain("4215 opr");
    expect(misspelled("4215 opr", answer({}))).toBeNull();
  });
  it("calls a chip misnamed when its query or label spells a named team otherwise than the team's own name", () => {
    const names = new Map([["4215", "Hypnotic Robotics"]]);
    expect(misnamed({ q: "where is hypnotic robotics from", kind: "team", label: "Where is Hypnotic Robotics", teams: ["4215"] }, names)).toBeNull();
    expect(misnamed({ q: "hypnotik robotics opr", kind: "opr", teams: ["4215"] }, names)).toContain("Hypnotic Robotics");
    expect(misnamed({ q: "where is hypnotic robotics from", kind: "team", label: "Where is Hypnotik", teams: ["4215"] }, names)).toContain("Where is Hypnotik");
    expect(misnamed({ q: "x", kind: "team", teams: ["1"] }, names)).toContain("no name");
  });
});
