// @vitest-environment jsdom
// Schedule difficulty in an event's records table and the owner's toggle: with it off, a saved link sorted or
// columned on a schedule stat still shows the standings (default sort, no schedule columns), never "switched off".
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const asked: string[] = [];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    if (path) asked.push(path);
    return { data: undefined, error: undefined, loading: true, reload: () => {} };
  },
  apiFetch: () => new Promise(() => {}),
}));

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const { resetFlags } = await import("../../lib/flags");
const { DEFAULT_FLAGS } = await import("../../shared/flags");

beforeEach(() => { vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetFlags(); asked.length = 0; });

const mount = (url: string) => render(
  <MemoryRouter initialEntries={[url]}><TooltipProvider>
    <RecordsTable scope="teamEvent" season={2025} code="USWICMP" predictable defaultCols={["rank", "scheduleDifficulty"]} defaultSort="rank" storageKey="sched-test" noun="teams" />
  </TooltipProvider></MemoryRouter>,
);
const recordsAsk = () => new URL(asked.filter((p) => p.startsWith("/api/records/")).at(-1)!, "http://x").searchParams;

describe("the records table and the scheduleDifficulty toggle", () => {
  it("on: a saved schedule sort and column are asked for", () => {
    mount("/events/2025/USWICMP?tab=rankings&sort=scheduleDifficulty&dir=desc");
    expect(recordsAsk().get("sort")).toBe("scheduleDifficulty");
    expect(recordsAsk().get("fields")).toContain("scheduleDifficulty");
  });

  it("off: the saved sort falls back to the default and the column isn't asked for", () => {
    resetFlags({ ...DEFAULT_FLAGS, scheduleDifficulty: false }, true);
    mount("/events/2025/USWICMP?tab=rankings&sort=scheduleDifficulty&dir=desc");
    expect(recordsAsk().get("sort") ?? "rank").toBe("rank");
    expect(recordsAsk().get("fields") ?? "").not.toContain("schedule");
  });
});
