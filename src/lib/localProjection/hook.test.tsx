// @vitest-environment jsdom
// useLocalProjection follows the results-state key, not the payload object: a refresh with the same results
// leaves the estimate alone, while a schedule correction (a team swap) or a DQ starts a new run.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SeasonDb } from "../offline/readers";
import { deps, detail, seasonPack } from "./testPack";

let sdb: SeasonDb;
const runs: string[] = [];
vi.mock("./run", async (orig) => {
  const real = await orig<typeof import("./run")>();
  return {
    ...real,
    prepareLocal: (d: Parameters<typeof real.prepareLocal>[0]) => real.prepareLocal(d, deps(sdb)),
    localProjectionFor: async (p: import("./run").Prepared) => { runs.push(real.cacheKey(p)); return { local: true, cacheKey: real.cacheKey(p), run: { runs: 1500 } }; },
  };
});
const { useLocalProjection } = await import("../projections");

beforeAll(async () => { sdb = await seasonPack(); });

describe("useLocalProjection", () => {
  it("re-runs only when the results state changes", async () => {
    const { result, rerender } = renderHook(({ d }) => useLocalProjection(d, true), { initialProps: { d: detail(sdb) } });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(runs).toHaveLength(1);

    // A refresh: a new payload object with the same results.
    await act(async () => { rerender({ d: detail(sdb) }); });
    await new Promise((r) => setTimeout(r, 50));
    expect(runs).toHaveLength(1);

    // A schedule correction: two teams swap sides in an unplayed match.
    const swap = detail(sdb);
    const q3 = swap.matches.find((m) => m.label === "Q3")!;
    [q3.red.teams[0], q3.blue.teams[0]] = [q3.blue.teams[0], q3.red.teams[0]];
    await act(async () => { rerender({ d: swap }); });
    await waitFor(() => expect(runs).toHaveLength(2));

    // Then a DQ on a played match (the swap kept, same scores): only the DQ differs.
    const dq = structuredClone(swap);
    dq.matches.find((m) => m.label === "Q1")!.red.teams[0].dq = true;
    await act(async () => { rerender({ d: dq }); });
    await waitFor(() => expect(runs).toHaveLength(3));
    expect(new Set(runs).size).toBe(3);
  });
});
