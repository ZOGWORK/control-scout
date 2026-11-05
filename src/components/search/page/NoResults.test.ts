// The no-answer page's searches that answer about the closest results (the results guide, §8).
import { describe, expect, it } from "vitest";
import type { SearchHit } from "../../../shared/api";
import { relatedFor } from "./NoResults";

const hit = (kind: "team" | "event", ref: string, title: string, season: number | null = null) => ({ kind, ref, title, season } as unknown as SearchHit);

describe("relatedFor", () => {
  it("a team's record and OPR, an event's winners in the card's own season, four at most", () => {
    expect(relatedFor([hit("team", "12345", "12345 | Robots"), hit("event", "2024:USXXCMP", "Somewhere Championship", 2024)]))
      .toEqual(["12345 record", "12345 opr", "who won Somewhere Championship 2024-25"]);
    expect(relatedFor([hit("team", "1", "a"), hit("team", "2", "b"), hit("team", "3", "c")])).toHaveLength(4);
  });
});
