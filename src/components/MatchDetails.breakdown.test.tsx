// @vitest-environment jsdom
// The finished match's breakdown is display only: every number it renders is the match's own data, unchanged
// (each phase, the fouls, the total and the margin), and each bonus RP chip says earned or missed exactly as
// the data does, in words and a mark as well as colour.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MatchDetail } from "../shared/api";
import { Breakdown, Headline, RpChip, breakdownRows, groupRows, rowLead } from "./MatchDetails";
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

// Every row on screen (a phase, or a part of one once its phase is open), read the way a person would.
const rendered = () => Array.from(document.querySelectorAll<HTMLElement>("[data-label]")).map((el) => ({
  label: el.dataset.label!,
  red: within(el).getByTestId("value-red").textContent,
  blue: within(el).getByTestId("value-blue").textContent,
  lead: within(el).getByTestId("lead").textContent,
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
    // No bars anywhere: the difference column is the comparison.
    expect(document.querySelector("[style*='width']")).toBeNull();
  });

  it("puts the score and the margin first, winner named, and says when penalties decided it", () => {
    const d = detail();
    render(<Headline d={d} />);
    expect(screen.getByTestId("breakdown-margin").textContent).toBe("124 – 82Red by 42");
    expect(screen.getByTestId("match-line").textContent).toBe("Q8");
  });

  it("renders FIRST's full sheet: phases first, each one's parts a tap away with the same numbers", () => {
    const sheet: MatchDetail["sheet"] = [
      { label: "Auto", depth: 0, red: 36, blue: 3 }, { label: "Leave", depth: 1, red: 6, blue: 3 }, { label: "Hive", depth: 1, red: 20, blue: 0 },
      { label: "TeleOp", depth: 0, red: 88, blue: 59 }, { label: "Flower", depth: 1, red: null, blue: 12 },
      { label: "Fouls given away", depth: 0, red: 20, blue: 0 }, { label: "Major fouls", depth: 1, count: true, red: 1, blue: 0 },
    ];
    const d = detail(sheet);
    render(<Breakdown d={d} />);
    // Collapsed on load: the phases and the total only.
    expect(rendered().map((x) => x.label)).toEqual(["Auto", "TeleOp", "Fouls given away", "Total"]);
    const phases = screen.getAllByRole("button");
    expect(phases.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    phases.forEach((b) => fireEvent.click(b));
    const rows = rendered();
    expect(rows.map((x) => x.label)).toEqual([...sheet.map((x) => x.label), "Total"]);
    sheet.forEach((x, i) => expect([rows[i].red, rows[i].blue]).toEqual([shown(x.red), shown(x.blue)]));
    expect(rows.at(-1)).toMatchObject({ red: "124", blue: "82" });
    expect(rows.find((x) => x.label === "Major fouls")!.lead).toBe("Red 1 more");
    expect(rows.find((x) => x.label === "Fouls given away")!.lead).toBe("Red gave 20 more");
    expect(rows.find((x) => x.label === "Flower")!.lead).toBe("—");
    expect(breakdownRows(d).at(-1)).toMatchObject({ red: d.match.red.score!.total, blue: d.match.blue.score!.total, total: true });
    // A second tap closes the phase again.
    fireEvent.click(phases[0]);
    expect(rendered().map((x) => x.label)).not.toContain("Leave");
  });

  it("groups each part under the phase above it", () => {
    const g = groupRows([{ label: "Auto", red: 1, blue: 2 }, { label: "Leave", red: 1, blue: 0, depth: 1 }, { label: "Total", red: 1, blue: 2, total: true }]);
    expect(g.map((x) => [x.row.label, x.parts.map((p) => p.label)])).toEqual([["Auto", ["Leave"]], ["Total", []]]);
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
    expect(earned.textContent).toContain("✓");
    expect(missed.dataset.earned).toBe("false");
    expect(missed.textContent).toContain("Pollinator 1 RP missed");
    expect(missed.textContent).toContain("✗");
    expect(missed.textContent).not.toContain("✓");
  });

  it("gives BIOBUZZ's three bonus RPs three different icons", () => {
    expect([rpIcon("Swarm"), rpIcon("Pollinator 1"), rpIcon("Pollinator 2")]).toEqual([SwarmIcon, Pollinator1Icon, Pollinator2Icon]);
  });
});

describe("bonus RP odds in the call card", () => {
  it("prints each RP's chance for both sides and the expected RP as numbers, no bars", async () => {
    const { BonusOddsRow } = await import("./BonusOdds");
    const { MemoryRouter } = await import("react-router-dom");
    render(<MemoryRouter><BonusOddsRow season={2026} bonus={{ tier: "provisional", red: [0.67, 0.06, 0.01], blue: [0.69, 0.07, 0.01], rpRed: 2.3, rpBlue: 2.3 } as never} actual={{ red: [false, false, false], blue: [false, false, false] }} /></MemoryRouter>);
    const text = screen.getByTestId("bonus-odds").textContent!;
    expect(text).toContain("SwarmRed 67% – Blue 69%");
    expect(text).toContain("Pollinator 1Red 6% – Blue 7%");
    expect(text).toContain("Expected RPRed 2.3 – Blue 2.3");
    expect(screen.getByTestId("bonus-odds").querySelector("[style*='width']")).toBeNull();
  });
});

describe("a robot's standing line", () => {
  it("never leaves a bare season label: a dash when unknown, nothing when it equals the event OPR", async () => {
    const { TeamLine } = await import("./MatchDetails");
    const ev = { rank: 13, wins: 4, losses: 2, ties: 0, opr: { np: 15.5 } } as never;
    const visible = () => Array.from(screen.getByTestId("team-standing").querySelectorAll("[aria-hidden]")).map((e) => e.textContent).join("");
    render(<TeamLine ev={ev} se={{ opr: 15.5, rank: null } as never} />);
    expect(visible()).not.toContain("season");
    expect(screen.getByTestId("team-standing").textContent).toContain("Season OPR 15.5");
    cleanup();
    render(<TeamLine ev={ev} se={{ opr: null, rank: null } as never} />);
    expect(visible()).toContain("season —");
    cleanup();
    render(<TeamLine ev={ev} se={{ opr: 12.04, rank: 1666 } as never} />);
    expect(screen.getByTestId("team-standing").textContent).toContain("#1,666");
    expect(visible()).toContain("season 12");
  });
});
