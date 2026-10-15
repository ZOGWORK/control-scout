import { describe, expect, it } from "vitest";
import { teamRecord } from "./predict";
import type { MatchView } from "../shared/api";

const t = (number: number, x: { onField?: boolean; surrogate?: boolean } = {}) => ({ number, onField: x.onField ?? true, surrogate: x.surrogate ?? false });
const match = (level: "qual" | "playoff", red: ReturnType<typeof t>[], blue: ReturnType<typeof t>[], score: [number, number] | null) => ({
  level, played: !!score,
  red: { teams: red, score: score ? { total: score[0] } : null },
  blue: { teams: blue, score: score ? { total: score[1] } : null },
}) as unknown as MatchView;

describe("teamRecord", () => {
  it("counts like the season record: not when the team sat out or was a qualification surrogate", () => {
    const r = teamRecord([
      match("qual", [t(1), t(2)], [t(3), t(4)], [100, 50]), // win
      match("qual", [t(1), t(2)], [t(3), t(4)], [40, 50]), // loss
      match("qual", [t(1, { surrogate: true }), t(2)], [t(3), t(4)], [10, 50]), // surrogate: not counted
      match("qual", [t(1, { onField: false }), t(2)], [t(3), t(4)], [10, 50]), // sat out: not counted
      match("playoff", [t(5), t(6)], [t(1), t(2)], [60, 60]), // tie
      match("qual", [t(1), t(2)], [t(3), t(4)], null), // to play
    ], 1);
    expect(r).toEqual({ w: 1, l: 1, t: 1, played: 3, upcoming: 1 });
  });
});
