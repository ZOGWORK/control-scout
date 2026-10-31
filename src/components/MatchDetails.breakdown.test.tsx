// @vitest-environment jsdom
// The finished match's breakdown is display only: every number it renders is the match's own data, unchanged
// (each phase, the fouls, the total and the margin), and each bonus RP chip says earned or missed exactly as
// the data does, in words and a mark as well as colour.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MatchDetail } from "../shared/api";
import { Breakdown, RpChip, breakdownRows, rowLead } from "./MatchDetails";
import { Pollinator1Icon, Pollinator2Icon, SwarmIcon, rpIcon } from "./BreakdownIcons";

const score = (total: number, np: number, auto: number, teleop: number, endgame: number, pen: number) => ({ total, np, auto, teleop, endgame, pen });
const side = (ts: number[], s: ReturnType<typeof score>) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: s });
const detail = (sheet: MatchDetail["sheet"] = null): MatchDetail => ({
  event: { season: 2026, code: "TEST", name: "Test", status: "done" },
  match: { season: 2026, code: "TEST", key: "qual:0:8", level: "qual", series: 0, number: 8, label: "Q8", time: null, startsAt: null, played: true,
    red: side([1, 2], score(124, 124, 36, 78, 10, 20)), blue: side([3, 4], score(82, 62, 3, 54, 5, 0)), video: null },
  description: null, stations: {}, bonus: { labels: ["Swarm", "Pollinator 1", "Pollinator 2"], red: [true, false, false], blue: [false, false, true] },
  teams: {}, sheet, prev: null, next: null,
} as unknown as MatchDetail);

const rendered = () => screen.getAllByRole("listitem").filter((li) => li.dataset.label != null).map((li) => ({
  label: li.dataset.label!,
  red: within(li).getByTestId("value-red").textContent,
  blue: within(li).getByTestId("value-blue").textContent,
  lead: within(li).getByTestId("lead").textContent,
}));
const shown = (v: number | null) => (v == null ? "—" : String(v));

afterEach(cleanup);

describe("match breakdown", () => {
  it("renders the engine split exactly as the match data has it, ending on the total and the margin", () => {
    const d = detail();
    render(<Breakdown d={d} />);
    const r = d.match.red.score!, b = d.match.blue.score!;
    expect(rendered()).toEqual([
      { label: "Auto", red: String(r.auto), blue: String(b.auto), lead: "Red +33" },
      { label: "TeleOp", red: String(r.teleop), blue: String(b.teleop), lead: "Red +24" },
      { label: "Endgame", red: String(r.endgame), blue: String(b.endgame), lead: "Red +5" },
      { label: "No penalties", red: String(r.np), blue: String(b.np), lead: "Red +62" },
      { label: "Fouls given away", red: String(r.pen), blue: String(b.pen), lead: "Red gave 20 more" },
      { label: "Total", red: String(r.total), blue: String(b.total), lead: "Red +42" },
    ]);
    expect(screen.getByTestId("breakdown-margin").textContent).toBe("Red by 42124–82.");
  });

  it("renders FIRST's full sheet row by row, with the total from the match score", () => {
    const sheet: MatchDetail["sheet"] = [
      { label: "Auto", depth: 0, red: 36, blue: 3 }, { label: "Leave", depth: 1, red: 6, blue: 3 }, { label: "Hive", depth: 1, red: 20, blue: 0 },
      { label: "TeleOp", depth: 0, red: 88, blue: 59 }, { label: "Flower", depth: 1, red: null, blue: 12 },
      { label: "Fouls given away", depth: 0, red: 20, blue: 0 }, { label: "Major fouls", depth: 1, count: true, red: 1, blue: 0 },
    ];
    const d = detail(sheet);
    render(<Breakdown d={d} />);
    const rows = rendered();
    expect(rows.map((x) => x.label)).toEqual([...sheet.map((x) => x.label), "Total"]);
    sheet.forEach((x, i) => expect([rows[i].red, rows[i].blue]).toEqual([shown(x.red), shown(x.blue)]));
    expect(rows.at(-1)).toMatchObject({ red: "124", blue: "82" });
    expect(rows.find((x) => x.label === "Major fouls")!.lead).toBe("Red 1 more");
    expect(rows.find((x) => x.label === "Flower")!.lead).toBe("—");
    expect(breakdownRows(d).at(-1)).toMatchObject({ red: d.match.red.score!.total, blue: d.match.blue.score!.total, total: true });
  });

  it("says a tie in words, names no lead when a value is missing, and never relies on colour", () => {
    expect(rowLead({ label: "Auto", red: 10, blue: 10 })).toEqual({ side: null, text: "Even" });
    expect(rowLead({ label: "Auto", red: 4, blue: 9 })).toEqual({ side: "blue", text: "Blue +5" });
    expect(rowLead({ label: "Auto", red: null, blue: null })).toEqual({ side: null, text: "—" });
    expect(rowLead({ label: "Flower", red: null, blue: 12 })).toEqual({ side: null, text: "—" });
  });

  it("shows each RP as earned or missed exactly as the data says, with a word and a mark", () => {
    render(<ul><RpChip label="Swarm" earned /><RpChip label="Pollinator 1" earned={false} /></ul>);
    const [earned, missed] = screen.getAllByRole("listitem");
    expect(earned.dataset.earned).toBe("true");
    expect(earned.textContent).toContain("Swarm RP earned");
    expect(earned.textContent).toContain("✓ Earned");
    expect(missed.dataset.earned).toBe("false");
    expect(missed.textContent).toContain("Pollinator 1 RP missed");
    expect(missed.textContent).toContain("✗ Missed");
    expect(missed.textContent).not.toContain("Earned");
  });

  it("gives BIOBUZZ's three bonus RPs three different icons", () => {
    expect([rpIcon("Swarm"), rpIcon("Pollinator 1"), rpIcon("Pollinator 2")]).toEqual([SwarmIcon, Pollinator1Icon, Pollinator2Icon]);
  });
});
