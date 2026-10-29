// @vitest-environment jsdom
// The data job cards tell their section when a job ends, so the report it changed loads again: a job started
// from these cards, and one already running when they mount (the owner switched tabs mid-rebuild and came back).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { OpsStatus } from "../../shared/owner";

const running: OpsStatus = { jobs: { packs: { op: "packs", state: "running", startedAt: new Date().toISOString(), finishedAt: null, by: "owner@example.com", message: null } }, writer: null, cycle: null, unavailable: {} };
const done: OpsStatus = { ...running, jobs: { packs: { ...running.jobs.packs!, state: "done", finishedAt: new Date().toISOString(), message: "Packs built." } } };
let status = running;
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: () => ({ data: status, error: undefined, loading: false, reload: () => Promise.resolve() }),
}));
const { OpsCards } = await import("./OpsCards");

afterEach(cleanup);

describe("OpsCards", () => {
  it("calls onDone for a job that was already running when the cards mounted", () => {
    const onDone = vi.fn();
    status = running;
    const { rerender } = render(<OpsCards ops={["packs"]} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
    status = done;
    rerender(<OpsCards ops={["packs"]} onDone={onDone} />);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("packs");
  });

  it("never calls onDone for a job that had already finished before the cards mounted", () => {
    const onDone = vi.fn();
    status = done;
    render(<OpsCards ops={["packs"]} onDone={onDone} />);
    expect(onDone).not.toHaveBeenCalled();
  });
});
