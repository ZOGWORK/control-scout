// "My" with no team named: the visitor's My team, or the ask to pick one (failed-search #731, #1144; held out).
import { describe, expect, it, vi } from "vitest";
import type { SearchAnswer } from "../../src/shared/api";
import { MY_TEAM_PATH, mineAnswer } from "./searchMine";

const nothing = (q: string): SearchAnswer => ({ q, hits: [], pages: [], step: "recovery", weak: true, understood: { kind: "names", label: `No team, event or match matched "${q}"` } });
const answered = (q: string): SearchAnswer => ({
  q, hits: [], pages: [], step: "deterministic", weak: false,
  understood: { kind: "question", label: "Bad Wolf (6980) · Next match" },
  card: { kind: "next-match", title: "Next match", team: { number: 6980, name: "Bad Wolf" }, lines: [{ text: "Q12" }] },
});

describe("my and our in a search", () => {
  it("answers for My team when the query as typed found nothing", async () => {
    const ask = vi.fn(async (q: string) => answered(q));
    const a = await mineAnswer("when is our next match", nothing("when is our next match"), 6980, ask);
    expect(ask).toHaveBeenCalledWith("when is 6980's next match");
    expect(a?.card).toMatchObject({ kind: "next-match", team: { number: 6980 } });
  });
  it("asks to pick a team, with the My team link, when none is set", async () => {
    const ask = vi.fn(async (q: string) => answered(q));
    const a = await mineAnswer("how did my team do", nothing("how did my team do"), null, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(a?.card).toMatchObject({ kind: "info", lines: [{ text: "Pick your team", href: MY_TEAM_PATH }] });
    expect(a?.hits).toEqual([]);
  });
  it("keeps the query's own answer: one that answered, one without my or our, or My team's that fails too", async () => {
    const ask = vi.fn(async (q: string) => nothing(q));
    expect(await mineAnswer("my 6980 next match", answered("my 6980 next match"), 6980, ask)).toBeNull();
    expect(await mineAnswer("next match", nothing("next match"), 6980, ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(await mineAnswer("our zzz", nothing("our zzz"), 6980, ask)).toBeNull();
  });
});
